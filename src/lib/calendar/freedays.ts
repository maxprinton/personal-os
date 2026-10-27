// Free days (server only): pause the weekly blocks in a date range. Every query filters by user_id.
//
// Rules (decided 26 Oct 2026):
// - Only the blocks of the weekly pattern pause (status "free_day"). They are hidden in the
//   calendar and don't count for overlaps, so other blocks can be put in their place.
// - One-day blocks (added by hand) stay normal: habits, ticks and streaks work as usual.
// - Habits of paused blocks are not marked missed: streaks pause.
// - Only "migrate" tasks are rescheduled. Tasks tied to an event stay with the event.
// - Events and payments are never touched.
// - A block that starts the night before a free day follows its start day.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { ensureOccurrences, getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import { findOccurrenceConflict } from "@/lib/calendar/overlap";
import { autoPlaceTasks, nextOccurrenceAfter, TASK_COLS } from "@/lib/calendar/tasks";
import type { FreeDayPolicy, Occurrence } from "@/lib/calendar/types";

type TaskRow = {
  id: string;
  home_block_type_id: string | null;
  scheduled_for: string | null;
  occurrence_id: string | null;
  event_id: string | null;
  rollover_policy: string;
};

/**
 * Marks from..to as free: the weekly blocks pause and the tasks of those dates follow the policy.
 * `after` is the last free date of the whole range (when this piece is added to a longer one):
 * tasks go after it. None of this counts as a move.
 */
export async function applyFreeDays(
  sb: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  policy: FreeDayPolicy,
  today: string,
  rangeEnd: string = to
) {
  // Blocks: create the missing appearances, then pause the weekly ones not already done
  await ensureOccurrences(sb, userId, from, to);
  const { data: paused } = await sb
    .from("block_occurrences")
    .update({ status: "free_day" })
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "scheduled")
    .not("slot_id", "is", null)
    .select("id");
  const pausedIds = ((paused ?? []) as { id: string }[]).map((o) => o.id);
  // Past days marked free afterwards (edit-the-past window): the automatic "missed" marks go away,
  // so their streaks are paused instead of broken
  if (from < today && pausedIds.length) {
    await sb
      .from("habit_checks")
      .delete()
      .eq("user_id", userId)
      .eq("source", "auto")
      .eq("state", "missed")
      .in("occurrence_id", pausedIds);
  }

  // Tasks of those dates (and today's leftovers if the range starts today or earlier)
  let q = sb.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null).eq("status", "pending").lte("scheduled_for", to);
  q = from <= today ? q : q.gte("scheduled_for", from);
  const { data } = await q;
  const tasks = (data ?? []) as unknown as TaskRow[];
  const after = addDays(rangeEnd, 1);
  const pausedSet = new Set(pausedIds);
  let moved = 0;
  for (const t of tasks) {
    if (t.event_id) continue; // stays with its event (events are not paused)
    if (t.rollover_policy !== "migrate") {
      // Not rescheduled: it stays on its day, but out of a paused block (it waits in "unassigned")
      if (t.occurrence_id && pausedSet.has(t.occurrence_id)) {
        await sb.from("tasks").update({ occurrence_id: null }).eq("id", t.id).eq("user_id", userId);
      }
      continue;
    }
    let values: Record<string, unknown> = { scheduled_for: after, occurrence_id: null, event_id: null, hold_placement: false };
    if (policy === "unassigned") values = { ...values, hold_placement: true };
    if (policy === "home_block" && t.home_block_type_id) {
      const next = await nextOccurrenceAfter(sb, userId, t.home_block_type_id, rangeEnd);
      if (next) values = { ...values, scheduled_for: next.date, occurrence_id: next.id };
    }
    await sb.from("tasks").update(values).eq("id", t.id).eq("user_id", userId);
    moved++;
  }
  await autoPlaceTasks(sb, userId, today);
  return moved;
}

/**
 * Ends the free days from..to (only today and later; the past stays as it was): the paused
 * blocks come back. Blocks you added in their place win: a paused block that would overlap
 * one of them stays paused that day. Returns those that stayed paused (for a message).
 */
export async function undoFreeDays(sb: SupabaseClient, userId: string, from: string, to: string, today: string) {
  const start = from > today ? from : today;
  if (start > to) return [] as string[];
  // The next day too: a block coming back late at night can run into the next morning
  const occs = await getOccurrences(sb, userId, start, addDays(to, 1));
  const live: Occurrence[] = occs.filter((o) => o.status !== "cancelled" && o.status !== "free_day");
  const back: string[] = [];
  const kept: Occurrence[] = [];
  for (const o of occs) {
    if (o.status !== "free_day" || o.date < start || o.date > to) continue;
    if (findOccurrenceConflict(o, live)) kept.push(o);
    else {
      back.push(o.id);
      live.push({ ...o, status: "scheduled" });
    }
  }
  for (let i = 0; i < back.length; i += 200) {
    await sb
      .from("block_occurrences")
      .update({ status: "scheduled" })
      .eq("user_id", userId)
      .eq("status", "free_day")
      .in("id", back.slice(i, i + 200));
  }
  if (back.length) await autoPlaceTasks(sb, userId, today);
  if (!kept.length) return [];
  const names = new Map((await getBlockTypes(sb, userId)).map((t) => [t.id, t.name]));
  return kept.map((o) => `${names.get(o.block_type_id) ?? "Block"} ${o.date.slice(5)} ${o.start_time.slice(0, 5)}`);
}
