// Helpers for the daily facts (pure, no database): reading a clock time, deciding which day's row a bedtime belongs to,
// and small formatters shared by Telegram and the Insights page.
// The row of a day is the day you WAKE UP: bedtime of the night before and the wake-up time live on the same row.
import { addDays } from "@/lib/time";

/** "23:30", "11:30 pm", "7am", "7", "0715", "23h" -> minutes since midnight, or null when it is not a clock time. */
export function parseClock(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|h)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suffix = m[3];
  if (min > 59) return null;
  if (suffix === "am" || suffix === "pm") {
    if (h < 1 || h > 12) return null;
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

export type SleepSlot = {
  /** The row (the day you wake up) the bedtime is stored on. */
  rowDate: string;
  /** The calendar date the bedtime happened on. */
  bedDate: string;
  bedMinutes: number;
};

/**
 * Which row a bedtime belongs to. `clock` = minutes typed by the person, or null for "going to bed now".
 * Before noon the night that just ended is the one being logged; from noon on it is the coming night.
 */
export function sleepSlot(now: { date: string; minutes: number }, clock: number | null): SleepSlot {
  const morning = now.minutes < 12 * 60;
  const bedMinutes = clock ?? now.minutes;
  const tomorrow = addDays(now.date, 1);
  if (clock === null || clock >= 12 * 60) {
    // an evening time (or "now"): this morning it was last night, otherwise it is tonight
    if (clock === null) return morning ? { rowDate: now.date, bedDate: now.date, bedMinutes } : { rowDate: tomorrow, bedDate: now.date, bedMinutes };
    return morning ? { rowDate: now.date, bedDate: addDays(now.date, -1), bedMinutes } : { rowDate: tomorrow, bedDate: now.date, bedMinutes };
  }
  // after midnight (00:00 to 11:59): it happens on the morning of the row's own day
  return morning ? { rowDate: now.date, bedDate: now.date, bedMinutes } : { rowDate: tomorrow, bedDate: tomorrow, bedMinutes };
}

/** 435 -> "7h 15m", 60 -> "1h", 45 -> "45m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Minutes between two ISO instants, or null when one is missing or the order is wrong. */
export function sleepMinutes(bedtime: string | null, wakeAt: string | null): number | null {
  if (!bedtime || !wakeAt) return null;
  const d = (Date.parse(wakeAt) - Date.parse(bedtime)) / 60000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
}

export type HeatCell = "none" | "free" | "low" | "mid" | "good" | "great";

/** How a day looks in the consistency map. Free days stay quiet, unlogged days are empty. */
export function heatLevel(score: number | null, opts: { unlogged?: boolean; free?: boolean } = {}): HeatCell {
  if (score === null || opts.unlogged) return opts.free ? "free" : "none";
  if (score >= 85) return "great";
  if (score >= 70) return "good";
  if (score >= 40) return "mid";
  return "low";
}

/** Percent change text for a tile: "+12", "-5", or "—" when there is nothing to compare. */
export function deltaText(now: number | null, before: number | null): string {
  if (now === null || before === null) return "—";
  const d = Math.round(now - before);
  return d > 0 ? `+${d}` : `${d}`;
}

/** Rounds to one decimal and drops a trailing ".0". */
export function oneDecimal(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const r = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
