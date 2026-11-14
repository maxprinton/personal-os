// Event nags (BL-98): the phone-alarm side. Events become single-ring items in the same feed as blocks.
// The Android app reads an item with no occurrenceId as a plain alarm ("Dismiss", no habits or tasks).
import { addDays, minutesToTime, zonedToUtc } from "@/lib/time";
import type { PhoneAlarm } from "@/lib/alarms";
import { endStamp, fireStamp, nagsFor, startStamp, toNag, type LocalStamp, type NagEvent, type NagRow, DEFAULT_ALLDAY_MINUTES } from "@/lib/nags/rules";

const dateOf = (stamp: number) => new Date(Math.floor(stamp / 1440) * 86_400_000).toISOString().slice(0, 10);
const toMs = (stamp: number, tz: string) => zonedToUtc(dateOf(stamp), minutesToTime(((stamp % 1440) + 1440) % 1440), tz).getTime();

/** The phone nags (channel phone or both) of every event, from now to `days` ahead. */
export function buildEventPhoneAlarms(args: {
  events: (NagEvent & { nags_custom?: boolean | null; changedAt: LocalStamp })[];
  rows: NagRow[];
  timezone: string;
  now: Date;
  days: number;
  allDayMinutes?: number;
}): PhoneAlarm[] {
  const allDay = args.allDayMinutes ?? DEFAULT_ALLDAY_MINUTES;
  const nowMs = args.now.getTime();
  const limit = nowMs + args.days * 86_400_000;
  const out: PhoneAlarm[] = [];
  for (const ev of args.events) {
    const changed = Math.floor(Date.parse(`${ev.changedAt.date}T00:00:00Z`) / 86_400_000) * 1440 + ev.changedAt.minutes;
    const startAt = startStamp(ev, allDay);
    for (const row of nagsFor(ev, args.rows)) {
      const nag = toNag(row);
      if (nag.channel === "telegram") continue;
      const fire = fireStamp(ev, nag, allDay);
      if (fire === null || fire < changed) continue;
      const alarmAtMs = toMs(fire, args.timezone);
      if (alarmAtMs <= nowMs || alarmAtMs > limit) continue;
      const startsAtMs = toMs(startAt, args.timezone);
      out.push({
        id: `nag:${nag.id}:${ev.id}:${fire}`,
        title: ev.title,
        date: ev.date,
        start: ev.start === null ? minutesToTime(allDay) : minutesToTime(ev.start),
        end: ev.end === null ? "23:59" : minutesToTime(ev.end % 1440),
        startsAtMs,
        endsAtMs: toMs(endStamp(ev), args.timezone),
        alarmAtMs,
        minutesBefore: Math.max(0, Math.round((startsAtMs - alarmAtMs) / 60_000)),
        note: ev.start === null ? "All-day event" : "",
        chain: "",
        seq: 0,
        total: 1,
        anchor: "start",
        sound: "default",
        style: nag.phoneStyle,
        level: 0,
        every: 0,
        occurrenceId: "",
        blockTypeId: "",
        wake: false,
        bed: false,
        checkin: false,
        habitItems: [],
        taskItems: [],
        habits: [],
        tasks: [],
      });
    }
  }
  return out.sort((a, b) => a.alarmAtMs - b.alarmAtMs);
}
