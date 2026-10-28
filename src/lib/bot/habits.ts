// Habits from Telegram (server only): ✓/Skip rows with undo, "done X" that also finds tasks, and
// "habit: X in Block" that offers your blocks when the block isn't found.
import { addDays, formatMinutes, timeToMinutes } from "@/lib/time";
import { getBlockTypes, getOccurrence } from "@/lib/calendar/model";
import { getHabits, recomputeOccurrenceStatus, setHabitCheck } from "@/lib/calendar/habits";
import { normalizeName } from "@/lib/calendar/edit";
import { dayData, markHabitFromBot, type DayHabit } from "@/lib/reminders";
import type { Ctx } from "@/lib/bot/core";
import { btn, logAction, pk, type Btn, type Kb } from "@/lib/bot/tg";
import { bestMatches, simplify } from "@/lib/bot/text";
import { completeTask, doneRow } from "@/lib/bot/tasks";

export const habitRow = (h: Pick<DayHabit, "habitId" | "occurrenceId" | "title">): Btn[] => [
  btn(`✓ ${h.title}`, `hk:d:${pk(h.habitId)}:${pk(h.occurrenceId)}`),
  btn("Skip", `hk:s:${pk(h.habitId)}:${pk(h.occurrenceId)}`),
];

export const markedRow = (habitId: string, occId: string, title: string, state: "done" | "skipped"): Kb => [
  [btn(`↩ Undo ${state === "done" ? "✓" : "Skip"} ${title}`, `hu:${pk(habitId)}:${pk(occId)}`)],
];

/** "Gym 7:00 AM · Stretch" */
export async function habitTitle(c: Ctx, habitId: string, occId: string) {
  const [occ, { data: h }, types] = await Promise.all([
    getOccurrence(c.admin, c.userId, occId),
    c.admin.from("habits").select("name").eq("id", habitId).eq("user_id", c.userId).maybeSingle(),
    getBlockTypes(c.admin, c.userId, { includeDeleted: true }),
  ]);
  const block = occ ? types.find((t) => t.id === occ.block_type_id)?.name ?? "Block" : "Block";
  return `${block} ${occ ? formatMinutes(timeToMinutes(occ.start_time)) : ""} · ${(h?.name as string | undefined) ?? "Habit"}`.replace("  ", " ");
}

export async function markHabit(c: Ctx, habitId: string, occId: string, state: "done" | "skipped") {
  return markHabitFromBot(c.admin, c.userId, c.tz, habitId, occId, state);
}

/** Undo of ✓ / Skip: the mark is removed (as if never logged). */
export async function unmarkHabit(c: Ctx, habitId: string, occId: string) {
  const occ = await getOccurrence(c.admin, c.userId, occId);
  if (!occ) return { ok: false, text: "That block is no longer on the calendar." };
  await setHabitCheck(c.admin, c.userId, habitId, occ, null, "telegram");
  await recomputeOccurrenceStatus(c.admin, c.userId, occ.id, c.today);
  return { ok: true, text: "↩ Mark removed." };
}

/** Today's habit appearances (and yesterday's until 3:00 AM, for late check-ins). */
async function markableHabits(c: Ctx): Promise<DayHabit[]> {
  const today = await dayData(c.admin, { user_id: c.userId, timezone: c.tz }, c.today);
  if (c.nowMin >= 180) return today.habits;
  const y = await dayData(c.admin, { user_id: c.userId, timezone: c.tz }, addDays(c.today, -1));
  return [...today.habits, ...y.habits];
}

type Reply = { text: string; kb: Kb };

/**
 * "done X" / "hecho X" / "listo X" / "skip X": a habit of today, or (done only) an open task.
 * One match → done, with undo. Several → buttons to pick. None → says what exists.
 */
export async function resolveDone(c: Ctx, state: "done" | "skipped", rawQuery: string, raw: string): Promise<Reply> {
  const query = rawQuery.replace(/^(?:el|la|los|las|the|a|my|mi)\s+/i, "").trim() || rawQuery;
  const [habits, slots, taskRes] = await Promise.all([
    getHabits(c.admin, c.userId),
    markableHabits(c),
    state === "done"
      ? c.admin
          .from("tasks")
          .select("id,title")
          .eq("user_id", c.userId)
          .is("deleted_at", null)
          .in("status", ["pending", "backlog"])
          .order("scheduled_for")
          .limit(300)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const tasks = (taskRes.data ?? []) as { id: string; title: string }[];
  const habitHits = bestMatches(habits, query, (h) => h.name);
  const habitIds = new Set(habitHits.map((h) => h.id));
  const slotHits = slots.filter((s) => habitIds.has(s.habitId));
  const taskHits = bestMatches(tasks, query, (t) => t.title);

  // A habit name that matches exactly wins over tasks that only contain the words
  const exactHabit = habitHits.some((h) => simplify(h.name) === simplify(query));
  const exactTask = taskHits.some((t) => simplify(t.title) === simplify(query));
  const useTasks = taskHits.length > 0 && !(exactHabit && !exactTask);
  const useHabits = slotHits.length > 0 && !(exactTask && !exactHabit);

  if (useHabits && !useTasks && new Set(slotHits.map((s) => s.habitId)).size === 1) {
    const target = slotHits.find((s) => !s.status) ?? slotHits[0];
    if (target.status === state) return { text: `“${target.title}” is already marked ${state === "done" ? "done" : "skipped"}.`, kb: [] };
    const r = await markHabit(c, target.habitId, target.occurrenceId, state);
    if (!r.ok) return { text: r.text, kb: [] };
    await logAction(c.admin, c.userId, raw, "habit_check", target.habitId, { habitId: target.habitId, occurrenceId: target.occurrenceId });
    return { text: r.text, kb: markedRow(target.habitId, target.occurrenceId, target.title, state) };
  }
  if (useTasks && !useHabits && taskHits.length === 1) {
    const r = await completeTask(c, taskHits[0].id);
    return { text: r.text, kb: r.ok ? doneRow(taskHits[0]) : [] };
  }
  if ((useTasks && taskHits.length) || (useHabits && slotHits.length)) {
    const rows: Kb = [];
    if (useHabits) {
      for (const s of slotHits.filter((x) => !x.status).slice(0, 4)) {
        rows.push([btn(`🔁 ${state === "done" ? "✓" : "Skip"} ${s.title}`, `hk:${state === "done" ? "d" : "s"}:${pk(s.habitId)}:${pk(s.occurrenceId)}`)]);
      }
    }
    if (useTasks) for (const t of taskHits.slice(0, 6)) rows.push([btn(`✅ ${t.title}`, `td:${pk(t.id)}`)]);
    if (rows.length) return { text: `“${rawQuery}” matches several things. Which one?`, kb: rows };
    return { text: `“${rawQuery}” is already marked today.`, kb: [] };
  }
  if (habitHits.length && !slotHits.length) {
    return { text: `“${habitHits[0].name}” isn't in any block on today's calendar, so there is nothing to mark today.`, kb: [] };
  }
  const names = habits.map((h) => h.name).slice(0, 15).join(", ") || "none yet";
  return {
    text: state === "done"
      ? `No habit or open task matches “${rawQuery}”. Your habits: ${names}.\n(/tasks shows your open tasks.)`
      : `I don't have a habit called “${rawQuery}”. Your habits: ${names}.`,
    kb: [],
  };
}

/**
 * "habit: Read in Evening". When the block doesn't exist the habit isn't lost: the bot offers your
 * blocks, or to save the whole text as the name without a block.
 */
export async function createHabit(c: Ctx, raw: string, name: string, block: string | null, fullBody: string): Promise<Reply> {
  const habits = await getHabits(c.admin, c.userId);
  let blockId: string | null = null;
  let blockName: string | null = null;
  if (block) {
    const blocks = await getBlockTypes(c.admin, c.userId);
    const found = bestMatches(blocks, block, (b) => b.name);
    if (found.length !== 1) {
      // Keep it pending and ask
      const { data: bm } = await c.admin
        .from("bot_messages")
        .insert({ user_id: c.userId, raw_text: raw.slice(0, 4000), status: "parsed", parsed: { kind: "habit_pending", name, full: normalizeName(fullBody) } })
        .select("id")
        .single();
      if (!bm) return { text: "Sorry, I could not do that with your habits.", kb: [] };
      const key = pk(bm.id as string);
      const options = (found.length > 1 ? found : blocks).slice(0, 10);
      const rows: Kb = [];
      for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2).map((b) => btn(`→ ${b.name}`, `hp:${key}:${pk(b.id)}`)));
      rows.push([btn(`“${normalizeName(fullBody)}” · no block`, `hp:${key}:n`)]);
      rows.push([btn("Cancel", `hp:${key}:x`)]);
      return {
        text: found.length > 1
          ? `“${block}” matches several blocks. Which one gets “${name}”?`
          : `I don't have a block called “${block}”. Put “${name}” in one of these, or save the whole text as the habit's name:`,
        kb: rows,
      };
    }
    blockId = found[0].id;
    blockName = found[0].name;
  }
  return saveHabit(c, raw, name, blockId, blockName, habits);
}

export async function saveHabit(
  c: Ctx,
  raw: string,
  name: string,
  blockId: string | null,
  blockName: string | null,
  known?: { name: string; block_type_id: string | null }[]
): Promise<Reply> {
  const habits = known ?? (await getHabits(c.admin, c.userId));
  const twin = habits.find((h) => simplify(h.name) === simplify(name) && h.block_type_id === blockId);
  if (twin) return { text: `You already have “${twin.name}”${blockName ? ` in ${blockName}` : ""}. Nothing new was saved.`, kb: [] };
  const { data, error } = await c.admin
    .from("habits")
    .insert({ user_id: c.userId, name, block_type_id: blockId, active_from: c.today })
    .select("id")
    .single();
  if (error || !data) return { text: "Sorry, I could not create that habit.", kb: [] };
  const logId = await logAction(c.admin, c.userId, raw, "habit", data.id as string);
  return {
    text: blockName
      ? `Saved ✓ habit “${name}” in ${blockName}. It shows up every time ${blockName} is on the calendar.`
      : `Saved ✓ habit “${name}” (no block yet). Place it in a block on the Habits page to start tracking it.`,
    kb: logId ? [[btn("Undo", `undo:${logId}`)]] : [],
  };
}
