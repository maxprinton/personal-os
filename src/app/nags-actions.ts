"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readNags, replaceNags, type NagDraft } from "@/lib/nags/db";

type Result = { ok: true } | { error: string };

async function who() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}

/** For the event dialog: the default set and, for a saved event, its own list and whether it uses it. */
export async function getEventNags(eventId?: string): Promise<{ defaults: NagDraft[]; custom: boolean; own: NagDraft[] } | { error: string }> {
  try {
    const { sb, userId } = await who();
    const defaults = await readNags(sb, userId, null);
    if (!eventId) return { defaults, custom: false, own: [] };
    const { data: ev } = await sb.from("events").select("nags_custom").eq("id", eventId).eq("user_id", userId).maybeSingle();
    const custom = Boolean(ev?.nags_custom);
    return { defaults, custom, own: custom ? await readNags(sb, userId, eventId) : [] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read the nags." };
  }
}

/** Settings: the default set for every event, and the time all-day events use. */
export async function saveDefaultNags(input: { nags: NagDraft[]; allDayTime: string }): Promise<Result> {
  try {
    const { sb, userId } = await who();
    const time = /^\d{2}:\d{2}$/.test(input.allDayTime) ? input.allDayTime : "09:00";
    const { error } = await sb.from("user_settings").update({ nag_allday_time: time }).eq("user_id", userId);
    if (error) return { error: error.message };
    await replaceNags(sb, userId, null, input.nags ?? []);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the nags." };
  }
}
