"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { buildRRule, isWeekday, localNow, zonedToUtc } from "@/lib/time";

export type ActionState = { error?: string; ok?: boolean; at?: number };

function refresh() {
  revalidatePath("/");
  revalidatePath("/blocks");
  revalidatePath("/events");
}

export async function createBlock(_prev: ActionState, form: FormData): Promise<ActionState> {
  const title = String(form.get("title") ?? "").trim();
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  const days = form.getAll("days").map(String).filter(isWeekday);
  if (!title) return { error: "Title is required." };
  if (!start || !end || end <= start) return { error: "End time must be after start time." };
  if (!days.length) return { error: "Pick at least one day." };

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const color = String(form.get("color") ?? "");
  const { error } = await supabase.from("time_blocks").insert({
    title,
    start_time: start,
    end_time: end,
    rrule: buildRRule(days),
    timezone,
    valid_from: localNow(timezone).date,
    is_habit: form.get("is_habit") === "on",
    color: color || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function deleteBlock(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("time_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

export async function createEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const title = String(form.get("title") ?? "").trim();
  const date = String(form.get("date") ?? "");
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  const fulfills = String(form.get("fulfills") ?? "");
  if (!title) return { error: "Title is required." };
  if (!date || !start || !end) return { error: "Date, start and end are required." };
  if (end <= start) return { error: "End time must be after start time." };

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const { data, error } = await supabase
    .from("events")
    .insert({
      title,
      start_time: zonedToUtc(date, start, timezone).toISOString(),
      end_time: zonedToUtc(date, end, timezone).toISOString(),
      is_habit: form.get("is_habit") === "on",
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create event." };

  if (fulfills) {
    const { error: relError } = await supabase.from("entity_relations").insert({
      source_type: "event",
      source_id: data.id,
      target_type: "time_block",
      target_id: fulfills,
      relationship_type: "fulfills",
    });
    if (relError) return { error: `Event saved, but link failed: ${relError.message}` };
  }
  refresh();
  return { ok: true, at: Date.now() };
}

export async function deleteEvent(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase
    .from("entity_relations")
    .update({ deleted_at: now })
    .eq("source_type", "event")
    .eq("source_id", id);
  await supabase.from("events").update({ deleted_at: now }).eq("id", id);
  refresh();
}
