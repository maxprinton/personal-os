// Which block to focus on (pure; browser and server): the one happening now (an overnight block
// from yesterday counts), or else the next one that starts later today.
import { spanOn } from "@/lib/calendar/overlap";
import { timeToMinutes } from "@/lib/time";
import type { Occurrence } from "@/lib/calendar/types";

/** startAbs/endAbs: minutes from today's midnight (can be < 0 or > 1440 for overnight blocks). */
export type FocusPick = { occ: Occurrence; mode: "now" | "next"; startAbs: number; endAbs: number };

export function pickFocus(occurrences: Occurrence[], today: string, nowMinutes: number): FocusPick | null {
  const spans = occurrences
    .filter((o) => o.status !== "free_day" && o.status !== "cancelled")
    .map((o) => ({ o, s: spanOn(o, today) }))
    .filter((x): x is { o: Occurrence; s: NonNullable<ReturnType<typeof spanOn>> } => Boolean(x.s));
  const endAbs = (x: (typeof spans)[number]) => (x.s.continues ? 1440 + timeToMinutes(x.o.end_time) : x.s.end);
  const cur = spans.find((x) => x.s.start <= nowMinutes && nowMinutes < x.s.end);
  if (cur) {
    const startAbs = cur.s.continued ? timeToMinutes(cur.o.start_time) - 1440 : cur.s.start;
    return { occ: cur.o, mode: "now", startAbs, endAbs: endAbs(cur) };
  }
  const next = spans.filter((x) => !x.s.continued && x.s.start > nowMinutes).sort((a, b) => a.s.start - b.s.start)[0];
  return next ? { occ: next.o, mode: "next", startAbs: next.s.start, endAbs: endAbs(next) } : null;
}
