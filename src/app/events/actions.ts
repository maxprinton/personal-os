"use server";

import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { getEvents, hasEventsBefore } from "@/lib/calendar/events";
import { pastWindow } from "@/lib/events-tabs";
import type { CalEvent } from "@/lib/calendar/types";

/** BL-123 "Load more" in the Past tab: the 90 days before `before`. Read only. */
export async function loadPastEvents(before: string): Promise<{ events: CalEvent[]; from: string; more: boolean } | { error: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return { error: "Bad date." };
    const sb = await createClient();
    const userId = await currentUserId(sb);
    if (!userId) return { error: "You are signed out. Sign in again." };
    const tz = await userTimezone(sb, userId);
    const w = pastWindow(before);
    const events = (await getEvents(sb, userId, w.from, w.to, tz)).filter((e) => e.end_date < before);
    return { events, from: w.from, more: await hasEventsBefore(sb, userId, w.from) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}
