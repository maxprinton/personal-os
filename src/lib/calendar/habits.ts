// Habits inside blocks (server only). Every query filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { getBlockTypes, getOccurrences, OCC_COLS } from "@/lib/calendar/model";
import { habitRate, habitStreak, type Appearance } from "@/lib/calendar/streaks";
import { habitProgress, habitsForOccurrence } from "@/lib/calendar/habitview";
import type { Habit, HabitCheck, HabitState, Occurrence } from "@/lib/calendar/types";

export async function getHabits(sb: SupabaseClient, userId: string, opts: { includeRemoved?: boolean } = {}) {
  let q = sb.from("habits").select("id,name,block_type_id,active_from,deleted_at").eq("user_id", userId);
  if (!opts.includeRemoved) q = q.is("deleted_at", null);
  const { data } = await q.order("created_at");
  return ((data ?? []) as (Habit & { deleted_at: string | null })[]).map((h) => ({
    id: h.id,
    name: h.name,
    block_type_id: h.block_type_id,
    active_from: h.active_from,
    ...(h.deleted_at ? { removed: true } : {}),
  })) as Habit[];
}

export async function getChecks(sb: SupabaseClient, userId: string, from: string, to: string) {
  const { data } = await sb
    .from("habit_checks")
    .select("habit_id,occurrence_id,date,state")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to);
  return (data ?? []) as HabitCheck[];
}

/** Sets (or clears, with state = null) one habit mark on one occurrence. */
export async function setHabitCheck(
  sb: SupabaseClient,
  userId: string,
  habitId: string,
  occ: Pick<Occurrence, "id" | "date">,
  state: HabitState | null,
  source: "web" | "telegram" | "auto"
) {
  if (state === null) {
    return sb.from("habit_checks").delete().eq("user_id", userId).eq("habit_id", habitId).eq("occurrence_id", occ.id);
  }
  return sb
    .from("habit_checks")
    .upsert(
      { user_id: userId, habit_id: habitId, occurrence_id: occ.id, date: occ.date, state, source },
      { onConflict: "habit_id,occurrence_id" }
    );
}

/** Extra work counted in an occurrence's status (tasks; filled in by phase 5). */
export async function occurrenceTaskProgress(sb: SupabaseClient, userId: string, occ: Occurrence) {
  void sb;
  void userId;
  void occ;
  return { done: 0, total: 0 };
}

/**
 * done = everything in the block was done, partial = some of it, scheduled = none.
 * A block with nothing to measure keeps its status (it can be ticked by hand).
 */
export async function recomputeOccurrenceStatus(sb: SupabaseClient, userId: string, occId: string, today: string) {
  const { data } = await sb.from("block_occurrences").select(OCC_COLS).eq("user_id", userId).eq("id", occId).maybeSingle();
  const occ = data as Occurrence | null;
  if (!occ || occ.status === "cancelled" || occ.status === "free_day") return;
  const [habits, { data: marks }, tasks] = await Promise.all([
    getHabits(sb, userId, { includeRemoved: true }),
    sb.from("habit_checks").select("habit_id,occurrence_id,date,state").eq("user_id", userId).eq("occurrence_id", occ.id),
    occurrenceTaskProgress(sb, userId, occ),
  ]);
  const h = habitProgress(habitsForOccurrence(occ, habits, (marks ?? []) as HabitCheck[], today));
  const done = h.done + tasks.done;
  const total = h.total + tasks.total;
  if (total === 0) return;
  const status = done >= total ? "done" : done > 0 ? "partial" : "scheduled";
  if (status !== occ.status) {
    await sb.from("block_occurrences").update({ status }).eq("id", occ.id).eq("user_id", userId);
  }
}

// ---------- Summaries for the Habits and Today pages -------------------------

export type HabitSummary = {
  habit: Habit;
  blockName: string | null;
  blockColor: string | null;
  current: number;
  best: number;
  rate: number | null;
  skipsLeft: number;
  /** Last 14 appearances (one per block occurrence), oldest first. */
  recent: { date: string; state: HabitState | null }[];
  /** Today's appearances, to mark them. */
  today: { occurrenceId: string; start: string; state: HabitState | null }[];
};

export async function getHabitSummaries(sb: SupabaseClient, userId: string, today: string): Promise<HabitSummary[]> {
  const [habits, types, todayOccs, { data }] = await Promise.all([
    getHabits(sb, userId),
    getBlockTypes(sb, userId, { includeDeleted: true }),
    getOccurrences(sb, userId, today, today),
    sb
      .from("habit_checks")
      .select("habit_id,occurrence_id,date,state,block_occurrences(start_time)")
      .eq("user_id", userId)
      .gte("date", addDays(today, -365))
      .lte("date", today),
  ]);
  const checks = (data ?? []) as unknown as (HabitCheck & { block_occurrences: { start_time: string } | null })[];
  const typeById = new Map(types.map((t) => [t.id, t]));
  const occsToday = todayOccs.filter((o) => o.date === today && o.status !== "cancelled" && o.status !== "free_day");

  return habits.map((habit) => {
    const mine = checks.filter((c) => c.habit_id === habit.id);
    const appearances: Appearance[] = mine.map((c) => ({
      date: c.date,
      start: (c.block_occurrences?.start_time ?? "00:00").slice(0, 5),
      state: c.state,
    }));
    const todayList = occsToday
      .filter((o) => o.block_type_id === habit.block_type_id && habit.active_from <= today)
      .map((o) => ({
        occurrenceId: o.id,
        start: o.start_time.slice(0, 5),
        state: mine.find((c) => c.occurrence_id === o.id)?.state ?? null,
      }));
    for (const t of todayList) {
      if (t.state === null) appearances.push({ date: today, start: t.start, state: null });
    }
    appearances.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const s = habitStreak(appearances, today);
    const type = habit.block_type_id ? typeById.get(habit.block_type_id) : undefined;
    return {
      habit,
      blockName: type?.name ?? null,
      blockColor: type?.color ?? null,
      current: s.current,
      best: s.best,
      rate: habitRate(appearances, today),
      skipsLeft: s.skipsLeft,
      recent: appearances.slice(-14).map((a) => ({ date: a.date, state: a.state })),
      today: todayList,
    };
  });
}
