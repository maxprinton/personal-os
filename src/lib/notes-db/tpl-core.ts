// Templates, the pure part (safe in the browser and on the server, no database):
//  · variables  {{date}} {{fecha}} {{week}}…  expanded in a template's title and text
//  · schedules  when the next note of a series is due, in the user's timezone
//  · "untouched" a small hash of what the template made, to know if the note was ever used
import { addDays, isoWeekday, zonedToUtc } from "@/lib/time";
import type { Schedule } from "@/lib/notes-db/types";

// ---- Variables -------------------------------------------------------------------------------

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]; // ISO 1…7
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** The variables a template can use, for the "Variables" help. Example values are for Thu Oct 29, 2026, 21:00. */
export const TEMPLATE_VARS: { name: string; example: string; hint: string }[] = [
  { name: "date", example: "Oct 29, 2026", hint: "Date" },
  { name: "date_iso", example: "2026-10-29", hint: "Date (ISO)" },
  { name: "weekday", example: "Thursday", hint: "Day of the week" },
  { name: "week", example: "44", hint: "Week number (ISO)" },
  { name: "month", example: "October", hint: "Month" },
  { name: "year", example: "2026", hint: "Year" },
  { name: "time", example: "21:00", hint: "Time" },
  { name: "fecha", example: "jueves 29 de octubre", hint: "Fecha en español" },
  { name: "dia", example: "jueves", hint: "Día en español" },
  { name: "mes", example: "octubre", hint: "Mes en español" },
];

/** ISO week number (1–53) of a YYYY-MM-DD date. */
export function isoWeek(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = isoWeekday(date);
  d.setUTCDate(d.getUTCDate() + 4 - wd); // the Thursday of this week decides the year
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12));
  return Math.floor((d.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;
}

export function varValues(date: string, time: string): Record<string, string> {
  const [y, m, d] = date.split("-").map(Number);
  const wd = isoWeekday(date);
  return {
    date: `${MONTHS_EN[m - 1].slice(0, 3)} ${d}, ${y}`,
    date_iso: date,
    weekday: DAYS_EN[wd - 1],
    week: String(isoWeek(date)),
    month: MONTHS_EN[m - 1],
    year: String(y),
    time,
    fecha: `${DAYS_ES[wd - 1]} ${d} de ${MONTHS_ES[m - 1]}`,
    dia: DAYS_ES[wd - 1],
    mes: MONTHS_ES[m - 1],
  };
}

/** Replaces {{date}}, {{ fecha }}… (unknown ones stay as they are). */
export function expandVars(text: string, date: string, time: string) {
  if (!text || !text.includes("{{")) return text ?? "";
  const v = varValues(date, time);
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (all, name: string) => v[name.toLowerCase()] ?? all);
}

// ---- Schedules -------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Cleans a schedule from the screen (or the database). null = no schedule. */
export function cleanSchedule(s: Partial<Schedule> | null | undefined): Schedule | null {
  if (!s || typeof s !== "object") return null;
  const freq = (["daily", "weekly", "monthly", "yearly"] as const).includes(s.freq as Schedule["freq"]) ? (s.freq as Schedule["freq"]) : null;
  if (!freq) return null;
  const out: Schedule = { freq, time: typeof s.time === "string" && TIME_RE.test(s.time) ? s.time : "09:00" };
  if (freq === "weekly") {
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    out.days = days.length ? days : [1];
  }
  if (freq === "monthly" || freq === "yearly") {
    const md = Math.round(Number(s.monthDay));
    out.monthDay = Number.isFinite(md) && md >= 1 && md <= 31 ? md : 1;
  }
  if (freq === "yearly") {
    const mo = Math.round(Number(s.month));
    out.month = Number.isFinite(mo) && mo >= 1 && mo <= 12 ? mo : 1;
  }
  const adv = Number(s.advanceHours);
  if (Number.isFinite(adv) && adv > 0) out.advanceHours = Math.min(168, Math.round(adv * 4) / 4);
  if (typeof s.until === "string" && DATE_RE.test(s.until)) out.until = s.until;
  else out.until = null;
  if (typeof s.start === "string" && DATE_RE.test(s.start)) out.start = s.start;
  if (s.paused) out.paused = true;
  if (s.skipUnused) out.skipUnused = true;
  if (s.notify) out.notify = true;
  return out;
}

/** Does the schedule have a note on this date? (ignores start / until / paused) */
export function matchesDate(s: Schedule, date: string) {
  const [y, m, d] = date.split("-").map(Number);
  switch (s.freq) {
    case "daily":
      return true;
    case "weekly":
      return (s.days?.length ? s.days : [1]).includes(isoWeekday(date));
    case "monthly":
      return d === Math.min(s.monthDay ?? 1, lastDayOfMonth(y, m));
    case "yearly":
      return m === (s.month ?? 1) && d === Math.min(s.monthDay ?? 1, lastDayOfMonth(y, m));
  }
}

const inRange = (s: Schedule, date: string) => (!s.start || date >= s.start) && (!s.until || date <= s.until);

/** The moment (UTC) the note for `date` is created: its time that day, minus "create X hours before". */
export function creationMoment(s: Schedule, date: string, tz: string) {
  return new Date(zonedToUtc(date, s.time, tz).getTime() - (s.advanceHours ?? 0) * 3_600_000);
}

const SCAN = 400; // days; enough for a yearly schedule

/**
 * The latest date whose note should exist by `now` and wasn't made yet (after `lastKey`), or null.
 * Only the latest missed one: a cron that was down for a week makes one note, not seven.
 */
export function dueKey(s: Schedule | null | undefined, tz: string, now: Date, lastKey?: string | null): string | null {
  if (!s || s.paused) return null;
  const local = localDateAt(now, tz);
  const ahead = Math.ceil((s.advanceHours ?? 0) / 24) + 1;
  for (let i = ahead; i >= -SCAN; i--) {
    const date = addDays(local, i);
    if (lastKey && date <= lastKey) return null;
    if (s.start && date < s.start) return null;
    if (!matchesDate(s, date) || !inRange(s, date)) continue;
    if (creationMoment(s, date, tz).getTime() <= now.getTime()) return date;
  }
  return null;
}

/** The next date (and when its note is created) still to come after `now`, or null (paused / ended). */
export function nextRun(s: Schedule | null | undefined, tz: string, now: Date, lastKey?: string | null): { key: string; at: Date } | null {
  if (!s || s.paused) return null;
  const local = localDateAt(now, tz);
  for (let i = -1; i <= SCAN; i++) {
    const date = addDays(local, i);
    if (s.until && date > s.until) return null;
    if (lastKey && date <= lastKey) continue;
    if (!matchesDate(s, date) || !inRange(s, date)) continue;
    const at = creationMoment(s, date, tz);
    if (at.getTime() > now.getTime()) return { key: date, at };
  }
  return null;
}

/** The next date not made yet, even if its moment hasn't come ("Create one now"). Due ones first. */
export function nextKeyToMake(s: Schedule, tz: string, now: Date, lastKey?: string | null) {
  return dueKey(s, tz, now, lastKey) ?? nextRun(s, tz, now, lastKey)?.key ?? null;
}

/** Local date (YYYY-MM-DD) of a moment in tz. */
export function localDateAt(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d);
}

/** Local "HH:MM" of a moment in tz. */
export function localTimeAt(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return f.format(d);
}

/** "Thu Oct 30, 21:00" (in tz). */
export function formatRun(d: Date, tz: string) {
  const date = localDateAt(d, tz);
  const [, m, day] = date.split("-").map(Number);
  return `${DAYS_EN[isoWeekday(date) - 1].slice(0, 3)} ${MONTHS_EN[m - 1].slice(0, 3)} ${day}, ${localTimeAt(d, tz)}`;
}

/** "Thu Oct 30" for a YYYY-MM-DD. */
export function formatDay(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${DAYS_EN[isoWeekday(date) - 1].slice(0, 3)} ${MONTHS_EN[m - 1].slice(0, 3)} ${d}`;
}

/** Plain-English summary: "Every day at 21:00", "Mon, Wed at 08:00", "Monthly on day 31 at 09:00". */
export function describeSchedule(s: Schedule | null | undefined) {
  if (!s) return "Off";
  const at = ` at ${s.time}`;
  let base = "";
  if (s.freq === "daily") base = `Every day${at}`;
  else if (s.freq === "weekly") {
    const days = s.days?.length ? s.days : [1];
    base = days.length === 7 ? `Every day${at}` : days.join(",") === "1,2,3,4,5" ? `Weekdays${at}` : `Every ${days.map((d) => DAYS_EN[d - 1].slice(0, 3)).join(", ")}${at}`;
  } else if (s.freq === "monthly") base = `Monthly on day ${s.monthDay ?? 1}${at}`;
  else base = `Every ${MONTHS_EN[(s.month ?? 1) - 1].slice(0, 3)} ${s.monthDay ?? 1}${at}`;
  return s.paused ? `${base} (paused)` : base;
}

/** Did a change of schedule change WHEN it runs (so the past shouldn't be caught up)? */
export function timingChanged(a: Schedule | null | undefined, b: Schedule | null | undefined) {
  if (!b || b.paused) return false;
  if (!a || a.paused) return true;
  const k = (s: Schedule) => JSON.stringify([s.freq, s.days ?? [], s.monthDay ?? null, s.month ?? null, s.time, s.advanceHours ?? 0, s.start ?? null]);
  return k(a) !== k(b);
}

// ---- "Untouched" -------------------------------------------------------------------------------

/** Order-independent JSON (so {a,b} and {b,a} hash the same). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined && (v as Record<string, unknown>)[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Markdown with spacing and escapes ignored (the editor may re-save it a bit differently without you typing). */
export function normalizeMd(md: string) {
  return (md ?? "").replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1").replace(/&nbsp;| /g, " ").replace(/\s+/g, "");
}

/** FNV-1a, 32 bit, as hex. */
function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The fingerprint of a note as the template made it: title, text and values. */
export function madeHash(n: { title: string; content: string; props: Record<string, unknown> | null | undefined }) {
  return fnv(`${(n.title ?? "").trim()}\u0001${normalizeMd(n.content)}\u0001${stable(n.props ?? {})}`);
}

/** Is the note still as the template made it? */
export function isUntouched(n: { title: string; content: string; props: Record<string, unknown> | null | undefined; template?: unknown }) {
  const made = (n.template as { made?: { hash?: string } } | null | undefined)?.made;
  return !!made?.hash && made.hash === madeHash(n);
}

// ---- Helpers ---------------------------------------------------------------------------------

/** Every /notes/<old id> → /notes/<new id> (sub-pages copied with the note). */
export function remapNoteLinks(md: string, map: Map<string, string>) {
  if (!map.size || !md) return md ?? "";
  return md.replace(/\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi, (all, id: string) => {
    const to = map.get(id.toLowerCase());
    return to ? `/notes/${to}` : all;
  });
}
