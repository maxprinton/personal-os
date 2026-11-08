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
// - Each block can choose "keep" (block_types.free_day_behavior): it then stays active on free days.
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

/** Blocks set to "keep" on free days. If migration 0047 isn't run yet there are none (nothing changes). */
export async function keepTypeIds(sb: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await sb
    .from("block_types")
    .select("id")
    .eq("user_id", userId)
    .eq("free_day_behavior", "keep")
    .is("deleted_at", null);
  if (error) return [];
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * A block just changed its "on free days" choice: bring today's and later free days in line, for that
 * block only. keep = its paused appearances come back (unless something you added sits in the way);
 * pause = its weekly appearances pause. Past days are never touched.
 */
export async function syncTypeWithFreeDays(
  sb: SupabaseClient,
  userId: string,
  typeId: string,
  behavior: "pause" | "keep",
  today: string
) {
  const { data: ranges } = await sb
    .from("free_days")
    .select("from_date,to_date")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("to_date", today);
  let changed = 0;
  for (const r of (ranges ?? []) as { from_date: string; to_date: string }[]) {
    const from = r.from_date > today ? r.from_date : today;
    if (behavior === "keep") {
      const occs = await getOccurrences(sb, userId, from, addDays(r.to_date, 1));
      const live: Occurrence[] = occs.filter((o) => o.status !== "cancelled" && o.status !== "free_day");
      const back: string[] = [];
      for (const o of occs) {
        if (o.block_type_id !== typeId || o.status !== "free_day" || o.date < from || o.date > r.to_date) continue;
        if (findOccurrenceConflict(o, live)) continue;
        back.push(o.id);
        live.push({ ...o, status: "scheduled" });
      }
      for (let i = 0; i < back.length; i += 200) {
        await sb.from("block_occurrences").update({ status: "scheduled" }).eq("user_id", userId).eq("status", "free_day").in("id", back.slice(i, i + 200));
      }
      changed += back.length;
    } else {
      await ensureOccurrences(sb, userId, from, r.to_date);
      const { data: paused } = await sb
        .from("block_occurrences")
        .update({ status: "free_day" })
        .eq("user_id", userId)
        .eq("block_type_id", typeId)
        .gte("date", from)
        .lte("date", r.to_date)
        .eq("status", "scheduled")
        .not("slot_id", "is", null)
        .select("id");
      const ids = ((paused ?? []) as { id: string }[]).map((o) => o.id);
      // Tasks sitting in a block that just paused wait in "unassigned"
      if (ids.length) await sb.from("tasks").update({ occurrence_id: null }).eq("user_id", userId).in("occurrence_id", ids);
      changed += ids.length;
    }
  }
  if (changed) await autoPlaceTasks(sb, userId, today);
  return changed;
}

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
  const keep = await keepTypeIds(sb, userId); // these blocks stay active on free days
  let pauseQ = sb
    .from("block_occurrences")
    .update({ status: "free_day" })
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "scheduled")
    .not("slot_id", "is", null);
  if (keep.length) pauseQ = pauseQ.not("block_type_id", "in", `(${keep.join(",")})`);
  const { data: paused } = await pauseQ.select("id");
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
