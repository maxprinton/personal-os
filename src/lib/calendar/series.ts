// Recurring tasks that repeat AFTER being done (server only). A "series" is the template; it keeps at most ONE
// open task (series.current_task_id). Marking that task done creates the next one, due (day it was finished +
// interval), exactly on that day: in its home block when the block exists that day, otherwise unassigned.
// Works with the signed-in client and with the admin client (Telegram / cron), so every query filters by user_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addInterval, describeRepeat, type RepeatUnit } from "@/lib/calendar/recurrence";
import { getBlockTypes } from "@/lib/calendar/model";
import { autoPlaceTasks, getTask } from "@/lib/calendar/tasks";
import { daysBetween, localNow, utcToLocal } from "@/lib/time";

export type SeriesUnit = Exclude<RepeatUnit, "none">;
export type SeriesPolicy = "migrate" | "backlog";

export type Series = {
  id: string;
  title: string;
  home_block_type_id: string | null;
  rollover_policy: SeriesPolicy;
  repeat_unit: SeriesUnit;
  repeat_every: number;
  mode: string;
  active: boolean;
  current_task_id: string | null;
  last_done_task_id: string | null;
  last_done_on: string | null;
};

export const SERIES_COLS =
  "id,title,home_block_type_id,rollover_policy,repeat_unit,repeat_every,mode,active,current_task_id,last_done_task_id,last_done_on";

const UNITS: readonly string[] = ["days", "weeks", "months", "years"];
export const cleanUnit = (u: unknown): SeriesUnit => (UNITS.includes(String(u)) ? (String(u) as SeriesUnit) : "days");
export const cleanEvery = (n: unknown) => Math.min(366, Math.max(1, Math.floor(Number(n) || 1)));
export const cleanPolicy = (p: unknown): SeriesPolicy => (p === "backlog" ? "backlog" : "migrate");

/** "Every 3 days after done" */
export function describeSeries(unit: SeriesUnit, every: number) {
  return `${describeRepeat(unit, every)} after done`;
}

export function shortDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export type SpawnResult = { seriesId: string; taskId: string; title: string; due: string; blockName: string | null };

/** "Next: Fri, Nov 13 · in Cleaning" */
export function nextText(r: SpawnResult) {
  return `Next: ${shortDay(r.due)}${r.blockName ? ` · in ${r.blockName}` : ""}`;
}

const isOpenStatus = (s: string) => s === "pending" || s === "backlog";

export async function getSeries(sb: SupabaseClient, userId: string, id: string) {
  const { data } = await sb.from("task_series").select(SERIES_COLS).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as Series | null) ?? null;
}

export async function listSeries(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("task_series").select(SERIES_COLS).eq("user_id", userId).is("deleted_at", null).order("created_at");
  return ((data ?? []) as Series[]).map((s) => ({ ...s }));
}

/** Copies the live tags of one task to another (explicit user_id: works with the admin client). */
async function copyTags(sb: SupabaseClient, userId: string, fromTaskId: string, toTaskId: string) {
  const { data } = await sb
    .from("entity_tags")
    .select("tag_id")
    .eq("user_id", userId)
    .eq("entity_type", "task")
    .eq("entity_id", fromTaskId)
    .is("deleted_at", null);
  const rows = ((data ?? []) as { tag_id: string }[]).map((r) => ({ user_id: userId, tag_id: r.tag_id, entity_type: "task", entity_id: toTaskId }));
  if (rows.length) await sb.from("entity_tags").insert(rows);
}

async function createInstance(sb: SupabaseClient, userId: string, s: Series, due: string, copyTagsFrom?: string | null) {
  const { data, error } = await sb
    .from("tasks")
    .insert({
      user_id: userId,
      title: s.title,
      status: "pending",
      scheduled_for: due,
      rollover_policy: s.rollover_policy,
      home_block_type_id: s.home_block_type_id,
      series_id: s.id,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = data.id as string;
  if (copyTagsFrom) await copyTags(sb, userId, copyTagsFrom, id);
  return id;
}

/** After autoPlaceTasks: the name of the block the new task went into (null = it stays on its day with no block). */
async function placedBlockName(sb: SupabaseClient, userId: string, taskId: string, homeId: string | null) {
  if (!homeId) return null;
  const { data } = await sb.from("tasks").select("occurrence_id").eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (!data?.occurrence_id) return null;
  const types = await getBlockTypes(sb, userId, { includeDeleted: true });
  return types.find((t) => t.id === homeId)?.name ?? null;
}

/**
 * Creates the next task of a series from a finished one. `claimFrom` = the task the series is waiting on
 * (normal case) or null (healing: the series has no open task). The claim is one atomic UPDATE, so a double tap
 * or two completion paths at once never create two tasks.
 */
async function spawnFrom(
  sb: SupabaseClient,
  userId: string,
  timezone: string,
  s: Series,
  done: { id: string; completed_at: string },
  claimFrom: string | null
): Promise<SpawnResult | null> {
  const today = localNow(timezone).date;
  const completedOn = utcToLocal(done.completed_at, timezone).date;
  let claim = sb
    .from("task_series")
    .update({ current_task_id: null, last_done_task_id: done.id, last_done_on: completedOn })
    .eq("id", s.id)
    .eq("user_id", userId)
    .eq("active", true)
    .is("deleted_at", null);
  claim = claimFrom ? claim.eq("current_task_id", claimFrom) : claim.is("current_task_id", null);
  const { data: claimed } = await claim.select("id");
  if (!claimed?.length) return null; // another run got there first (or the series was paused)

  let due = addInterval(completedOn, s.repeat_unit, s.repeat_every);
  if (due < today) due = today; // finished long ago (edited afterwards): past days can't receive new tasks
  const taskId = await createInstance(sb, userId, s, due, done.id);
  if (!taskId) return null; // the series now waits with no open task: healSeries() retries it from the cron
  await sb.from("task_series").update({ current_task_id: taskId }).eq("id", s.id).eq("user_id", userId);
  await autoPlaceTasks(sb, userId, today);
  return { seriesId: s.id, taskId, title: s.title, due, blockName: await placedBlockName(sb, userId, taskId, s.home_block_type_id) };
}

/** A task was just marked done: if it is the open task of an active series, the next one is created. */
export async function spawnNextForCompleted(sb: SupabaseClient, userId: string, timezone: string, taskId: string) {
  const { data: t } = await sb
    .from("tasks")
    .select("id,series_id,status,completed_at")
    .eq("id", taskId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!t?.series_id || t.status !== "completed") return null;
  const s = await getSeries(sb, userId, t.series_id as string);
  if (!s || !s.active) return null;
  return spawnFrom(sb, userId, timezone, s, { id: t.id as string, completed_at: (t.completed_at as string | null) ?? new Date().toISOString() }, taskId);
}

/**
 * A done task was reopened. If the series had already created its next task and that one is untouched
 * (pending, never moved), it is removed and the reopened task is the open one again.
 */
export async function undoSpawn(sb: SupabaseClient, userId: string, taskId: string) {
  const { data: t } = await sb.from("tasks").select("id,series_id").eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (!t?.series_id) return { restored: false };
  const s = await getSeries(sb, userId, t.series_id as string);
  if (!s || s.last_done_task_id !== taskId) return { restored: false }; // an older task of the series: nothing to undo
  if (s.current_task_id && s.current_task_id !== taskId) {
    const next = await getTask(sb, userId, s.current_task_id);
    if (next && !(next.status === "pending" && next.rolled_over_count === 0)) return { restored: false }; // already in use: keep it
    if (next) {
      const now = new Date().toISOString();
      await sb.from("tasks").update({ deleted_at: now }).eq("id", next.id).eq("user_id", userId);
      await sb.from("entity_tags").update({ deleted_at: now }).eq("user_id", userId).eq("entity_type", "task").eq("entity_id", next.id);
    }
  }
  await sb
    .from("task_series")
    .update({ current_task_id: taskId, last_done_task_id: null, last_done_on: null })
    .eq("id", s.id)
    .eq("user_id", userId);
  return { restored: true };
}

/**
 * Convenience for every place that ticks / unticks a task. Never throws: before migration 0060 is run
 * (no series_id column) it simply does nothing, so completing tasks keeps working.
 */
export async function syncSeriesOnToggle(sb: SupabaseClient, userId: string, timezone: string, taskId: string, done: boolean) {
  try {
    if (done) return { next: await spawnNextForCompleted(sb, userId, timezone, taskId), restored: false };
    return { next: null, restored: (await undoSpawn(sb, userId, taskId)).restored };
  } catch {
    return { next: null as SpawnResult | null, restored: false };
  }
}

/**
 * The open task of a series was archived or deleted: the series pauses (so it never silently comes back).
 * Resume it from Tasks → Recurring.
 */
export async function pauseIfOpenDropped(sb: SupabaseClient, userId: string, taskId: string) {
  try {
    const { data: t } = await sb.from("tasks").select("series_id").eq("id", taskId).eq("user_id", userId).maybeSingle();
    if (!t?.series_id) return { paused: false as const };
    const s = await getSeries(sb, userId, t.series_id as string);
    if (!s || s.current_task_id !== taskId) return { paused: false as const };
    await sb.from("task_series").update({ active: false, current_task_id: null }).eq("id", s.id).eq("user_id", userId);
    return { paused: true as const, title: s.title };
  } catch {
    return { paused: false as const };
  }
}

/** "Skip this time": archives the open task and creates the next one due (today + interval). */
export async function skipCurrent(sb: SupabaseClient, userId: string, timezone: string, taskId: string) {
  const task = await getTask(sb, userId, taskId);
  if (!task || !isOpenStatus(task.status)) return null;
  const { data: t } = await sb.from("tasks").select("series_id").eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (!t?.series_id) return null;
  const s = await getSeries(sb, userId, t.series_id as string);
  if (!s || s.current_task_id !== taskId) return null;
  const today = localNow(timezone).date;
  await sb
    .from("tasks")
    .update({ status: "archived", archived_at: new Date().toISOString(), occurrence_id: null, event_id: null })
    .eq("id", taskId)
    .eq("user_id", userId);
  await sb.from("task_series").update({ current_task_id: null }).eq("id", s.id).eq("user_id", userId);
  const due = addInterval(today, s.repeat_unit, s.repeat_every);
  const newId = await createInstance(sb, userId, s, due, taskId);
  if (!newId) return null;
  await sb.from("task_series").update({ current_task_id: newId, active: true }).eq("id", s.id).eq("user_id", userId);
  await autoPlaceTasks(sb, userId, today);
  return { seriesId: s.id, taskId: newId, title: s.title, due, blockName: await placedBlockName(sb, userId, newId, s.home_block_type_id), occurrenceId: task.occurrence_id };
}

export type NewSeries = {
  title: string;
  homeBlockId?: string | null;
  policy?: unknown;
  unit?: unknown;
  every?: unknown;
  /** Day of the first task (default today; never in the past). */
  firstDue?: string | null;
};

/** Creates a series and its first task. */
export async function createSeries(sb: SupabaseClient, userId: string, timezone: string, input: NewSeries) {
  const title = (input.title ?? "").trim().slice(0, 300);
  if (!title) return { error: "Title is required." as const };
  const today = localNow(timezone).date;
  let due = input.firstDue && /^\d{4}-\d{2}-\d{2}$/.test(input.firstDue) ? input.firstDue : today;
  if (due < today) due = today;
  const { data, error } = await sb
    .from("task_series")
    .insert({
      user_id: userId,
      title,
      home_block_type_id: input.homeBlockId || null,
      rollover_policy: cleanPolicy(input.policy),
      repeat_unit: cleanUnit(input.unit),
      repeat_every: cleanEvery(input.every),
    })
    .select(SERIES_COLS)
    .single();
  if (error || !data) {
    if (/task_series|series_id/i.test(error?.message ?? "")) return { error: "Recurring tasks need a one-time database update: run MIGRACION-0060-tareas-recurrentes.sql in Supabase." as const };
    return { error: (error?.message ?? "Could not create the series.") as string };
  }
  const s = data as Series;
  const taskId = await createInstance(sb, userId, s, due);
  if (!taskId) return { error: "The series was saved but its first task could not be created." as const };
  await sb.from("task_series").update({ current_task_id: taskId }).eq("id", s.id).eq("user_id", userId);
  await autoPlaceTasks(sb, userId, today);
  return { seriesId: s.id, taskId, due };
}

/** Makes an existing open task the first task of a new series (or changes the interval if it already is one). */
export async function makeTaskRecurring(sb: SupabaseClient, userId: string, taskId: string, input: { unit?: unknown; every?: unknown }) {
  const { data: t } = await sb
    .from("tasks")
    .select("id,title,status,home_block_type_id,rollover_policy,series_id")
    .eq("id", taskId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!t) return { error: "That task no longer exists." as const };
  if (t.series_id) {
    const r = await updateSeries(sb, userId, t.series_id as string, { unit: input.unit, every: input.every });
    if (r.error) return { error: r.error };
    return { seriesId: t.series_id as string };
  }
  if (!isOpenStatus(t.status as string)) return { error: "Only an open task can start repeating." as const };
  const policy = cleanPolicy(t.rollover_policy);
  const { data, error } = await sb
    .from("task_series")
    .insert({
      user_id: userId,
      title: t.title,
      home_block_type_id: t.home_block_type_id ?? null,
      rollover_policy: policy,
      repeat_unit: cleanUnit(input.unit),
      repeat_every: cleanEvery(input.every),
      current_task_id: t.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (/task_series|series_id/i.test(error?.message ?? "")) return { error: "Recurring tasks need a one-time database update: run MIGRACION-0060-tareas-recurrentes.sql in Supabase." as const };
    return { error: (error?.message ?? "Could not start the series.") as string };
  }
  await sb.from("tasks").update({ series_id: data.id, rollover_policy: policy }).eq("id", t.id).eq("user_id", userId);
  return { seriesId: data.id as string };
}

/** Title, home block, policy and interval. The open task follows (title, block, policy); the interval applies from the next one. */
export async function updateSeries(
  sb: SupabaseClient,
  userId: string,
  seriesId: string,
  patch: { title?: string; homeBlockId?: string | null; policy?: unknown; unit?: unknown; every?: unknown },
  timezone = "America/Guayaquil"
) {
  const s = await getSeries(sb, userId, seriesId);
  if (!s) return { error: "That recurring task no longer exists." as const };
  const values: Record<string, unknown> = {};
  const taskValues: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 300);
    if (!title) return { error: "Title is required." as const };
    values.title = title;
    taskValues.title = title;
  }
  if (patch.homeBlockId !== undefined) {
    values.home_block_type_id = patch.homeBlockId || null;
    taskValues.home_block_type_id = patch.homeBlockId || null;
    taskValues.occurrence_id = null;
  }
  if (patch.policy !== undefined) {
    values.rollover_policy = cleanPolicy(patch.policy);
    taskValues.rollover_policy = cleanPolicy(patch.policy);
  }
  if (patch.unit !== undefined) values.repeat_unit = cleanUnit(patch.unit);
  if (patch.every !== undefined) values.repeat_every = cleanEvery(patch.every);
  if (Object.keys(values).length) {
    const { error } = await sb.from("task_series").update(values).eq("id", seriesId).eq("user_id", userId);
    if (error) return { error: error.message };
  }
  if (s.current_task_id && Object.keys(taskValues).length) {
    await sb.from("tasks").update(taskValues).eq("id", s.current_task_id).eq("user_id", userId).in("status", ["pending", "backlog"]);
    if ("home_block_type_id" in taskValues) await autoPlaceTasks(sb, userId, localNow(timezone).date);
  }
  return { ok: true as const };
}

export async function pauseSeries(sb: SupabaseClient, userId: string, seriesId: string) {
  const { error } = await sb.from("task_series").update({ active: false }).eq("id", seriesId).eq("user_id", userId).is("deleted_at", null);
  return error ? { error: error.message } : { ok: true as const };
}

/** Resume: if the series has no open task any more, one is created (due today, or the given day). */
export async function resumeSeries(sb: SupabaseClient, userId: string, timezone: string, seriesId: string, due?: string | null) {
  const s = await getSeries(sb, userId, seriesId);
  if (!s) return { error: "That recurring task no longer exists." as const };
  const today = localNow(timezone).date;
  await sb.from("task_series").update({ active: true }).eq("id", seriesId).eq("user_id", userId);
  const current = s.current_task_id ? await getTask(sb, userId, s.current_task_id) : null;
  if (current && isOpenStatus(current.status)) return { ok: true as const, created: false as const };
  let day = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : today;
  if (day < today) day = today;
  const taskId = await createInstance(sb, userId, s, day, s.last_done_task_id);
  if (!taskId) return { error: "Could not create the task." as const };
  await sb.from("task_series").update({ current_task_id: taskId }).eq("id", seriesId).eq("user_id", userId);
  await autoPlaceTasks(sb, userId, today);
  return { ok: true as const, created: true as const, taskId, due: day };
}

/** Stops repeating for good. The open task stays as a normal one-off task. */
export async function endSeries(sb: SupabaseClient, userId: string, seriesId: string) {
  await sb
    .from("tasks")
    .update({ series_id: null })
    .eq("user_id", userId)
    .eq("series_id", seriesId)
    .in("status", ["pending", "backlog"]);
  const { error } = await sb
    .from("task_series")
    .update({ deleted_at: new Date().toISOString(), active: false, current_task_id: null })
    .eq("id", seriesId)
    .eq("user_id", userId);
  return error ? { error: error.message } : { ok: true as const };
}

/**
 * Safety net (every 5 minutes, from the cron): an active series with no open task whose last task is done
 * gets its next task. Covers any completion path that did not create it (or a failed insert).
 * Series touched in the last 2 minutes are left alone: they may be in the middle of creating it.
 */
export async function healSeries(sb: SupabaseClient, userId: string, timezone: string, nowMs = Date.now()) {
  const cutoff = new Date(nowMs - 2 * 60_000).toISOString();
  const { data } = await sb
    .from("task_series")
    .select(SERIES_COLS)
    .eq("user_id", userId)
    .eq("active", true)
    .is("deleted_at", null)
    .is("current_task_id", null)
    .lt("updated_at", cutoff);
  let made = 0;
  for (const s of (data ?? []) as Series[]) {
    if (!s.last_done_task_id) continue;
    const { data: t } = await sb.from("tasks").select("id,status,completed_at").eq("id", s.last_done_task_id).eq("user_id", userId).maybeSingle();
    if (!t || t.status !== "completed" || !t.completed_at) continue;
    const r = await spawnFrom(sb, userId, timezone, s, { id: t.id as string, completed_at: t.completed_at as string }, null);
    if (r) made++;
  }
  return made;
}

/**
 * An archived task of a paused series came back (Restore): it is the open task again and the series resumes.
 * Does nothing when the series already moved on (skip this time) or the task is not part of a series.
 */
export async function adoptRestored(sb: SupabaseClient, userId: string, taskId: string) {
  try {
    const { data: t } = await sb.from("tasks").select("series_id").eq("id", taskId).eq("user_id", userId).maybeSingle();
    if (!t?.series_id) return false;
    const s = await getSeries(sb, userId, t.series_id as string);
    if (!s || s.current_task_id) return false;
    await sb.from("task_series").update({ current_task_id: taskId, active: true }).eq("id", s.id).eq("user_id", userId);
    return true;
  } catch {
    return false;
  }
}

// ---------- What the screens show ----------

/** What a task row needs to show "↻ Every 3 days after done". */
export type SeriesBrief = { id: string; label: string; unit: SeriesUnit; every: number; active: boolean };

/**
 * Task id -> its series, for the task lists. Separate from the tasks query on purpose: before migration 0060
 * is run it returns an empty map (never an error), so the lists keep working.
 */
export async function getSeriesBriefs(sb: SupabaseClient, userId: string, taskIds: string[]) {
  const out = new Map<string, SeriesBrief>();
  if (!taskIds.length) return out;
  try {
    const { data: rows, error } = await sb.from("tasks").select("id,series_id").eq("user_id", userId).in("id", taskIds);
    if (error) return out;
    const links = ((rows ?? []) as { id: string; series_id: string | null }[]).filter((r) => r.series_id);
    if (!links.length) return out;
    const ids = [...new Set(links.map((r) => r.series_id as string))];
    const { data: ss } = await sb.from("task_series").select(SERIES_COLS).eq("user_id", userId).is("deleted_at", null).in("id", ids);
    const byId = new Map(((ss ?? []) as Series[]).map((x) => [x.id, x]));
    for (const l of links) {
      const x = byId.get(l.series_id as string);
      if (x) out.set(l.id, { id: x.id, label: describeSeries(x.repeat_unit, x.repeat_every), unit: x.repeat_unit, every: x.repeat_every, active: x.active });
    }
  } catch {
    // no migration yet
  }
  return out;
}

/** The mean number of days between finished dates (any order), one decimal; null with fewer than two. */
export function avgGapDays(dates: string[]) {
  const d = [...new Set(dates)].sort();
  if (d.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < d.length; i++) sum += daysBetween(d[i - 1], d[i]);
  return Math.round((sum / (d.length - 1)) * 10) / 10;
}

/**
 * One line for the Recurring list. The due day is "last done + interval" (not the task's own day, which
 * rollover keeps moving), so lateness is honest.
 */
export function seriesStatusLine(
  s: Pick<Series, "active" | "repeat_unit" | "repeat_every" | "last_done_on">,
  open: { scheduled_for: string | null } | null,
  today: string
): { text: string; late: boolean } {
  if (!s.active) return { text: "Paused", late: false };
  if (!open) return { text: "No open task yet (it appears within minutes)", late: false };
  const expected = s.last_done_on ? addInterval(s.last_done_on, s.repeat_unit, s.repeat_every) : open.scheduled_for;
  if (!expected) return { text: "Open, no date", late: false };
  const late = daysBetween(expected, today);
  if (late > 0) return { text: `Overdue by ${late} day${late === 1 ? "" : "s"} · was due ${shortDay(expected)}`, late: true };
  if (late === 0) return { text: "Due today", late: false };
  return { text: `Due ${shortDay(expected)}`, late: false };
}

export type SeriesView = {
  series: Series;
  open: { id: string; scheduled_for: string | null; status: string; moved: number } | null;
  status: string;
  late: boolean;
  /** Last 10 days it was done (newest first). */
  history: string[];
  avgGap: number | null;
};

export async function loadSeriesViews(sb: SupabaseClient, userId: string, timezone: string): Promise<SeriesView[]> {
  const list = await listSeries(sb, userId);
  if (!list.length) return [];
  const today = localNow(timezone).date;
  const openIds = list.map((x) => x.current_task_id).filter((x): x is string => Boolean(x));
  const [openRes, doneRes] = await Promise.all([
    openIds.length
      ? sb.from("tasks").select("id,scheduled_for,status,rolled_over_count").eq("user_id", userId).is("deleted_at", null).in("id", openIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sb
      .from("tasks")
      .select("series_id,completed_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("status", "completed")
      .in("series_id", list.map((x) => x.id))
      .order("completed_at", { ascending: false })
      .limit(400),
  ]);
  const openById = new Map(((openRes.data ?? []) as { id: string; scheduled_for: string | null; status: string; rolled_over_count: number }[]).map((t) => [t.id, t]));
  const doneBy = new Map<string, string[]>();
  for (const r of (doneRes.data ?? []) as { series_id: string; completed_at: string | null }[]) {
    if (!r.completed_at) continue;
    const arr = doneBy.get(r.series_id) ?? [];
    arr.push(utcToLocal(r.completed_at, timezone).date);
    doneBy.set(r.series_id, arr);
  }
  return list.map((x) => {
    const t = x.current_task_id ? openById.get(x.current_task_id) : undefined;
    const open = t && isOpenStatus(t.status) ? { id: t.id, scheduled_for: t.scheduled_for, status: t.status, moved: t.rolled_over_count } : null;
    const dates = doneBy.get(x.id) ?? [];
    const line = seriesStatusLine(x, open, today);
    return { series: x, open, status: line.text, late: line.late, history: dates.slice(0, 10), avgGap: avgGapDays(dates) };
  });
}
