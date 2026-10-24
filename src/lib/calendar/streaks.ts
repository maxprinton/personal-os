// Habit streaks for calendar v2 (pure, no database). Rules from the spec:
// - every appearance of the habit's block is one mark (two blocks in a day = two marks)
// - done     -> +1, resets the skip run
// - skipped  -> on purpose: keeps the streak, but only 3 in a row; the 4th breaks it
// - missed   -> breaks the streak (unmarked appearances become "missed" at the end of the day)
// - free day -> pauses: neither breaks nor adds, and does not count toward the skip limit
// - today's unmarked appearances are still pending (ignored)
import type { HabitState } from "@/lib/calendar/types";

export const SKIP_LIMIT = 3;

export type Appearance = {
  date: string;
  start: string; // HH:MM, orders two appearances on the same day
  state: HabitState | null;
  freeDay?: boolean;
};

export function habitStreak(appearances: Appearance[], today: string) {
  const list = appearances
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  let run = 0;
  let best = 0;
  let skips = 0;
  for (const a of list) {
    if (a.freeDay) continue;
    const state = a.state ?? (a.date < today ? "missed" : null);
    if (state === null) continue; // pending today
    if (state === "done") {
      run += 1;
      skips = 0;
      best = Math.max(best, run);
    } else if (state === "skipped") {
      skips += 1;
      if (skips > SKIP_LIMIT) run = 0;
    } else {
      run = 0;
      skips = 0;
    }
  }
  return { current: run, best, skipsInARow: skips, skipsLeft: Math.max(0, SKIP_LIMIT - skips) };
}

/** Share of done marks among the last `n` decided ones (skips and free days excluded). */
export function habitRate(appearances: Appearance[], today: string, n = 30) {
  const decided = appearances
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .filter((a) => !a.freeDay)
    .map((a) => a.state ?? (a.date < today ? "missed" : null))
    .filter((s): s is "done" | "missed" => s === "done" || s === "missed");
  const lastN = decided.slice(-n);
  if (!lastN.length) return null;
  return Math.round((lastN.filter((s) => s === "done").length / lastN.length) * 100);
}
