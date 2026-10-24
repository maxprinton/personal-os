// "Every N days / weeks / months / years" (pure). Idea taken from the LifeOS prototype's events.
import { dateRange, daysBetween } from "@/lib/time";

export type RepeatUnit = "none" | "days" | "weeks" | "months" | "years";

function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
}

/** Does a series starting on `start` fall on `date`? Months clamp to the month's last day (31 -> 30/28). */
export function repeatsOn(start: string, unit: RepeatUnit, every: number, date: string, end?: string | null) {
  if (date < start || (end && date > end)) return false;
  if (unit === "none") return date === start;
  const n = Math.max(1, Math.floor(every));
  if (unit === "days" || unit === "weeks") {
    const step = unit === "days" ? n : 7 * n;
    return daysBetween(start, date) % step === 0;
  }
  const [sy, sm, sd] = start.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  const monthsApart = (y - sy) * 12 + (m - sm);
  if (unit === "years") {
    if (m !== sm || (y - sy) % n !== 0) return false;
  } else if (monthsApart % n !== 0) {
    return false;
  }
  return d === Math.min(sd, lastDayOfMonth(y, m));
}

/** Every date of the series between from and to. */
export function repeatDates(start: string, unit: RepeatUnit, every: number, from: string, to: string, end?: string | null) {
  if (unit === "none") return start >= from && start <= to ? [start] : [];
  const a = from > start ? from : start;
  const b = end && end < to ? end : to;
  if (b < a) return [];
  return dateRange(a, b).filter((d) => repeatsOn(start, unit, every, d, end));
}

export function describeRepeat(unit: RepeatUnit, every: number) {
  if (unit === "none") return "Once";
  const name = { days: "day", weeks: "week", months: "month", years: "year" }[unit];
  return every === 1 ? `Every ${name}` : `Every ${every} ${name}s`;
}

