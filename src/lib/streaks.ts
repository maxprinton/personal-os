// Pure streak logic (no database). Rules:
// - completed  -> counts (+1)
// - skipped    -> justified: does not count and does not break the streak
// - failed     -> breaks the streak
// - no log     -> breaks the streak, except TODAY (the day is still in progress)

export type DayStatus = "completed" | "skipped" | "failed";

export function computeStreaks(
  scheduledDates: string[], // ascending YYYY-MM-DD, days the habit was due, up to today
  logs: Map<string, DayStatus>,
  today: string
) {
  let best = 0;
  let run = 0;
  for (const d of scheduledDates) {
    const s = logs.get(d);
    if (s === "completed") {
      run += 1;
      best = Math.max(best, run);
    } else if (s === "skipped") {
      continue;
    } else if (!s && d === today) {
      continue;
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let i = scheduledDates.length - 1; i >= 0; i--) {
    const d = scheduledDates[i];
    const s = logs.get(d);
    if (s === "completed") current += 1;
    else if (s === "skipped") continue;
    else if (!s && d === today) continue;
    else break;
  }
  return { current, best };
}

/** Completion rate over the scheduled days (skipped days excluded, today excluded if unlogged). */
export function completionRate(scheduledDates: string[], logs: Map<string, DayStatus>, today: string) {
  let due = 0;
  let done = 0;
  for (const d of scheduledDates) {
    const s = logs.get(d);
    if (s === "skipped" || (!s && d === today)) continue;
    due += 1;
    if (s === "completed") done += 1;
  }
  return due ? Math.round((done / due) * 100) : null;
}
