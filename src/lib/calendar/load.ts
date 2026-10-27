// Builds the JSON the calendar panel shows for a date range (server only).
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localNow } from "@/lib/time";
import { getChecks, getHabits } from "@/lib/calendar/habits";
import { runMaintenance } from "@/lib/calendar/maintenance";
import { getCalendarTasks } from "@/lib/calendar/tasks";
import { getFinanceOptions } from "@/lib/calendar/payments";
import { getBlockTypes, getFreeDays, getOccurrences, getSlots } from "@/lib/calendar/model";
import { getEvents, getEventTypes } from "@/lib/calendar/events";
import type { CalendarData } from "@/lib/calendar/types";
import { getBlockNotes, noteKey } from "@/lib/block-notes";

export async function userTimezone(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  return (data?.timezone as string | undefined) ?? "America/Guayaquil";
}

export async function loadCalendar(
  sb: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  opts: { readOnly?: boolean } = {}
): Promise<CalendarData> {
  const timezone = await userTimezone(sb, userId);
  const { data: s } = await sb.from("user_settings").select("past_edit_until").eq("user_id", userId).maybeSingle();
  const until = (s?.past_edit_until as string | null | undefined) ?? null;
  const pastEditUntil = until && new Date(until).getTime() > Date.now() ? until : null;
  await runMaintenance(sb, userId, timezone);
  const now = localNow(timezone);
  const [blockTypes, slots, occurrences, eventTypes, events, habits, checks, { tasks, taskLogs }, freeDays, finance, notes] = await Promise.all([
    getBlockTypes(sb, userId, { includeDeleted: true }),
    getSlots(sb, userId, from, to),
    getOccurrences(sb, userId, from, to),
    getEventTypes(sb, userId),
    getEvents(sb, userId, from, to, timezone),
    getHabits(sb, userId, { includeRemoved: true }),
    getChecks(sb, userId, addDays(from, -1), to),
    getCalendarTasks(sb, userId, from, to, now.date),
    getFreeDays(sb, userId, from, to),
    getFinanceOptions(sb, userId),
    getBlockNotes(sb, userId),
  ]);
  // A day renamed on its own keeps its slot (so the slot does not create it again) but is no longer that block
  const slotType = new Map(slots.map((s) => [s.id, s.block_type_id]));
  for (const o of occurrences) {
    const t = o.slot_id ? slotType.get(o.slot_id) : undefined;
    if (t && t !== o.block_type_id) o.detached = true;
  }
  const blockNotes: CalendarData["blockNotes"] = {};
  for (const n of notes) blockNotes[noteKey(n.name)] = { id: n.id, content: n.content };
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
    tasks,
    taskLogs,
    freeDays: freeDays as CalendarData["freeDays"],
    finance,
    pastEditUntil,
    readOnly: Boolean(opts.readOnly),
    blockNotes,
  };
}
