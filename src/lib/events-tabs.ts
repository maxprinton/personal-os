// BL-123: how the Events page splits events into Upcoming / Overdue / Past. Pure, no database.
import { addDays } from "@/lib/time";
import type { CalEvent } from "@/lib/calendar/types";

/** How many days one "Past" page covers (first load and each "Load more"). */
export const PAST_CHUNK_DAYS = 90;
/** How far ahead Upcoming looks. */
export const UPCOMING_DAYS = 60;

/** A payment whose day is over and that was neither paid nor skipped. */
export function isOverdue(e: CalEvent, today: string): boolean {
  return Boolean(e.is_payment) && !e.payment_status && e.end_date < today;
}

function byStart(a: CalEvent, b: CalEvent) {
  return a.date.localeCompare(b.date) || (a.start ?? -1) - (b.start ?? -1) || a.title.localeCompare(b.title);
}

/** Dedupe by id (the same event can arrive from two queries). */
export function uniqueEvents(list: CalEvent[]): CalEvent[] {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

export function splitEvents(all: CalEvent[], today: string) {
  const list = uniqueEvents(all);
  const overdue = list.filter((e) => isOverdue(e, today)).sort(byStart);
  // Today and running events stay in Upcoming until their last day is over
  const upcoming = list.filter((e) => e.end_date >= today).sort(byStart);
  // Past: everything already over, newest first (overdue payments are here too, marked "To pay")
  const past = list.filter((e) => e.end_date < today).sort((a, b) => -byStart(a, b));
  return { overdue, upcoming, past };
}

/** The window just before `before` (exclusive): { from, to } inclusive dates. */
export function pastWindow(before: string, days = PAST_CHUNK_DAYS) {
  return { from: addDays(before, -days), to: addDays(before, -1) };
}
