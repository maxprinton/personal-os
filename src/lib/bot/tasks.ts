// Tasks from Telegram (server only): the row of buttons every task gets (✓ · ⏭ · ⋯), its menu
// (📅 date · 🧱 block · ✏️ rename · 🗄 archive), every action with an undo, and the /tasks list.
// Same rules as the web (task-actions.ts / calendar-actions.ts), with the admin client.
import { addDays, formatMinutes, timeToMinutes } from "@/lib/time";
import { getBlockTypes, getOccurrence, getOccurrences } from "@/lib/calendar/model";
import { autoPlaceTasks, countMove, getTask, rescheduleTarget, TASK_COLS, type TaskDb } from "@/lib/calendar/tasks";
import { recomputeOccurrenceStatus } from "@/lib/calendar/habits";
import type { Ctx } from "@/lib/bot/core";
import { btn, pk, type Btn, type Kb } from "@/lib/bot/tg";
import { packDate, shortDay, wdDay } from "@/lib/bot/text";

type Result = { ok: boolean; text: string; title?: string };

// ---- Rows ---------------------------------------------------------------------------

export function taskRow(t: { id: string; title: string }): Btn[] {
  const k = pk(t.id);
  return [btn(`✓ ${t.title}`.slice(0, 40), `td:${k}`), btn("⏭", `tn:${k}`), btn("⋯", `tm:${k}`)];
}

export const taskRows = (tasks: { id: string; title: string }[], max = 8): Kb => tasks.slice(0, max).map(taskRow);

export const doneRow = (t: { id: string; title: string }): Kb => [[btn(`↩ Undo ✓ ${t.title}`, `tu:${pk(t.id)}`)]];

const prevData = (date: string | null, occ: string | null) => `${date ? packDate(date) : "-"}:${occ ? pk(occ) : "-"}`;

export const movedRow = (t: { id: string; title: string }, label: string, prevDate: string | null, prevOcc: string | null): Kb => [
  [btn(`↩ ${t.title} → ${label}`, `tv:${pk(t.id)}:${prevData(prevDate, prevOcc)}`)],
];

export const archivedRow = (t: { id: string; title: string }, prevDate: string | null, prevOcc: string | null): Kb => [
  [btn(`↩ Undo 🗄 ${t.title}`, `tR:${pk(t.id)}:${prevData(prevDate, prevOcc)}`)],
];

export function menuRows(t: { id: string; title: string }): Kb {
  const k = pk(t.id);
  return [
    [btn(`⋯ ${t.title}  ✕`, `tc:${k}`)],
    [btn("📅 Date", `tD:${k}`), btn("🧱 Block", `tB:${k}:0`), btn("✏️ Rename", `te:${k}`), btn("🗄 Archive", `ta:${k}`)],
  ];
}

export function dateRows(t: { id: string; title: string }, today: string): Kb {
  const k = pk(t.id);
  const d = (n: number) => addDays(today, n);
  const label = (n: number) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : wdDay(d(n)));
  const b = (n: number) => btn(label(n), `tq:${k}:${packDate(d(n))}`);
  return [
    [btn(`📅 ${t.title}: when?  ✕`, `tc:${k}`)],
    [b(0), b(1), b(2)],
    [b(3), b(4), b(5), b(6)],
    [btn("+1 week", `tq:${k}:${packDate(d(7))}`), btn("✍️ Other date", `tO:${k}`)],
  ];
}

/** The live blocks of a day, to place a task in one. */
export async function blockRows(c: Ctx, t: { id: string; title: string }, offset: 0 | 1): Promise<Kb> {
  const k = pk(t.id);
  const date = addDays(c.today, offset);
  const [occs, types] = await Promise.all([getOccurrences(c.admin, c.userId, date, date), getBlockTypes(c.admin, c.userId, { includeDeleted: true })]);
  const name = new Map(types.map((x) => [x.id, x.name]));
  const live = occs
    .filter((o) => o.date === date && o.status !== "free_day" && o.status !== "cancelled")
    .filter((o) => offset === 1 || o.end_time <= o.start_time || timeToMinutes(o.end_time) > c.nowMin)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const rows: Kb = [[btn(`🧱 ${t.title}: which block ${offset === 0 ? "today" : "tomorrow"}?  ✕`, `tc:${k}`)]];
  const buttons = live.map((o) => btn(`${name.get(o.block_type_id) ?? "Block"} ${formatMinutes(timeToMinutes(o.start_time)).replace(":00 ", " ")}`, `tp:${k}:${pk(o.id)}`));
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (!buttons.length) rows.push([btn(`No blocks left ${offset === 0 ? "today" : "tomorrow"}`, `tB:${k}:${offset === 0 ? 1 : 0}`)]);
  rows.push([btn(offset === 0 ? "Tomorrow ▸" : "◂ Today", `tB:${k}:${offset === 0 ? 1 : 0}`)]);
  return rows;
}

// ---- Actions --------------------------------------------------------------------------

const isOpen = (t: TaskDb) => t.status === "pending" || t.status === "backlog";

export async function completeTask(c: Ctx, id: string): Promise<Result> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (task.status === "completed") return { ok: true, text: `“${task.title}” was already done.`, title: task.title };
  if (task.status === "archived") return { ok: false, text: `“${task.title}” is archived. Restore it first (/archived).`, title: task.title };
  const { error } = await c.admin
    .from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  if (error) return { ok: false, text: "Could not save that. Try again." };
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  return { ok: true, text: `✓ Done: ${task.title}`, title: task.title };
}

/** Undo of ✓: open again (on today if its day is past). */
export async function reopenTask(c: Ctx, id: string): Promise<Result> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (task.status !== "completed") return { ok: true, text: `“${task.title}” is open.`, title: task.title };
  const past = !task.scheduled_for || task.scheduled_for < c.today;
  await c.admin
    .from("tasks")
    .update({ status: "pending", completed_at: null, ...(past ? { scheduled_for: c.today, occurrence_id: null, event_id: null } : {}) })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  if (past) await autoPlaceTasks(c.admin, c.userId, c.today);
  return { ok: true, text: `↩ Open again: ${task.title}`, title: task.title };
}

type MoveResult = Result & { label?: string; prevDate?: string | null; prevOcc?: string | null };

/** ⏭ = the next time the task's block happens (counts as a move). */
export async function moveToNextBlock(c: Ctx, id: string): Promise<MoveResult> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (!isOpen(task)) return { ok: false, text: `“${task.title}” is not open any more.`, title: task.title };
  const after = task.scheduled_for && task.scheduled_for > c.today ? task.scheduled_for : c.today;
  const { blockName, next } = await rescheduleTarget(c.admin, c.userId, task, after);
  if (!blockName) return { ok: false, text: `“${task.title}” has no block. Tap ⋯ → 📅 to pick a date.`, title: task.title };
  if (!next) return { ok: false, text: `${blockName} is not on the calendar in the next 8 weeks. Tap ⋯ → 📅.`, title: task.title };
  await c.admin
    .from("tasks")
    .update({ scheduled_for: next.date, occurrence_id: next.id, event_id: null, status: "pending", hold_placement: false })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  if (task.status === "pending" && task.scheduled_for) await countMove(c.admin, c.userId, task, task.scheduled_for <= c.today ? task.scheduled_for : null);
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  await recomputeOccurrenceStatus(c.admin, c.userId, next.id, c.today);
  const label = `${blockName} ${wdDay(next.date)} ${next.start_time.slice(0, 5)}`;
  return { ok: true, text: `⏭ “${task.title}” → next ${label}`, title: task.title, label, prevDate: task.scheduled_for, prevOcc: task.occurrence_id };
}

/** 📅 a day (today or later). Counts as a move when it had a day. */
export async function moveToDate(c: Ctx, id: string, date: string): Promise<MoveResult> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (!isOpen(task)) return { ok: false, text: `“${task.title}” is not open any more.`, title: task.title };
  if (date < c.today) return { ok: false, text: "Pick today or a later date.", title: task.title };
  await c.admin
    .from("tasks")
    .update({ scheduled_for: date, occurrence_id: null, event_id: null, status: "pending", hold_placement: false, completed_at: null })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  const hadDay = task.status === "pending" && Boolean(task.scheduled_for);
  if (hadDay && (task.scheduled_for !== date || task.occurrence_id)) {
    await countMove(c.admin, c.userId, task, task.scheduled_for! <= c.today ? task.scheduled_for : null);
  }
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  await autoPlaceTasks(c.admin, c.userId, c.today);
  const label = date === c.today ? "today" : date === addDays(c.today, 1) ? "tomorrow" : shortDay(date);
  return { ok: true, text: `📅 “${task.title}” → ${label}`, title: task.title, label, prevDate: task.scheduled_for, prevOcc: task.occurrence_id };
}

/** 🧱 into one appearance of a block (it also becomes the task's home block if it had none). */
export async function placeInBlock(c: Ctx, id: string, occId: string): Promise<MoveResult> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (!isOpen(task)) return { ok: false, text: `“${task.title}” is not open any more.`, title: task.title };
  const occ = await getOccurrence(c.admin, c.userId, occId);
  if (!occ || occ.status === "cancelled") return { ok: false, text: "That block is no longer on the calendar.", title: task.title };
  if (occ.status === "free_day") return { ok: false, text: "That block is paused (free day).", title: task.title };
  if (occ.date < c.today) return { ok: false, text: "That block is in the past.", title: task.title };
  const types = await getBlockTypes(c.admin, c.userId, { includeDeleted: true });
  const name = types.find((t) => t.id === occ.block_type_id)?.name ?? "Block";
  await c.admin
    .from("tasks")
    .update({
      occurrence_id: occ.id,
      event_id: null,
      scheduled_for: occ.date,
      hold_placement: false,
      status: "pending",
      ...(task.home_block_type_id ? {} : { home_block_type_id: occ.block_type_id }),
    })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  if (task.status === "pending" && task.scheduled_for && task.scheduled_for !== occ.date && task.scheduled_for >= c.today) {
    await countMove(c.admin, c.userId, task, task.scheduled_for);
  }
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  await recomputeOccurrenceStatus(c.admin, c.userId, occ.id, c.today);
  const label = `${name} ${occ.date === c.today ? "" : `${wdDay(occ.date)} `}${occ.start_time.slice(0, 5)}`;
  return { ok: true, text: `🧱 “${task.title}” → ${label}`, title: task.title, label, prevDate: task.scheduled_for, prevOcc: task.occurrence_id };
}

/** Undo of ⏭ / 📅 / 🧱: back to where it was (and the move doesn't count). */
export async function undoMove(c: Ctx, id: string, prevDate: string | null, prevOcc: string | null): Promise<Result> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  const date = prevDate && prevDate >= c.today ? prevDate : c.today;
  let occ = date === prevDate ? prevOcc : null;
  if (occ) {
    const o = await getOccurrence(c.admin, c.userId, occ);
    if (!o || o.status === "cancelled" || o.status === "free_day") occ = null;
  }
  await c.admin
    .from("tasks")
    .update({
      scheduled_for: date,
      occurrence_id: occ,
      event_id: null,
      status: "pending",
      rolled_over_count: Math.max(0, task.rolled_over_count - 1),
    })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  // The "moved" mark this move left on its day (only one made in the last hour)
  if (prevDate) {
    await c.admin
      .from("task_day_log")
      .delete()
      .eq("user_id", c.userId)
      .eq("task_id", task.id)
      .eq("date", prevDate)
      .eq("outcome", "moved")
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  }
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  if (occ) await recomputeOccurrenceStatus(c.admin, c.userId, occ, c.today);
  return { ok: true, text: `↩ “${task.title}” is back where it was.`, title: task.title };
}

export async function archiveTask(c: Ctx, id: string): Promise<MoveResult> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (task.status === "archived") return { ok: true, text: `“${task.title}” is already archived.`, title: task.title, prevDate: task.scheduled_for, prevOcc: null };
  if (!isOpen(task)) return { ok: false, text: `“${task.title}” is done, so it stays done.`, title: task.title };
  const { error } = await c.admin
    .from("tasks")
    .update({ status: "archived", archived_at: new Date().toISOString(), occurrence_id: null, event_id: null })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  if (error) return { ok: false, text: "Archiving needs the database update (migration 0015) first." };
  if (task.occurrence_id) await recomputeOccurrenceStatus(c.admin, c.userId, task.occurrence_id, c.today);
  return { ok: true, text: `🗄 Archived “${task.title}”`, title: task.title, prevDate: task.scheduled_for, prevOcc: task.occurrence_id };
}

/** Back from the archive: to its old place if that is still ahead, else today. */
export async function unarchiveTask(c: Ctx, id: string, prevDate: string | null = null, prevOcc: string | null = null): Promise<Result> {
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  if (task.status !== "archived") return { ok: true, text: `“${task.title}” is not archived.`, title: task.title };
  const keep = Boolean(prevDate && prevDate >= c.today);
  let occ = keep ? prevOcc : null;
  if (occ) {
    const o = await getOccurrence(c.admin, c.userId, occ);
    if (!o || o.status === "cancelled" || o.status === "free_day") occ = null;
  }
  await c.admin
    .from("tasks")
    .update({ status: "pending", archived_at: null, completed_at: null, scheduled_for: keep ? prevDate : c.today, occurrence_id: occ, event_id: null })
    .eq("id", task.id)
    .eq("user_id", c.userId);
  if (occ) await recomputeOccurrenceStatus(c.admin, c.userId, occ, c.today);
  await autoPlaceTasks(c.admin, c.userId, c.today);
  return { ok: true, text: `↩ Restored “${task.title}”${keep ? "" : " for today"}`, title: task.title };
}

export async function renameTask(c: Ctx, id: string, title: string): Promise<Result> {
  const clean = title.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!clean) return { ok: false, text: "Write the new name." };
  const task = await getTask(c.admin, c.userId, id);
  if (!task) return { ok: false, text: "That task no longer exists." };
  await c.admin.from("tasks").update({ title: clean }).eq("id", task.id).eq("user_id", c.userId);
  return { ok: true, text: `✏️ “${task.title}” → “${clean}”`, title: clean };
}

// ---- Lists ---------------------------------------------------------------------------

const PAGE = 8;

/** /tasks: every open task, overdue and today first, 8 per page, with buttons. */
export async function taskListView(c: Ctx, page: number): Promise<{ text: string; kb: Kb }> {
  const [{ data }, types] = await Promise.all([
    c.admin
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .in("status", ["pending", "backlog"])
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at")
      .limit(400),
    getBlockTypes(c.admin, c.userId, { includeDeleted: true }),
  ]);
  const tasks = (data ?? []) as TaskDb[];
  if (!tasks.length) return { text: "✅ No open tasks. 🎉", kb: [] };
  const pages = Math.ceil(tasks.length / PAGE);
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = tasks.slice(p * PAGE, p * PAGE + PAGE);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const when = (t: TaskDb) => {
    if (!t.scheduled_for) return "no date";
    if (t.scheduled_for < c.today) return `⚠ from ${shortDay(t.scheduled_for)}`;
    if (t.scheduled_for === c.today) return "today";
    if (t.scheduled_for === addDays(c.today, 1)) return "tomorrow";
    return shortDay(t.scheduled_for);
  };
  const lines = slice.map((t) => {
    const home = t.home_block_type_id ? typeName.get(t.home_block_type_id) : null;
    const extra = [when(t), home ? `🧱 ${home}` : null, t.rolled_over_count > 0 ? `moved ${t.rolled_over_count}×` : null].filter(Boolean);
    return `• ${t.title} — ${extra.join(" · ")}`;
  });
  const overdue = tasks.filter((t) => t.scheduled_for && t.scheduled_for < c.today).length;
  const text = [
    `📋 Open tasks: ${tasks.length}${overdue ? ` (${overdue} overdue)` : ""} · page ${p + 1}/${pages}`,
    "",
    ...lines,
    "",
    "✓ done · ⏭ next time its block happens · ⋯ date, block, rename, archive",
  ].join("\n");
  const kb: Kb = taskRows(slice, PAGE);
  if (pages > 1) {
    kb.push([
      btn(p > 0 ? "◂ Prev" : "·", p > 0 ? `pl:${p - 1}` : `pl:${p}`),
      btn(`${p + 1}/${pages}`, `pl:${p}`),
      btn(p < pages - 1 ? "Next ▸" : "·", p < pages - 1 ? `pl:${p + 1}` : `pl:${p}`),
    ]);
  }
  return { text, kb };
}

/** /archived: the last archived tasks, each with ↩ Restore. */
export async function archivedView(c: Ctx): Promise<{ text: string; kb: Kb }> {
  const { data } = await c.admin
    .from("tasks")
    .select("id,title,archived_at")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .eq("status", "archived")
    .order("archived_at", { ascending: false })
    .limit(12);
  const rows = (data ?? []) as { id: string; title: string }[];
  if (!rows.length) return { text: "🗄 Nothing archived.", kb: [] };
  return {
    text: `🗄 Archived tasks (latest ${rows.length})\nTap one to bring it back for today.`,
    kb: rows.map((t) => [btn(`↩ ${t.title}`, `tr:${pk(t.id)}`)]),
  };
}
