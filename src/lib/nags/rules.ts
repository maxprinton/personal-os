// Event nags (BL-98): pure rules, no database and no clock. Everything is in the user's LOCAL time.
// The cron gives it the events, the nags and "now"; it says which nags are due and what to send.
import { addDays, formatMinutes } from "@/lib/time";

export type NagKind = "before" | "start" | "mid";
export type NagChannel = "telegram" | "phone" | "both";
export type PhoneStyle = "alarm" | "notify";

/** One nag. event_id null in the database = part of the default set. */
export type Nag = {
  id: string;
  kind: NagKind;
  /** Only for `before`: minutes before the start (an all-day event counts from the all-day time). */
  offsetMinutes: number;
  channel: NagChannel;
  phoneStyle: PhoneStyle;
};

/** The calendar event as the app already loads it (minutes since local midnight; null = all day). */
export type NagEvent = {
  id: string;
  title: string;
  date: string;
  end_date: string;
  start: number | null;
  end: number | null;
};

export type LocalStamp = { date: string; minutes: number };

export type DueNag = {
  nag: Nag;
  /** Local minute index of the moment the nag should fire. */
  fireAt: number;
  /** For reminder_log: a moved event gets a new fire time, so unsent nags follow it. */
  ref: string;
  text: string;
};

export const DEFAULT_ALLDAY_MINUTES = 9 * 60;
/** A nag is sent at most this many minutes late (the cron runs every 5 minutes). */
export const LATE_LIMIT = 15;
export const MAX_OFFSET = 60 * 24 * 60; // 60 days
export const MAX_NAGS = 12;

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
/** Local minute index: days since 1970 times 1440 plus minutes. */
export const stampOf = (date: string, minutes: number) => dayNumber(date) * 1440 + minutes;

export function isAllDay(e: NagEvent) {
  return e.start === null || e.end === null;
}

/** The moment the event starts (all-day events start at the all-day time of their first day). */
export function startStamp(e: NagEvent, allDayMinutes = DEFAULT_ALLDAY_MINUTES) {
  return stampOf(e.date, isAllDay(e) ? allDayMinutes : (e.start as number));
}

/** The moment the event ends (all-day events end at the end of their last day). */
export function endStamp(e: NagEvent) {
  return stampOf(e.end_date, isAllDay(e) ? 1440 : (e.end as number));
}

/** Which nags an event uses: its own list when it is custom, otherwise the default set. */
export function nagsFor<T extends { event_id: string | null }>(ev: { id: string; nags_custom?: boolean | null }, rows: T[]) {
  return rows.filter((r) => (ev.nags_custom ? r.event_id === ev.id : r.event_id === null));
}

/** When one nag fires, or null when it does not apply to this event (for example a mid nag on a one-day all-day event). */
export function fireStamp(e: NagEvent, nag: Nag, allDayMinutes = DEFAULT_ALLDAY_MINUTES): number | null {
  const start = startStamp(e, allDayMinutes);
  if (nag.kind === "start") return start;
  if (nag.kind === "before") return start - Math.max(0, Math.round(nag.offsetMinutes));
  // mid: the middle of the whole span
  if (isAllDay(e)) {
    const days = dayNumber(e.end_date) - dayNumber(e.date) + 1;
    const index = Math.floor(days / 2);
    return index === 0 ? null : stampOf(addDays(e.date, index), allDayMinutes);
  }
  const end = endStamp(e);
  const mid = start + Math.floor((end - start) / 2);
  return end > start && mid > start ? mid : null;
}

/** "5 minutes", "1 hour", "2 days", "1 h 30 min". */
export function humanOffset(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (m >= 1440 && m % 1440 === 0) return plural(m / 1440, "day");
  if (m >= 60 && m % 60 === 0) return plural(m / 60, "hour");
  if (m < 60) return plural(m, "minute");
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function nagText(e: NagEvent, nag: Nag) {
  if (nag.kind === "start") return `▶️ ${e.title} is starting now`;
  if (nag.kind === "mid") return `⏳ ${e.title} is halfway`;
  const when = isAllDay(e) ? "all day" : formatMinutes(e.start as number);
  return `⏰ ${e.title} starts in ${humanOffset(nag.offsetMinutes)} (${when})`;
}

/**
 * The nags of one event that should be sent right now.
 * - not before the event was created or last moved (`changedAt`): a nag already in the past then is skipped
 * - at most LATE_LIMIT minutes late, and never after the event has ended
 * - a `before` nag is never sent once the event has started
 */
export function dueNags(args: {
  event: NagEvent;
  nags: Nag[];
  now: LocalStamp;
  changedAt: LocalStamp;
  allDayMinutes?: number;
}): DueNag[] {
  const { event, nags, now, changedAt } = args;
  const allDay = args.allDayMinutes ?? DEFAULT_ALLDAY_MINUTES;
  const nowAt = stampOf(now.date, now.minutes);
  const changed = stampOf(changedAt.date, changedAt.minutes);
  const start = startStamp(event, allDay);
  const end = endStamp(event);
  const out: DueNag[] = [];
  for (const nag of nags) {
    const fireAt = fireStamp(event, nag, allDay);
    if (fireAt === null) continue;
    if (fireAt > nowAt || nowAt - fireAt > LATE_LIMIT) continue;
    if (fireAt < changed) continue;
    if (nowAt >= end) continue;
    if (nag.kind === "before" && nowAt >= start) continue;
    out.push({ nag, fireAt, ref: `${nag.id}:${event.id}:${fireAt}`, text: nagText(event, nag) });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/** True when a phone nag of this kind may arrive late: the phone only syncs at :05 and :45 each hour. */
export function phoneMayBeLate(nag: Pick<Nag, "kind" | "offsetMinutes" | "channel">) {
  if (nag.channel === "telegram") return false;
  return nag.kind !== "before" || nag.offsetMinutes < 60;
}

/** Cleans what the editor sends: valid kinds and channels, whole minutes, no duplicates, at most MAX_NAGS. */
export function cleanNags(list: { kind?: unknown; offsetMinutes?: unknown; channel?: unknown; phoneStyle?: unknown }[]) {
  const out: Omit<Nag, "id">[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const kind: NagKind | null = r.kind === "before" || r.kind === "start" || r.kind === "mid" ? r.kind : null;
    if (!kind) continue;
    const channel: NagChannel = r.channel === "phone" || r.channel === "both" ? r.channel : "telegram";
    const phoneStyle: PhoneStyle = r.phoneStyle === "notify" ? "notify" : "alarm";
    let offsetMinutes = 0;
    if (kind === "before") {
      offsetMinutes = Math.round(Number(r.offsetMinutes));
      if (!Number.isFinite(offsetMinutes) || offsetMinutes < 1 || offsetMinutes > MAX_OFFSET) continue;
    }
    const key = `${kind}:${offsetMinutes}:${channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, offsetMinutes, channel, phoneStyle });
    if (out.length >= MAX_NAGS) break;
  }
  return out;
}

/** A row of event_nags as the database returns it. */
export type NagRow = {
  id: string;
  event_id: string | null;
  kind: string;
  offset_minutes: number;
  channel: string;
  phone_style: string;
};

export function toNag(r: NagRow): Nag {
  return {
    id: r.id,
    kind: r.kind === "before" || r.kind === "mid" ? r.kind : "start",
    offsetMinutes: Number(r.offset_minutes) || 0,
    channel: r.channel === "phone" || r.channel === "both" ? r.channel : "telegram",
    phoneStyle: r.phone_style === "notify" ? "notify" : "alarm",
  };
}

/** Every Telegram nag that is due now, across events: the default set or the event's own list. */
export function planTelegramNags(args: {
  events: (NagEvent & { nags_custom?: boolean | null; changedAt: LocalStamp })[];
  rows: NagRow[];
  now: LocalStamp;
  allDayMinutes?: number;
}) {
  const out: (DueNag & { eventId: string })[] = [];
  for (const ev of args.events) {
    const nags = nagsFor(ev, args.rows)
      .map(toNag)
      .filter((n) => n.channel === "telegram" || n.channel === "both");
    for (const d of dueNags({ event: ev, nags, now: args.now, changedAt: ev.changedAt, allDayMinutes: args.allDayMinutes })) {
      out.push({ ...d, eventId: ev.id });
    }
  }
  return out;
}
