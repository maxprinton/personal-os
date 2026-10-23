// Time helpers: everything is computed in the user's timezone (default America/Guayaquil).

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
const JS_TO_RR: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function isWeekday(d: string): d is Weekday {
  return (WEEKDAYS as readonly string[]).includes(d);
}

function partsInTz(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    min: Number(p.minute),
    s: Number(p.second),
  };
}

function fmtDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function offsetMs(d: Date, tz: string) {
  const p = partsInTz(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Current local date (YYYY-MM-DD) and minutes since midnight in tz. */
export function localNow(tz: string) {
  const p = partsInTz(new Date(), tz);
  return { date: fmtDate(p.y, p.m, p.d), minutes: p.h * 60 + p.min };
}

/** Local wall-clock date + time in tz -> UTC Date. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - offsetMs(new Date(guess), tz));
}

/** UTC timestamp -> local date + minutes in tz. */
export function utcToLocal(iso: string, tz: string) {
  const p = partsInTz(new Date(iso), tz);
  return { date: fmtDate(p.y, p.m, p.d), minutes: p.h * 60 + p.min };
}

export function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutes(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export function weekdayOf(date: string): Weekday {
  return JS_TO_RR[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function addDays(date: string, n: number) {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function formatDateLong(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---- RRULE (subset: FREQ=DAILY and FREQ=WEEKLY;BYDAY=...) ----------------

export function buildRRule(days: Weekday[]): string {
  if (days.length === 7) return "FREQ=DAILY";
  const ordered = WEEKDAYS.filter((d) => days.includes(d));
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

export function rruleDays(rrule: string): Weekday[] {
  const parts: Record<string, string> = {};
  for (const seg of rrule.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v) parts[k.toUpperCase()] = v.toUpperCase();
  }
  if (parts.FREQ === "DAILY") return [...WEEKDAYS];
  if (parts.FREQ === "WEEKLY" && parts.BYDAY) return parts.BYDAY.split(",").filter(isWeekday);
  return [];
}

export function occursOn(
  block: { rrule: string; valid_from: string; valid_until: string | null },
  date: string
) {
  if (date < block.valid_from) return false;
  if (block.valid_until && date > block.valid_until) return false;
  return rruleDays(block.rrule).includes(weekdayOf(date));
}

export function describeDays(rrule: string) {
  const d = rruleDays(rrule).join(",");
  if (d === WEEKDAYS.join(",")) return "Every day";
  if (d === "MO,TU,WE,TH,FR") return "Weekdays";
  if (d === "SA,SU") return "Weekends";
  return rruleDays(rrule)
    .map((x) => x[0] + x[1].toLowerCase())
    .join(", ");
}
