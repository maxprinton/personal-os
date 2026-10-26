// Tasks with a home block (server only). Every query filters by user_id explicitly.
// End of the day: an undone task (policy "migrate" = reschedule automatically) is logged as skipped on
// its day, counts +1, and goes to the next time its block happens; with no next appearance (or no block)
// it goes to the next day, out of any block. The morning ritual shows where each one went.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { ensureOccurrences, freeDatesBetween, getBlockTypes, getOccurrences, OCC_COLS } from "@/lib/calendar/model";
import type { CalTask, Occurrence, TaskLog } from "@/lib/calendar/types";

export const TASK_COLS =
  "id,title,status,scheduled_for,occurrence_id,event_id,home_block_type_id,rolled_over_count,rollover_policy,completed_at";

export type TaskDb = {
  id: string;
  title: string;
  status: CalTask["status"];
  scheduled_for: string | null;
  occurrence_id: string | null;
  event_id: string | null;
  home_block_type_id: string | null;
  rolled_over_count: number;
  rollover_policy: string;
  completed_at: string | null;
};

export function toCalTask(t: TaskDb): CalTask {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    scheduled_for: t.scheduled_for,
    occurrence_id: t.occurrence_id,
    event_id: t.event_id,
    home_block_type_id: t.home_block_type_id,
    moved: t.rolled_over_count,
  };
}

/** Tasks scheduled between from and to, plus today's unassigned leftovers, plus their skip logs. */
export async function getCalendarTasks(sb: SupabaseClient, userId: string, from: string, to: string, today: string) {
  const [inRange, overdue, logs] = await Promise.all([
    sb
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", ["pending", "completed"])
      .gte("scheduled_for", from)
      .lte("scheduled_for", to),
    from <= today && today <= to
      ? sb
          .from("tasks")
          .select(TASK_COLS)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .eq("status", "pending")
          .lt("scheduled_for", from)
      : Promise.resolve({ data: [] }),
    sb
      .from("task_day_log")
      .select("task_id,date,outcome,occurrence_id,event_id,tasks(title)")
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to),
  ]);
  const tasks = [...((inRange.data ?? []) as TaskDb[]), ...((overdue.data ?? []) as TaskDb[])].map(toCalTask);
  const taskLogs: TaskLog[] = ((logs.data ?? []) as unknown as (Omit<TaskLog, "title"> & { tasks: { title: string } | null })[]).map(
    (l) => ({
      task_id: l.task_id,
      title: l.tasks?.title ?? "Task",
      date: l.date,
      outcome: l.outcome,
      occurrence_id: l.occurrence_id,
      event_id: l.event_id,
    })
  );
  return { tasks, taskLogs };
}

export async function getTask(sb: SupabaseClient, userId: string, id: string) {
  const { data } = await sb.from("tasks").select(TASK_COLS).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as TaskDb | null) ?? null;
}

/** First live appearance of a block type on a date (created on demand). */
export async function firstOccurrenceOn(sb: SupabaseClient, userId: string, blockTypeId: string, date: string) {
  const occs = await getOccurrences(sb, userId, date, date);
  return (
    occs
      .filter((o) => o.date === date && o.block_type_id === blockTypeId && o.status !== "free_day")
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null
  );
}

/** Next live appearance of a block type after a date (looks up to 8 weeks ahead). */
export async function nextOccurrenceAfter(sb: SupabaseClient, userId: string, blockTypeId: string, after: string) {
  const from = addDays(after, 1);
  const to = addDays(after, 56);
  await ensureOccurrences(sb, userId, from, to);
  const { data } = await sb
    .from("block_occurrences")
    .select(OCC_COLS)
    .eq("user_id", userId)
    .eq("block_type_id", blockTypeId)
    .eq("status", "scheduled")
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .order("start_time")
    .limit(1);
  return ((data ?? []) as Occurrence[])[0] ?? null;
}

/** Bumps the "moved" counter and remembers the day it left (shown there as moved). */
export async function countMove(sb: SupabaseClient, userId: string, task: TaskDb, fromDate: string | null) {
  await sb
    .from("tasks")
    .update({ rolled_over_count: task.rolled_over_count + 1 })
    .eq("id", task.id)
    .eq("user_id", userId);
  if (fromDate) {
    await sb.from("task_day_log").upsert(
      {
        user_id: userId,
        task_id: task.id,
        date: fromDate,
        outcome: "moved",
        occurrence_id: task.occurrence_id,
        event_id: task.event_id,
      },
      { onConflict: "task_id,date", ignoreDuplicates: true }
    );
  }
}


/**
 * Puts tasks that have a home block into that block, on their own day, when it exists that day.
 * This automatic placement never counts as a move.
 */
export async function autoPlaceTasks(sb: SupabaseClient, userId: string, today: string) {
  const until = addDays(today, 62);
  const { data } = await sb
    .from("tasks")
    .select(TASK_COLS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "pending")
    .is("occurrence_id", null)
    .is("event_id", null)
    .not("home_block_type_id", "is", null)
    .eq("hold_placement", false) // a free day said "leave them unassigned"
    .gte("scheduled_for", today)
    .lte("scheduled_for", until);
  const tasks = (data ?? []) as TaskDb[];
  if (!tasks.length) return 0;
  const dates = [...new Set(tasks.map((t) => t.scheduled_for!))].sort();
  const occs = await getOccurrences(sb, userId, dates[0], dates[dates.length - 1]);
  let placed = 0;
  for (const t of tasks) {
    const occ = occs
      .filter((o) => o.date === t.scheduled_for && o.block_type_id === t.home_block_type_id && o.status !== "free_day")
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    if (!occ) continue;
    await sb.from("tasks").update({ occurrence_id: occ.id }).eq("id", t.id).eq("user_id", userId);
    placed++;
  }
  return placed;
}

/**
 * The block a task belongs to, for "next time it happens": the block it is placed in, else its home block.
 * `after` = look for appearances after this date (the task's day, or today if that is later).
 */
export async function rescheduleTarget(sb: SupabaseClient, userId: string, task: TaskDb, after: string) {
  let blockTypeId: string | null = null;
  if (task.occurrence_id) {
    const { data } = await sb
      .from("block_occurrences")
      .select("block_type_id")
      .eq("user_id", userId)
      .eq("id", task.occurrence_id)
      .maybeSingle();
    blockTypeId = (data?.block_type_id as string | undefined) ?? null;
  }
  blockTypeId = blockTypeId ?? task.home_block_type_id;
  if (!blockTypeId) return { blockTypeId: null, blockName: null, next: null };
  const [types, next] = await Promise.all([
    getBlockTypes(sb, userId, { includeDeleted: true }),
    nextOccurrenceAfter(sb, userId, blockTypeId, after),
  ]);
  const type = types.find((t) => t.id === blockTypeId);
  return { blockTypeId, blockName: type?.name ?? "its block", next: type?.removed ? null : next };
}

/**
 * End of a day: every pending "reschedule automatically" task still on that day (or earlier) is logged
 * as skipped there, its moved counter goes up by 1, and it goes to the next time its block happens.
 * No next appearance (or no block) → the next day, out of any block. Logging first makes it safe to run
 * twice: only newly logged tasks are counted. A free day just carries them forward (no log, no +1).
 */
export async function closeDayTasks(sb: SupabaseClient, userId: string, date: string) {
  const { data } = await sb
    .from("tasks")
    .select(TASK_COLS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "pending")
    .eq("rollover_policy", "migrate")
    .lte("scheduled_for", date);
  const tasks = (data ?? []) as TaskDb[];
  if (!tasks.length) return;
  const nextDay = addDays(date, 1);
  const freeDay = (await freeDatesBetween(sb, userId, date, date)).has(date);

  let fresh = new Set<string>();
  if (!freeDay) {
    const { data: logged } = await sb
      .from("task_day_log")
      .upsert(
        tasks.map((t) => ({
          user_id: userId,
          task_id: t.id,
          date,
          outcome: "skipped",
          occurrence_id: t.occurrence_id,
          event_id: t.event_id,
        })),
        { onConflict: "task_id,date", ignoreDuplicates: true }
      )
      .select("task_id");
    fresh = new Set(((logged ?? []) as { task_id: string }[]).map((r) => r.task_id));
  }

  for (const t of tasks) {
    const { next } = await rescheduleTarget(sb, userId, t, date);
    await sb
      .from("tasks")
      .update({
        scheduled_for: next ? next.date : nextDay,
        occurrence_id: next ? next.id : null,
        event_id: null,
        hold_placement: false,
        ...(fresh.has(t.id) ? { rolled_over_count: t.rolled_over_count + 1 } : {}),
      })
      .eq("id", t.id)
      .eq("user_id", userId);
  }
}

/** How many of today's pending tasks are in no block and no event (Telegram keeps reminding). */
export async function unassignedCount(sb: SupabaseClient, userId: string, today: string) {
  const { count } = await sb
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "pending")
    .is("occurrence_id", null)
    .is("event_id", null)
    .lte("scheduled_for", today);
  return count ?? 0;
}

export type RitualItem = {
  task: CalTask;
  outcome: "skipped" | "moved";
  placedIn: { occurrenceId: string; blockName: string; start: string; date: string } | null;
  homeName: string | null;
  homeToday: boolean;
  nextHome: { date: string; occurrenceId: string } | null;
};

/** The morning ritual: yesterday's undone tasks and where they are now. */
export async function getRitual(sb: SupabaseClient, userId: string, today: string) {
  const yesterday = addDays(today, -1);
  const [{ data: settings }, { data: logs }, types, occsToday] = await Promise.all([
    sb.from("user_settings").select("ritual_seen_on").eq("user_id", userId).maybeSingle(),
    sb.from("task_day_log").select("task_id,outcome").eq("user_id", userId).eq("date", yesterday).eq("outcome", "skipped"),
    getBlockTypes(sb, userId, { includeDeleted: true }),
    getOccurrences(sb, userId, today, today),
  ]);
  const ids = ((logs ?? []) as { task_id: string }[]).map((l) => l.task_id);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  let items: RitualItem[] = [];
  if (ids.length) {
    const { data } = await sb
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .in("id", ids)
      .is("deleted_at", null)
      .eq("status", "pending");
    const tasks = (data ?? []) as TaskDb[];
    // Where the end of the day sent them (any date, not only today)
    const occIds = tasks.map((t) => t.occurrence_id).filter((x): x is string => Boolean(x));
    const { data: occRows } = occIds.length
      ? await sb.from("block_occurrences").select(OCC_COLS).eq("user_id", userId).in("id", occIds)
      : { data: [] };
    const occById = new Map(((occRows ?? []) as Occurrence[]).map((o) => [o.id, o]));
    items = await Promise.all(
      tasks.map(async (t) => {
        const placed = t.occurrence_id ? occById.get(t.occurrence_id) : undefined;
        const homeToday = Boolean(
          t.home_block_type_id && occsToday.some((o) => o.date === today && o.block_type_id === t.home_block_type_id && o.status !== "free_day")
        );
        const next =
          t.home_block_type_id && !placed && !homeToday
            ? await nextOccurrenceAfter(sb, userId, t.home_block_type_id, today)
            : null;
        return {
          task: toCalTask(t),
          outcome: "skipped" as const,
          placedIn: placed
            ? { occurrenceId: placed.id, blockName: typeName.get(placed.block_type_id) ?? "Block", start: placed.start_time.slice(0, 5), date: placed.date }
            : null,
          homeName: t.home_block_type_id ? typeName.get(t.home_block_type_id) ?? null : null,
          homeToday,
          nextHome: next ? { date: next.date, occurrenceId: next.id } : null,
        };
      })
    );
  }
  const todayBlocks = occsToday
    .filter((o) => o.date === today && o.status !== "free_day")
    .map((o) => ({ occurrenceId: o.id, label: `${typeName.get(o.block_type_id) ?? "Block"} ${o.start_time.slice(0, 5)}` }));
  return {
    seen: (settings?.ritual_seen_on as string | null | undefined) === today,
    yesterday,
    items,
    todayBlocks,
    unassigned: await unassignedCount(sb, userId, today),
  };
}

/** Names for the task lists: home blocks, the block appearance a task is in, its event. */
export async function getTaskPlaces(
  sb: SupabaseClient,
  userId: string,
  tasks: { occurrence_id?: string | null; event_id?: string | null }[]
) {
  const occIds = [...new Set(tasks.map((t) => t.occurrence_id).filter((x): x is string => Boolean(x)))];
  const evIds = [...new Set(tasks.map((t) => t.event_id).filter((x): x is string => Boolean(x)))];
  const [types, occs, evs] = await Promise.all([
    getBlockTypes(sb, userId, { includeDeleted: true }),
    occIds.length
      ? sb.from("block_occurrences").select("id,block_type_id,start_time").eq("user_id", userId).in("id", occIds)
      : Promise.resolve({ data: [] }),
    evIds.length ? sb.from("events").select("id,title").eq("user_id", userId).in("id", evIds) : Promise.resolve({ data: [] }),
  ]);
  const blockName = new Map(types.map((t) => [t.id, t.name]));
  const placedIn = new Map(
    ((occs.data ?? []) as { id: string; block_type_id: string; start_time: string }[]).map((o) => [
      o.id,
      `${blockName.get(o.block_type_id) ?? "Block"} ${o.start_time.slice(0, 5)}`,
    ])
  );
  const eventName = new Map(((evs.data ?? []) as { id: string; title: string }[]).map((e) => [e.id, e.title]));
  return { blockName, placedIn, eventName };
}
