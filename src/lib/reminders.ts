import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateLong, formatMinutes, localNow, timeToMinutes } from "@/lib/time";
import { getBlockTypes, getOccurrence, getOccurrences } from "@/lib/calendar/model";
import { eventSpanOn, spanOn } from "@/lib/calendar/overlap";
import { getEvents } from "@/lib/calendar/events";
import { getChecks, getHabits, recomputeOccurrenceStatus, setHabitCheck } from "@/lib/calendar/habits";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { SKIP_LIMIT } from "@/lib/calendar/streaks";
import type { HabitState } from "@/lib/calendar/types";
import { packId } from "@/lib/telegram";

// Server-only: runs with the admin client, so EVERY query filters by user_id.

export type ReminderSettings = {
  user_id: string;
  timezone: string;
  telegram_chat_id: number;
  reminder_morning_enabled: boolean;
  reminder_morning_time: string;
  reminder_evening_enabled: boolean;
  reminder_evening_time: string;
  reminder_before_minutes: number;
  reminder_insights: boolean;
  reminder_unassigned_nag: boolean;
};

export const REMINDER_COLUMNS =
  "user_id,timezone,telegram_chat_id,reminder_morning_enabled,reminder_morning_time,reminder_evening_enabled,reminder_evening_time,reminder_before_minutes,reminder_insights,reminder_unassigned_nag";

/** block: id is the occurrence id and blockTypeId its block type. */
export type DayItem = { kind: "block" | "event"; id: string; title: string; start: number; end: number; blockTypeId?: string };

/** One habit mark to make today: a habit inside one appearance of its block. */
export type DayHabit = {
  habitId: string;
  occurrenceId: string;
  title: string; // "Gym 7:00 AM · Stretch"
  status: HabitState | null;
};

/** Today's schedule, open tasks and habits for one user (calendar v2 model). */
export async function dayData(admin: SupabaseClient, s: Pick<ReminderSettings, "user_id" | "timezone">, date: string) {
  const tz = s.timezone;
  const [types, occurrences, events, habits, checks, t] = await Promise.all([
    getBlockTypes(admin, s.user_id, { includeDeleted: true }),
    getOccurrences(admin, s.user_id, date, date),
    getEvents(admin, s.user_id, date, date, tz),
    getHabits(admin, s.user_id, { includeRemoved: true }),
    getChecks(admin, s.user_id, date, date),
    admin
      .from("tasks")
      .select("id,title,occurrence_id,event_id")
      .eq("user_id", s.user_id)
      .is("deleted_at", null)
      .eq("status", "pending")
      .lte("scheduled_for", date)
      .order("scheduled_for"),
  ]);
  const typeName = new Map(types.map((x) => [x.id, x.name]));

  const items: DayItem[] = [];
  const dayHabits: DayHabit[] = [];
  for (const o of occurrences) {
    const span = spanOn(o, date);
    if (!span || span.continued || o.status === "free_day") continue; // only where a block starts
    const name = typeName.get(o.block_type_id) ?? "Block";
    items.push({
      kind: "block",
      id: o.id,
      title: name,
      start: span.start,
      end: span.continues ? timeToMinutes(o.end_time) + 1440 : span.end,
      blockTypeId: o.block_type_id,
    });
    for (const x of habitsForOccurrence(o, habits, checks, date)) {
      dayHabits.push({
        habitId: x.habit.id,
        occurrenceId: o.id,
        title: `${name} ${formatMinutes(span.start)} · ${x.habit.name}`,
        status: x.state,
      });
    }
  }
  const dayNotes: string[] = [];
  for (const e of events) {
    const span = eventSpanOn(e, date);
    if (!span) continue;
    if (span.allDay) dayNotes.push(e.title);
    else items.push({ kind: "event", id: e.id, title: e.title, start: span.start, end: span.end });
  }
  items.sort((a, b2) => a.start - b2.start);

  const tasks = (t.data ?? []) as { id: string; title: string; occurrence_id: string | null; event_id: string | null }[];
  return {
    items,
    dayNotes,
    tasks,
    unassigned: tasks.filter((x) => !x.occurrence_id && !x.event_id).length,
    habits: dayHabits,
  };
}

type Day = Awaited<ReturnType<typeof dayData>>;

const list = (titles: string[], max = 5) =>
  titles.slice(0, max).map((t) => `• ${t}`).join("\n") + (titles.length > max ? `\n• +${titles.length - max} more` : "");

export function morningText(date: string, d: Day) {
  const parts = [`☀️ Good morning! ${formatDateLong(date)}`];
  if (d.dayNotes.length) parts.push(`📌 ${d.dayNotes.join(" · ")}`);
  parts.push(
    d.items.length
      ? `\n📅 Today\n${d.items.map((i) => `• ${formatMinutes(i.start % 1440)} ${i.title}${i.kind === "event" ? "" : " (block)"}`).join("\n")}`
      : "\n📅 Nothing scheduled today."
  );
  if (d.tasks.length) parts.push(`\n✅ Tasks (${d.tasks.length})\n${list(d.tasks.map((t) => t.title))}`);
  if (d.unassigned) parts.push(unassignedText(d.unassigned));
  if (d.habits.length) parts.push(`\n🔁 Habits: ${d.habits.map((h) => h.title).join(", ")}`);
  return parts.join("\n");
}

export function unassignedText(n: number) {
  return `\n📥 ${n} task${n > 1 ? "s" : ""} still without a block. Open the app on the computer to place ${n > 1 ? "them" : "it"}.`;
}

/** ✓ buttons to complete tasks from Telegram (the only task action allowed there). */
export function taskButtons(tasks: { id: string; title: string }[], max = 8) {
  return tasks.slice(0, max).map((t) => [{ text: `✓ ${t.title}`.slice(0, 60), callback_data: `tk:${packId(t.id)}` }]);
}

/** Completes a task from a Telegram button. */
export async function completeTaskFromBot(admin: SupabaseClient, userId: string, timezone: string, taskId: string) {
  const { data: task } = await admin
    .from("tasks")
    .select("id,title,status,occurrence_id")
    .eq("id", taskId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!task) return { ok: false, text: "Could not find that task." };
  if (task.status === "completed") return { ok: true, text: `“${task.title}” was already done.` };
  await admin
    .from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", task.id)
    .eq("user_id", userId);
  if (task.occurrence_id) await recomputeOccurrenceStatus(admin, userId, task.occurrence_id as string, localNow(timezone).date);
  return { ok: true, text: `✓ Done: ${task.title}` };
}

export function beforeText(item: DayItem, minutes: number, ctx: { tasks: string[]; notes: string[] }) {
  const lines = [`⏰ In ${minutes} min: ${item.title}`, `${formatMinutes(item.start % 1440)} – ${formatMinutes(item.end % 1440)}`];
  if (ctx.tasks.length) lines.push(`\nTasks for this:\n${list(ctx.tasks)}`);
  if (ctx.notes.length) lines.push(`\nNotes:\n${list(ctx.notes)}`);
  return lines.join("\n");
}

export function eveningText(d: Day) {
  const pending = d.habits.filter((h) => !h.status);
  const lines = ["🌙 Evening check-in"];
  if (pending.length) lines.push("\nDid you do these today? Tap to log:");
  else if (d.habits.length) lines.push("\nAll habits logged today. 👏");
  if (d.tasks.length) lines.push(`\n${d.tasks.length} task${d.tasks.length > 1 ? "s" : ""} still open. Unfinished ones go to tomorrow's morning ritual.`);
  return { text: lines.join("\n"), pending };
}

/** Tasks and notes linked to a block type or event. */
export async function linkedTo(admin: SupabaseClient, userId: string, kind: "block" | "event", id: string) {
  const { data } = await admin
    .from("entity_relations")
    .select("source_type,source_id")
    .eq("user_id", userId)
    .eq("target_type", kind === "block" ? "block_type" : "event")
    .eq("target_id", id)
    .in("source_type", ["task", "note"])
    .is("deleted_at", null);
  const rels = (data ?? []) as { source_type: string; source_id: string }[];
  const taskIds = rels.filter((r) => r.source_type === "task").map((r) => r.source_id);
  const noteIds = rels.filter((r) => r.source_type === "note").map((r) => r.source_id);
  const [t, n] = await Promise.all([
    taskIds.length
      ? admin.from("tasks").select("title").eq("user_id", userId).in("id", taskIds).eq("status", "pending").is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    noteIds.length
      ? admin.from("notes").select("title").eq("user_id", userId).in("id", noteIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    tasks: ((t.data ?? []) as { title: string }[]).map((x) => x.title),
    notes: ((n.data ?? []) as { title: string }[]).map((x) => x.title || "Untitled"),
  };
}

/** Records that a reminder is being sent. Returns false if it was already sent. */
export async function claim(admin: SupabaseClient, userId: string, kind: string, ref: string) {
  const { error } = await admin.from("reminder_log").insert({ user_id: userId, kind, ref });
  return !error;
}

/**
 * Marks one habit in one block from a Telegram button (✓ / Skip). Only for today:
 * corrections of earlier days are made on the computer.
 */
export async function markHabitFromBot(
  admin: SupabaseClient,
  userId: string,
  timezone: string,
  habitId: string,
  occurrenceId: string,
  state: "done" | "skipped"
): Promise<{ text: string; ok: boolean }> {
  const today = localNow(timezone).date;
  const [occ, { data: habit }] = await Promise.all([
    getOccurrence(admin, userId, occurrenceId),
    admin.from("habits").select("id,name").eq("id", habitId).eq("user_id", userId).maybeSingle(),
  ]);
  if (!occ || !habit) return { ok: false, text: "Could not find that habit." };
  if (occ.date !== today) return { ok: false, text: "That day is closed. Fix it on the computer." };
  await setHabitCheck(admin, userId, habitId, occ, state, "telegram");
  await recomputeOccurrenceStatus(admin, userId, occ.id, today);
  if (state === "done") return { ok: true, text: `✓ ${habit.name} logged` };

  // How many skips in a row now (the 4th breaks the streak)
  const { data: last } = await admin
    .from("habit_checks")
    .select("state,date")
    .eq("user_id", userId)
    .eq("habit_id", habitId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SKIP_LIMIT + 1);
  let run = 0;
  for (const r of (last ?? []) as { state: string }[]) {
    if (r.state !== "skipped") break;
    run += 1;
  }
  return {
    ok: true,
    text:
      run > SKIP_LIMIT
        ? `${habit.name} skipped. That's more than ${SKIP_LIMIT} in a row, so the streak breaks.`
        : `${habit.name} skipped (streak kept, ${SKIP_LIMIT - run} skip${SKIP_LIMIT - run === 1 ? "" : "s"} left in a row)`,
  };
}

export function nowFor(s: Pick<ReminderSettings, "timezone">) {
  return localNow(s.timezone);
}
