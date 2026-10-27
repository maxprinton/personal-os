// Small browser-safe helpers for the calendar UI.
import { addDays, formatMinutes, isoWeekday, startOfWeek } from "@/lib/time";

export type View = "day" | "week" | "month";

/** Key of a block note: the block name, case-insensitive (same rule as the server). */
export function noteKeyOf(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 80).toLowerCase();
}

/** The note shared by every block with this name ("" when there is none yet). */
export function blockNoteOf(notes: Record<string, { content: string }> | undefined, name: string | undefined) {
  return name ? notes?.[noteKeyOf(name)]?.content ?? "" : "";
}

/** Dark or light text, whichever reads better on the color. */
export function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111827" : "#ffffff";
}

/** Color with transparency, e.g. alpha("#6366f1", 0.2). */
export function alpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function rangeFor(view: View, anchor: string) {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const [y, m] = anchor.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = addDays(nextMonth, -1);
  const from = startOfWeek(first);
  return { from, to: addDays(startOfWeek(last), 6) };
}

export function shiftAnchor(view: View, anchor: string, dir: -1 | 1) {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number);
  const nm = m + dir;
  const ny = nm < 1 ? y - 1 : nm > 12 ? y + 1 : y;
  const mm = nm < 1 ? 12 : nm > 12 ? 1 : nm;
  return `${ny}-${String(mm).padStart(2, "0")}-01`;
}

export function rangeLabel(view: View, anchor: string) {
  const d = (s: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  if (view === "day") return d(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "month") return d(anchor, { month: "long", year: "numeric" });
  const { from, to } = rangeFor("week", anchor);
  return `${d(from, { month: "short", day: "numeric" })} – ${d(to, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function dayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function weekdayName(w: number) {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][w - 1] ?? "";
}

export function weekdayOfDate(date: string) {
  return weekdayName(isoWeekday(date));
}

export function timeRange(startMin: number, endMin: number) {
  return `${formatMinutes(startMin % 1440)} – ${formatMinutes(endMin % 1440)}`;
}

/** Browser's local date as YYYY-MM-DD (replaced by the server's "today" once data arrives). */
export function browserToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function snap(min: number, step = 15) {
  return Math.round(min / step) * step;
}

export function readPref(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the preference just isn't remembered
  }
}

/**
 * Tells every open calendar (and the dock) to reload its data.
 * `source` = the calendar that made the change (it reloads itself, so it skips this event).
 */
export function emitCalendarChanged(source?: string) {
  window.dispatchEvent(new CustomEvent("calendar-changed", { detail: { source } }));
}
