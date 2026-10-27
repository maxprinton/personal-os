// Pure time-span math for the calendar (safe in the browser).
import { addDays, daysBetween, timeToMinutes } from "@/lib/time";
import type { CalEvent, Occurrence, Slot } from "@/lib/calendar/types";

const WEEK = 7 * 1440;

/** Length in minutes; an end before the start means the block ends the next day. */
export function durationOf(start: string, end: string) {
  const len = timeToMinutes(end) - timeToMinutes(start);
  return len <= 0 ? len + 1440 : len;
}

/** The part of an occurrence that falls on a given date, in minutes since that midnight. */
export function spanOn(o: Pick<Occurrence, "date" | "start_time" | "end_time">, date: string) {
  const s = timeToMinutes(o.start_time);
  const e = timeToMinutes(o.end_time);
  const overnight = e <= s;
  if (o.date === date) return { start: s, end: overnight ? 1440 : e, continues: overnight, continued: false };
  if (overnight && addDays(o.date, 1) === date) return { start: 0, end: e, continues: false, continued: true };
  return null;
}

/** Two date ranges (null end = open) share at least one day. */
export function rangesIntersect(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null) {
  return (!aTo || aTo >= bFrom) && (!bTo || bTo >= aFrom);
}

function slotInterval(weekday: number, start: string, end: string): [number, number] {
  const s = (weekday - 1) * 1440 + timeToMinutes(start);
  return [s, s + durationOf(start, end)];
}

function weeklyOverlap(a: [number, number], b: [number, number]) {
  for (const shift of [-WEEK, 0, WEEK]) {
    if (a[0] < b[1] + shift && b[0] + shift < a[1]) return true;
  }
  return false;
}

export type SlotCandidate = Pick<Slot, "weekday" | "start_time" | "end_time" | "valid_from" | "valid_to">;

/** First existing slot that would overlap the candidate (blocks may never overlap). */
export function findSlotConflict(candidate: SlotCandidate, slots: Slot[], ignore: Set<string> = new Set()) {
  const a = slotInterval(candidate.weekday, candidate.start_time, candidate.end_time);
  return slots.find(
    (s) =>
      !ignore.has(s.id) &&
      rangesIntersect(candidate.valid_from, candidate.valid_to, s.valid_from, s.valid_to) &&
      weeklyOverlap(a, slotInterval(s.weekday, s.start_time, s.end_time))
  );
}

function absInterval(base: string, date: string, start: string, end: string): [number, number] {
  const s = daysBetween(base, date) * 1440 + timeToMinutes(start);
  return [s, s + durationOf(start, end)];
}

export type OccurrenceCandidate = Pick<Occurrence, "date" | "start_time" | "end_time">;

/** First live occurrence that would overlap the candidate on the real timeline.
 * Blocks paused by a free day don't count: other blocks can be put in their place. */
export function findOccurrenceConflict(
  candidate: OccurrenceCandidate,
  occurrences: Occurrence[],
  ignore: Set<string> = new Set()
) {
  const a = absInterval(candidate.date, candidate.date, candidate.start_time, candidate.end_time);
  return occurrences.find((o) => {
    if (ignore.has(o.id) || o.status === "cancelled" || o.status === "free_day") return false;
    const b = absInterval(candidate.date, o.date, o.start_time, o.end_time);
    return a[0] < b[1] && b[0] < a[1];
  });
}

/** The part of an event on a given date (minutes), or null. Events without time are allDay. */
export function eventSpanOn(e: CalEvent, date: string) {
  if (date < e.date || date > e.end_date) return null;
  if (e.start === null || e.end === null) return { allDay: true as const, start: 0, end: 1440 };
  const start = date === e.date ? e.start : 0;
  const end = date === e.end_date ? e.end : 1440;
  if (end <= start) return null;
  return { allDay: false as const, start, end };
}

/** Side-by-side lanes for overlapping timed items (events may overlap each other). */
export function assignLanes<T extends { start: number; end: number }>(items: T[]) {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds: number[] = [];
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else laneEnds[lane] = item.end;
    return { item, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}
