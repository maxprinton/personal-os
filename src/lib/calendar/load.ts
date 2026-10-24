// Builds the JSON the calendar panel shows for a date range (server only).
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localNow } from "@/lib/time";
import { getChecks, getHabits } from "@/lib/calendar/habits";
import { runMaintenance } from "@/lib/calendar/maintenance";
import { getBlockTypes, getOccurrences, getSlots } from "@/lib/calendar/model";
import { getEvents, getEventTypes } from "@/lib/calendar/events";
import type { CalendarData } from "@/lib/calendar/types";

export async function userTimezone(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  return (data?.timezone as string | undefined) ?? "America/Guayaquil";
}

export async function loadCalendar(sb: SupabaseClient, userId: string, from: string, to: string): Promise<CalendarData> {
  const timezone = await userTimezone(sb, userId);
  await runMaintenance(sb, userId, timezone);
  const now = localNow(timezone);
  const [blockTypes, slots, occurrences, eventTypes, events, habits, checks] = await Promise.all([
    getBlockTypes(sb, userId, { includeDeleted: true }),
    getSlots(sb, userId, from, to),
    getOccurrences(sb, userId, from, to),
    getEventTypes(sb, userId),
    getEvents(sb, userId, from, to, timezone),
    getHabits(sb, userId, { includeRemoved: true }),
    getChecks(sb, userId, addDays(from, -1), to),
  ]);
  return {
    from,
    to,
    today: now.date,
    nowMinutes: now.minutes,
    timezone,
    blockTypes,
    slots,
    occurrences,
    eventTypes,
    events,
    habits,
    checks,
  };
}
