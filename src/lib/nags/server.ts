// Event nags (BL-98), server side: reads the events and the nags, sends the Telegram ones that are due and
// builds the phone ones. Never throws: an error is a quiet "nothing".
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENT_COLS, toCalEvent, type EventDbRow } from "@/lib/calendar/events";
import { addDays, localNow, timeToMinutes, utcToLocal } from "@/lib/time";
import { DEFAULT_ALLDAY_MINUTES, MAX_OFFSET, planTelegramNags, type NagRow } from "@/lib/nags/rules";
import { buildEventPhoneAlarms } from "@/lib/nags/phone";
import type { PhoneAlarm } from "@/lib/alarms";

const LOOK_AHEAD_DAYS = Math.ceil(MAX_OFFSET / 1440) + 1;

/** The nags and the events they may apply to (events from yesterday to LOOK_AHEAD_DAYS ahead). */
async function loadNagData(admin: SupabaseClient, userId: string, timezone: string, today: string) {
  const { data: rows, error } = await admin
    .from("event_nags")
    .select("id,event_id,kind,offset_minutes,channel,phone_style")
    .eq("user_id", userId);
  if (error || !rows?.length) return null;
  const { data: set } = await admin.from("user_settings").select("nag_allday_time").eq("user_id", userId).maybeSingle();
  const allDayMinutes = set?.nag_allday_time ? timeToMinutes(String(set.nag_allday_time).slice(0, 5)) : DEFAULT_ALLDAY_MINUTES;
  const { data: evs, error: evErr } = await admin
    .from("events")
    .select(`${EVENT_COLS},updated_at,nags_custom`)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .lte("event_date", addDays(today, LOOK_AHEAD_DAYS))
    .gte("end_date", addDays(today, -1));
  if (evErr || !evs?.length) return null;
  const events = (evs as unknown as (EventDbRow & { updated_at: string; nags_custom: boolean })[]).map((r) => ({
    ...toCalEvent(r, timezone),
    nags_custom: r.nags_custom,
    changedAt: utcToLocal(r.updated_at, timezone),
  }));
  return { rows: rows as NagRow[], events, allDayMinutes };
}

export async function sendDueNags(
  admin: SupabaseClient,
  s: { user_id: string; timezone: string },
  now: { date: string; minutes: number },
  send: (text: string) => Promise<void>,
  claim: (kind: string, ref: string) => Promise<boolean>
) {
  try {
    const data = await loadNagData(admin, s.user_id, s.timezone, now.date);
    if (!data) return 0;
    let sent = 0;
    for (const d of planTelegramNags({ events: data.events, rows: data.rows, now, allDayMinutes: data.allDayMinutes })) {
      if (!(await claim("nag", d.ref))) continue;
      await send(d.text);
      sent++;
    }
    return sent;
  } catch {
    return 0;
  }
}

/** Phone nags for the next `days` days, to join the block alarms in /api/alarms. */
/** Day view (BL-110): the phone rings of event nags whose time falls in [fromMs, toMs), past included. */
export async function loadEventAlarmsBetween(admin: SupabaseClient, userId: string, timezone: string, date: string, fromMs: number, toMs: number): Promise<PhoneAlarm[]> {
  try {
    const data = await loadNagData(admin, userId, timezone, date);
    if (!data) return [];
    const list = buildEventPhoneAlarms({ ...data, timezone, now: new Date(fromMs - 1), days: Math.ceil((toMs - fromMs) / 86_400_000) + 1 });
    return list.filter((a) => a.alarmAtMs >= fromMs && a.alarmAtMs < toMs);
  } catch {
    return [];
  }
}

export async function loadEventAlarms(admin: SupabaseClient, userId: string, timezone: string, now: Date, days = 7): Promise<PhoneAlarm[]> {
  try {
    const data = await loadNagData(admin, userId, timezone, localNow(timezone).date);
    if (!data) return [];
    return buildEventPhoneAlarms({ ...data, timezone, now, days });
  } catch {
    return [];
  }
}
