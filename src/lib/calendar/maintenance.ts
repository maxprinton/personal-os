// End-of-day routine for calendar v2 (server only). Runs from the 5-minute cron job and,
// as a safety net, when the app loads. Idempotent: each day is closed once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dateRange, localNow } from "@/lib/time";
import { getOccurrences } from "@/lib/calendar/model";
import { getChecks, getHabits, recomputeOccurrenceStatus } from "@/lib/calendar/habits";

/** How far back a missed run catches up (older days are left as they are). */
const CATCH_UP_DAYS = 14;

/** Tasks part of closing a day and of the morning (filled in by phase 5). */
export async function closeDayTasks(sb: SupabaseClient, userId: string, date: string, today: string) {
  void sb;
  void userId;
  void date;
  void today;
}

export async function morningTasks(sb: SupabaseClient, userId: string, today: string) {
  void sb;
  void userId;
  void today;
}

/**
 * Closes one past day: every habit not marked in a block that happened becomes "missed"
 * (no questions asked), and each block gets its status (done / partial / scheduled = not done).
 */
export async function closeDay(sb: SupabaseClient, userId: string, date: string, today: string) {
  const [occurrences, habits, checks] = await Promise.all([
    getOccurrences(sb, userId, date, date),
    getHabits(sb, userId),
    getChecks(sb, userId, date, date),
  ]);
  const live = occurrences.filter((o) => o.date === date && o.status !== "cancelled" && o.status !== "free_day");
  const marked = new Set(checks.map((c) => `${c.habit_id}|${c.occurrence_id}`));
  const rows: Record<string, unknown>[] = [];
  for (const o of live) {
    for (const h of habits) {
      if (h.block_type_id !== o.block_type_id || h.active_from > date) continue;
      if (marked.has(`${h.id}|${o.id}`)) continue;
      rows.push({ user_id: userId, habit_id: h.id, occurrence_id: o.id, date, state: "missed", source: "auto" });
    }
  }
  if (rows.length) {
    await sb.from("habit_checks").upsert(rows, { onConflict: "habit_id,occurrence_id", ignoreDuplicates: true });
  }
  await closeDayTasks(sb, userId, date, today);
  for (const o of live) await recomputeOccurrenceStatus(sb, userId, o.id, today);
}

/**
 * Closes every day since the last run (up to yesterday) and prepares today.
 * The "closed through" date is claimed first, so two runs at once never close a day twice.
 */
export async function runMaintenance(sb: SupabaseClient, userId: string, timezone: string) {
  const today = localNow(timezone).date;
  const yesterday = addDays(today, -1);
  const { data: s } = await sb
    .from("user_settings")
    .select("calendar_closed_through")
    .eq("user_id", userId)
    .maybeSingle();
  const closed = (s?.calendar_closed_through as string | null | undefined) ?? null;
  if (closed && closed >= yesterday) return { closed: 0 };

  let claim = sb.from("user_settings").update({ calendar_closed_through: yesterday }).eq("user_id", userId);
  claim = closed ? claim.eq("calendar_closed_through", closed) : claim.is("calendar_closed_through", null);
  const { data: claimed } = await claim.select("user_id");
  if (!claimed?.length) return { closed: 0 }; // another run got there first

  let from = closed ? addDays(closed, 1) : yesterday;
  const floor = addDays(today, -CATCH_UP_DAYS);
  if (from < floor) from = floor;
  const days = dateRange(from, yesterday);
  for (const d of days) await closeDay(sb, userId, d, today);
  await morningTasks(sb, userId, today);
  return { closed: days.length };
}
