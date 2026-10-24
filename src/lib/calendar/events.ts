// Calendar v2 events layer (server only). Every query filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, utcToLocal } from "@/lib/time";
import type { CalEvent, EventType } from "@/lib/calendar/types";

export const EVENT_COLS = "id,title,event_type_id,event_date,end_date,start_time,end_time";

export type EventDbRow = {
  id: string;
  title: string;
  event_type_id: string | null;
  event_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
};

export function toCalEvent(r: EventDbRow, tz: string): CalEvent {
  if (!r.start_time || !r.end_time) {
    return { id: r.id, title: r.title, event_type_id: r.event_type_id, date: r.event_date, end_date: r.end_date, start: null, end: null };
  }
  const s = utcToLocal(r.start_time, tz);
  const e = utcToLocal(r.end_time, tz);
  // An event ending exactly at midnight belongs to the day before
  const atMidnight = e.minutes === 0 && e.date > s.date;
  return {
    id: r.id,
    title: r.title,
    event_type_id: r.event_type_id,
    date: s.date,
    end_date: atMidnight ? addDays(e.date, -1) : e.date,
    start: s.minutes,
    end: atMidnight ? 1440 : e.minutes,
  };
}

export async function getEventTypes(sb: SupabaseClient, userId: string): Promise<EventType[]> {
  const { data } = await sb
    .from("event_types")
    .select("id,name,color")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("name");
  return (data ?? []) as EventType[];
}

/** Events that touch any day between from and to (inclusive). */
export async function getEvents(sb: SupabaseClient, userId: string, from: string, to: string, tz: string) {
  const { data } = await sb
    .from("events")
    .select(EVENT_COLS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .lte("event_date", to)
    .gte("end_date", from)
    .order("event_date")
    .order("start_time", { nullsFirst: true });
  return ((data ?? []) as EventDbRow[]).map((r) => toCalEvent(r, tz));
}

