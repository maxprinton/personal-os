// Instant ("optimistic") changes to the calendar data on screen, applied before the server answers.
// The server stays the source of truth: after every action the calendar reloads and corrects itself.
import { addDays, minutesToTime, timeToMinutes } from "@/lib/time";
import { durationOf } from "@/lib/calendar/overlap";
import type { CalendarData, Occurrence, OccurrenceStatus } from "@/lib/calendar/types";

export type Shift = { dayShift: number; minuteShift: number };

const t = (min: number) => `${minutesToTime(min)}:00`;

/** A block moved by whole days and minutes (keeps its length; may cross midnight). */
export function shiftOcc(o: Occurrence, { dayShift, minuteShift }: Shift): Occurrence {
  const startAbs = timeToMinutes(o.start_time) + minuteShift;
  const start = ((startAbs % 1440) + 1440) % 1440;
  return {
    ...o,
    date: addDays(o.date, dayShift + Math.floor(startAbs / 1440)),
    start_time: t(start),
    end_time: t(start + durationOf(o.start_time, o.end_time)),
  };
}

/** A block with its end moved by `delta` minutes (at least 15 minutes long, at most a day). */
export function resizeOcc(o: Occurrence, delta: number): Occurrence {
  const dur = Math.max(15, Math.min(1440 - 5, durationOf(o.start_time, o.end_time) + delta));
  return { ...o, end_time: t(timeToMinutes(o.start_time) + dur) };
}

function mapOccs(d: CalendarData, ids: Set<string>, fn: (o: Occurrence) => Occurrence): CalendarData {
  return { ...d, occurrences: d.occurrences.map((o) => (ids.has(o.id) ? fn(o) : o)) };
}

export const optimistic = {
  move(id: string, date: string, start: number, end: number) {
    return (d: CalendarData) => mapOccs(d, new Set([id]), (o) => ({ ...o, date, start_time: t(start), end_time: t(end) }));
  },
  shift(ids: string[], shift: Shift) {
    return (d: CalendarData) => mapOccs(d, new Set(ids), (o) => shiftOcc(o, shift));
  },
  resize(ids: string[], delta: number) {
    return (d: CalendarData) => mapOccs(d, new Set(ids), (o) => resizeOcc(o, delta));
  },
  status(ids: string[], status: OccurrenceStatus) {
    return (d: CalendarData) => mapOccs(d, new Set(ids), (o) => ({ ...o, status }));
  },
  toggleDone(id: string) {
    return (d: CalendarData) =>
      mapOccs(d, new Set([id]), (o) => ({ ...o, status: o.status === "done" ? "scheduled" : "done" }));
  },
  remove(ids: string[]) {
    const set = new Set(ids);
    return (d: CalendarData) => ({ ...d, occurrences: d.occurrences.filter((o) => !set.has(o.id)) });
  },
  /** Temporary copies (replaced by the real ones when the calendar reloads). */
  copy(ids: string[], shift: Shift) {
    const set = new Set(ids);
    return (d: CalendarData) => ({
      ...d,
      occurrences: [
        ...d.occurrences,
        ...d.occurrences
          .filter((o) => set.has(o.id))
          .map((o, i) => ({
            ...shiftOcc(o, shift),
            id: `tmp-copy-${Date.now()}-${i}`,
            slot_id: null,
            origin_date: null,
            status: "scheduled" as OccurrenceStatus,
            is_override: true,
          })),
      ],
    });
  },
};
