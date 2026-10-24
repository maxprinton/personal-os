// Free days (server only): pause every block in a date range. Every query filters by user_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { ensureOccurrences } from "@/lib/calendar/model";
import { autoPlaceTasks, nextOccurrenceAfter, TASK_COLS } from "@/lib/calendar/tasks";
import type { FreeDayPolicy } from "@/lib/calendar/types";

type TaskRow = { id: string; home_block_type_id: string | null; scheduled_for: string | null };

/**
 * Marks from..to as free: blocks become "free day" (dimmed, no missed habits, no nagging) and
 * the tasks of those dates follow the chosen policy. None of this counts as a move.
 */
export async function applyFreeDays(
  sb: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  policy: FreeDayPolicy,
  today: string
) {
  // Blocks: create the missing appearances, then pause the ones not already done
  await ensureOccurrences(sb, userId, from, to);
  const { data: paused } = await sb
    .from("block_occurrences")
    .update({ status: "free_day" })
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "scheduled")
    .select("id");
  // Past days marked free afterwards (edit-the-past window): the automatic "missed" marks go away,
  // so their streaks are paused instead of broken
  const pausedIds = ((paused ?? []) as { id: string }[]).map((o) => o.id);
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
  const after = addDays(to, 1);
  for (const t of tasks) {
    let values: Record<string, unknown> = { scheduled_for: after, occurrence_id: null, event_id: null, hold_placement: false };
    if (policy === "unassigned") values = { ...values, hold_placement: true };
    if (policy === "home_block" && t.home_block_type_id) {
      const next = await nextOccurrenceAfter(sb, userId, t.home_block_type_id, to);
      if (next) values = { ...values, scheduled_for: next.date, occurrence_id: next.id };
    }
    await sb.from("tasks").update(values).eq("id", t.id).eq("user_id", userId);
  }
  await autoPlaceTasks(sb, userId, today);
  return tasks.length;
}

/** Ends a free-day range: today's and future blocks in it come back. The past stays as it was. */
export async function undoFreeDays(sb: SupabaseClient, userId: string, from: string, to: string, today: string) {
  const start = from > today ? from : today;
  if (start > to) return;
  await sb
    .from("block_occurrences")
    .update({ status: "scheduled" })
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", to)
    .eq("status", "free_day");
}
