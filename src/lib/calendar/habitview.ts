// Which habits belong to a block occurrence (pure; used by the server and the browser).
import type { Habit, HabitCheck, HabitState, Occurrence } from "@/lib/calendar/types";

export type OccurrenceHabit = { habit: Habit; state: HabitState | null };

/**
 * Past days show exactly what was recorded (their marks), so changing a block's habits
 * "from today on" never rewrites history. Today and later show the block's current habits.
 */
export function habitsForOccurrence(
  occ: Pick<Occurrence, "id" | "date" | "block_type_id" | "status">,
  habits: Habit[],
  checks: HabitCheck[],
  today: string
): OccurrenceHabit[] {
  const marks = checks.filter((c) => c.occurrence_id === occ.id);
  const byId = new Map(habits.map((h) => [h.id, h]));
  if (occ.date < today) {
    return marks
      .map((c) => ({ habit: byId.get(c.habit_id), state: c.state }))
      .filter((x): x is OccurrenceHabit => Boolean(x.habit));
  }
  const current = habits.filter(
    (h) => !h.removed && h.block_type_id === occ.block_type_id && h.active_from <= occ.date
  );
  const state = new Map(marks.map((c) => [c.habit_id, c.state]));
  const out: OccurrenceHabit[] = current.map((habit) => ({ habit, state: state.get(habit.id) ?? null }));
  // Marks of habits that moved to another block today still show where they were made
  for (const c of marks) {
    if (!current.some((h) => h.id === c.habit_id) && byId.get(c.habit_id)) {
      out.push({ habit: byId.get(c.habit_id)!, state: c.state });
    }
  }
  return out;
}

/** "2/3" style progress of an occurrence's habits (skips don't count against it). */
export function habitProgress(list: OccurrenceHabit[]) {
  const counted = list.filter((x) => x.state !== "skipped");
  return { done: counted.filter((x) => x.state === "done").length, total: counted.length, all: list.length };
}
