// Alarms of ONE day for the phone app's day view (BL-110, 17 Nov 2026).
// Future rings come from the calendar (same rules the phone syncs); past rings come from what the
// phone actually reported (alarm_events: "rang" and "answer"). A ring that was scheduled in the past
// but never reported as rung is flagged "didnt_ring" (decision: show phone failures in red).
// Server only for loadAlarmDay; summarizeDay is pure and tested in scripts/test-alarm-day.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localNow, zonedToUtc } from "@/lib/time";
import { buildAlarms, type PhoneAlarm } from "@/lib/alarms";
import { getBlockTypes, getOccurrences, OCC_COLS } from "@/lib/calendar/model";
import { loadEventAlarmsBetween } from "@/lib/nags/server";
import type { Occurrence } from "@/lib/calendar/types";

/** A row of alarm_events (what the phone reported). Times in epoch ms. */
export type ReportedEvent = {
  kind: "rang" | "answer";
  answer: string | null;
  occurrenceId: string | null;
  blockTypeId: string | null;
  chain: string | null;
  seq: number | null;
  total: number | null;
  anchor: string | null;
  style: string | null;
  at: number;
  alarmAt: number | null;
};

export type DayRing = {
  at: number;
  /** upcoming = still to come; rang = the phone rang it; didnt_ring = time passed, never reported;
   * stopped = not needed because the chain was answered before it;
   * untracked = before the phone app started reporting rings (nothing to compare with);
   * phone_off = the phone was switched off at that time (it reported it when it came back on). */
  status: "upcoming" | "rang" | "didnt_ring" | "stopped" | "untracked" | "phone_off";
};

export type DayChain = {
  key: string;
  title: string;
  /** "start" | "end" | "event" */
  anchor: string;
  style: string;
  startsAtMs: number | null;
  endsAtMs: number | null;
  minutesBefore: number;
  every: number;
  rings: DayRing[];
  /** upcoming (all rings to come), rang (at least one rang), didnt_ring (all past rings missing),
   * mixed (some rang, some due ones missing). */
  state: "upcoming" | "rang" | "didnt_ring" | "mixed" | "untracked" | "phone_off";
  /** The answer that ended the chain ("started", "done", "snooze"...), or null. */
  answer: string | null;
  answerAt: number | null;
  /** True when it rang but was never scheduled under today's rules (a test alarm, or rules changed later). */
  unplanned: boolean;
};

const MATCH_MS = 90_000; // a reported ring matches a scheduled one within 1.5 min
/** Answers that end a chain (the rest of its rings are not needed). Silence/snooze keep it going. */
const STOPS = new Set(["started", "skip", "already_done", "done", "partial", "not_done", "dismiss"]);

/** Groups one day's rings into chains and joins them with what the phone reported. Pure. */
export function summarizeDay(args: {
  scheduled: PhoneAlarm[];
  events: ReportedEvent[];
  nowMs: number;
  titles?: Map<string, string>;
  /** First time the phone ever reported anything: rings before it can't be judged. */
  trackingSinceMs?: number | null;
  /** When the phone was switched off: [from, to] in ms. */
  offWindows?: [number, number][];
  /** First ring of an event reminder the phone reported (it started reporting them in app v11). */
  nagTrackingSinceMs?: number | null;
}): DayChain[] {
  const { scheduled, events, nowMs } = args;
  const since = args.trackingSinceMs ?? null;
  const wasOff = (t: number) => (args.offWindows ?? []).some(([f, to]) => t >= f && t <= to);
  const rangEvents = events.filter((e) => e.kind === "rang");
  // still_up (BL-114) is a later check, not the answer of a chain
  const answers = events.filter((e) => e.kind === "answer" && e.answer && e.answer !== "still_up").sort((a, b) => a.at - b.at);
  const usedRang = new Set<number>();

  // Scheduled chains (a ring without chain id, e.g. an event nag, is its own chain)
  const byChain = new Map<string, PhoneAlarm[]>();
  for (const a of scheduled) {
    const key = a.chain || `one:${a.id}`;
    const list = byChain.get(key) ?? [];
    list.push(a);
    byChain.set(key, list);
  }

  const out: DayChain[] = [];
  for (const [key, list] of byChain) {
    list.sort((x, y) => x.alarmAtMs - y.alarmAtMs);
    const first = list[0];
    // Reported rings of this chain: same chain id, or the same block (or both without block) at the same time
    const matchRang = (a: PhoneAlarm) => {
      const idx = rangEvents.findIndex(
        (e, i) =>
          !usedRang.has(i) &&
          ((a.chain && e.chain === a.chain && e.seq === a.seq) ||
            ((e.occurrenceId ?? null) === (a.occurrenceId || null) && e.alarmAt !== null && Math.abs(e.alarmAt - a.alarmAtMs) <= MATCH_MS))
      );
      if (idx >= 0) usedRang.add(idx);
      return idx >= 0;
    };
    const rangFlags = list.map((a) => matchRang(a));
    const answer =
      [...answers].reverse().find(
        (e) =>
          (first.chain && e.chain === first.chain) ||
          ((e.occurrenceId ?? null) === (first.occurrenceId || null) &&
            e.alarmAt !== null &&
            e.alarmAt >= first.alarmAtMs - MATCH_MS &&
            e.alarmAt <= list[list.length - 1].alarmAtMs + MATCH_MS)
      ) ?? null;
    const stop = answer && STOPS.has(answer.answer ?? "") ? answer : null;
    const rings: DayRing[] = list.map((a, i) => {
      if (rangFlags[i]) return { at: a.alarmAtMs, status: "rang" };
      if (stop && a.alarmAtMs > stop.at) return { at: a.alarmAtMs, status: "stopped" };
      if (a.alarmAtMs > nowMs) return { at: a.alarmAtMs, status: "upcoming" };
      if (wasOff(a.alarmAtMs)) return { at: a.alarmAtMs, status: "phone_off" };
      const nagSince = args.nagTrackingSinceMs ?? null;
      if (since === null || a.alarmAtMs < since) return { at: a.alarmAtMs, status: "untracked" };
      if (a.id.startsWith("nag:") && (nagSince === null || a.alarmAtMs < nagSince)) return { at: a.alarmAtMs, status: "untracked" };
      return { at: a.alarmAtMs, status: "didnt_ring" };
    });
    out.push({
      key,
      title: first.title || "Alarm",
      anchor: first.id.startsWith("nag:") ? "event" : first.anchor,
      style: first.style,
      startsAtMs: first.startsAtMs ?? null,
      endsAtMs: first.endsAtMs ?? null,
      minutesBefore: first.minutesBefore,
      every: first.every,
      rings,
      state: chainState(rings, !!answer),
      answer: answer?.answer ?? null,
      answerAt: answer?.at ?? null,
      unplanned: false,
    });
  }

  // Rings the phone reported that today's schedule doesn't know (test alarm, rules or block changed since)
  const loose = rangEvents.filter((_, i) => !usedRang.has(i));
  const looseChains = new Map<string, ReportedEvent[]>();
  for (const e of loose) {
    const key = e.chain || `t:${e.alarmAt ?? e.at}`;
    const list = looseChains.get(key) ?? [];
    list.push(e);
    looseChains.set(key, list);
  }
  for (const [key, list] of looseChains) {
    list.sort((a, b) => (a.alarmAt ?? a.at) - (b.alarmAt ?? b.at));
    const first = list[0];
    const answer = [...answers].reverse().find((e) => (first.chain && e.chain === first.chain)) ?? null;
    out.push({
      key: `r:${key}`,
      title: (first.blockTypeId && args.titles?.get(first.blockTypeId)) || (first.chain ? "Alarm" : "Test alarm"),
      anchor: first.anchor ?? "start",
      style: first.style ?? "alarm",
      startsAtMs: null,
      endsAtMs: null,
      minutesBefore: 0,
      every: 0,
      rings: list.map((e) => ({ at: e.alarmAt ?? e.at, status: "rang" as const })),
      state: "rang",
      answer: answer?.answer ?? null,
      answerAt: answer?.at ?? null,
      unplanned: true,
    });
  }

  return out.sort((a, b) => (a.rings[0]?.at ?? 0) - (b.rings[0]?.at ?? 0));
}

function chainState(rings: DayRing[], answered: boolean): DayChain["state"] {
  const rang = rings.some((r) => r.status === "rang");
  const missing = rings.some((r) => r.status === "didnt_ring");
  if (rang || answered) return missing ? "mixed" : "rang";
  if (missing) return "didnt_ring";
  if (rings.some((r) => r.status === "phone_off")) return "phone_off";
  if (rings.some((r) => r.status === "untracked")) return "untracked";
  return "upcoming";
}

/** Everything the phone's day view needs for one local date. */
export async function loadAlarmDay(sb: SupabaseClient, userId: string, timezone: string, date: string, now = new Date()) {
  const today = localNow(timezone).date;
  const fromMs = zonedToUtc(date, "00:00", timezone).getTime();
  const toMs = zonedToUtc(addDays(date, 1), "00:00", timezone).getTime();
  const types = await getBlockTypes(sb, userId);
  // The day before too: a block that starts at night can ring after midnight
  let occurrences: Occurrence[];
  if (date >= today) {
    occurrences = await getOccurrences(sb, userId, addDays(date, -1), date);
  } else {
    // Past days: read what exists, never create rows in the past
    const { data } = await sb
      .from("block_occurrences")
      .select(OCC_COLS)
      .eq("user_id", userId)
      .gte("date", addDays(date, -1))
      .lte("date", date)
      .neq("status", "cancelled");
    occurrences = (data ?? []) as Occurrence[];
  }
  const blockRings = buildAlarms({
    occurrences,
    types,
    notes: new Map(),
    timezone,
    now: new Date(fromMs - 1),
    days: (toMs - fromMs) / 86_400_000 + 1,
    keepDone: true,
  }).filter((a) => a.alarmAtMs >= fromMs && a.alarmAtMs < toMs);
  const eventRings = await loadEventAlarmsBetween(sb, userId, timezone, date, fromMs, toMs);

  // What the phone reported for rings of this day (nothing to read for future days)
  let events: ReportedEvent[] = [];
  if (fromMs <= now.getTime()) {
    const { data, error } = await sb
      .from("alarm_events")
      .select("kind,answer,occurrence_id,block_type_id,chain,seq,total,anchor,style,at,alarm_at")
      .eq("user_id", userId)
      .in("kind", ["rang", "answer"])
      .gte("at", new Date(fromMs - 3 * 3_600_000).toISOString())
      .lt("at", new Date(toMs + 6 * 3_600_000).toISOString())
      .order("at");
    if (!error) {
      events = ((data ?? []) as Record<string, unknown>[])
        .map((r) => ({
          kind: r.kind as "rang" | "answer",
          answer: (r.answer as string | null) ?? null,
          occurrenceId: (r.occurrence_id as string | null) ?? null,
          blockTypeId: (r.block_type_id as string | null) ?? null,
          chain: (r.chain as string | null) || null,
          seq: (r.seq as number | null) ?? null,
          total: (r.total as number | null) ?? null,
          anchor: (r.anchor as string | null) ?? null,
          style: (r.style as string | null) ?? null,
          at: Date.parse(r.at as string),
          alarmAt: r.alarm_at ? Date.parse(r.alarm_at as string) : null,
        }))
        // A ring (or its answer) belongs to the day of its alarm time; if unknown, of when it happened
        .filter((e) => {
          const t = e.alarmAt ?? e.at;
          return t >= fromMs && t < toMs;
        });
    }
  }
  // Since when the phone reports rings: earlier rings can't be flagged "didn't ring"
  const { data: firstRow } = await sb
    .from("alarm_events")
    .select("at")
    .eq("user_id", userId)
    .order("at")
    .limit(1)
    .maybeSingle();
  const trackingSinceMs = firstRow?.at ? Date.parse(firstRow.at as string) : null;
  // Event reminders: reported only from app v11 on (rings without a block)
  const { data: firstNag } = await sb
    .from("alarm_events")
    .select("at")
    .eq("user_id", userId)
    .eq("kind", "rang")
    .is("occurrence_id", null)
    .order("at")
    .limit(1)
    .maybeSingle();
  const nagTrackingSinceMs = firstNag?.at ? Date.parse(firstNag.at as string) : null;
  // When the phone was off during this day (reported when it came back on)
  const { data: offRows } = await sb
    .from("alarm_events")
    .select("at,alarm_at")
    .eq("user_id", userId)
    .eq("kind", "off")
    .gte("at", new Date(fromMs).toISOString())
    .lt("alarm_at", new Date(toMs).toISOString());
  const offWindows = ((offRows ?? []) as { at: string; alarm_at: string | null }[])
    .filter((r) => r.alarm_at)
    .map((r) => [Date.parse(r.alarm_at as string), Date.parse(r.at)] as [number, number]);
  const titles = new Map(types.map((t) => [t.id, t.name]));
  const chains = summarizeDay({ scheduled: [...blockRings, ...eventRings], events, nowMs: now.getTime(), titles, trackingSinceMs, offWindows, nagTrackingSinceMs });
  return { date, today, fromMs, toMs, chains };
}
