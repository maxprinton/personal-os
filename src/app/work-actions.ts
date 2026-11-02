"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isDate, isTime } from "@/lib/time";
import { calcHours, hhmm, isHttpUrl, needsEvidence, rateFor, type SheetType, type WorkRole } from "@/lib/work-log";
import type { ActionState } from "@/app/actions";

function refresh() {
  revalidatePath("/work");
}

const SHEET_TYPES = ["recovery", "extra", "collaboration"];

function text(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s || null;
}

function money(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

type Parsed = {
  class_date: string;
  start_time: string;
  end_time: string;
  group_name: string;
  role: WorkRole;
  sheet_type: SheetType | null;
  requested_by: string | null;
  notes: string | null;
  hours: number;
  rate: number;
};

/** Reads and checks the class form. Rate: the typed one, otherwise your pay for that role from Settings. */
async function parseClass(form: FormData): Promise<{ error: string } | { row: Parsed }> {
  const class_date = String(form.get("class_date") ?? "");
  const start = String(form.get("start_time") ?? "");
  const end = String(form.get("end_time") ?? "");
  const group_name = String(form.get("group_name") ?? "").trim();
  const role: WorkRole = form.get("role") === "head" ? "head" : "substitute";
  const st = String(form.get("sheet_type") ?? "");
  if (!isDate(class_date)) return { error: "Pick the class date." };
  if (!isTime(start) || !isTime(end)) return { error: "Set the start and end time." };
  if (!group_name) return { error: "Write the class (for example B2-5)." };
  if (st && !SHEET_TYPES.includes(st)) return { error: "Unknown class type." };
  const requested = String(form.get("requested_by") ?? "").trim();
  // Company rules: no extra classes on your own initiative, and a collaboration names the teacher who sent the students.
  if (st === "extra" && (!requested || /^propia$/i.test(requested)))
    return { error: "A Hora Extra must be requested by another teacher or the academy. Write who asked (not “Propia”)." };
  if (st === "collaboration" && !requested) return { error: "Write which teacher sent you their students (Requested by)." };
  const hours = calcHours(start, end);
  if (hours <= 0) return { error: "The end time must be different from the start time." };
  if (hours > 12) return { error: "That is more than 12 hours — check the times." };

  let rate = money(form.get("rate"));
  if (rate !== null && Number.isNaN(rate)) return { error: "The rate must be a number like 6 or 6.50." };
  if (rate === null) {
    const supabase = await createClient();
    const { data } = await supabase.from("work_settings").select("substitute_rate,head_rate").maybeSingle();
    rate = rateFor(role, { substitute_rate: data?.substitute_rate ?? null, head_rate: data?.head_rate ?? null });
  }
  return {
    row: {
      class_date,
      start_time: hhmm(start),
      end_time: hhmm(end),
      group_name,
      role,
      sheet_type: (st || null) as SheetType | null,
      requested_by: text(form.get("requested_by")),
      notes: text(form.get("notes")),
      hours,
      rate,
    },
  };
}

export async function createWorkClass(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = await parseClass(form);
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.from("work_classes").insert(parsed.row);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function updateWorkClass(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Missing class." };
  const parsed = await parseClass(form);
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.from("work_classes").update({ ...parsed.row, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function deleteWorkClass(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("work_classes").delete().eq("id", id);
  refresh();
}

/** posted = "1" marks the video as posted (with an optional Drive link); "0" undoes it. */
export async function setVideoPosted(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Missing class." };
  const posted = form.get("posted") === "1";
  const url = text(form.get("video_url"));
  if (url && !isHttpUrl(url)) return { error: "The link must start with https://" };
  const supabase = await createClient();
  if (posted && !url) {
    // Extra and recovered hours are void without the recording, so the link is required for them.
    const { data: row } = await supabase.from("work_classes").select("sheet_type,video_url").eq("id", id).maybeSingle();
    if (row && needsEvidence(row.sheet_type) && !row.video_url) return { error: "Hora Extra and Recuperación need the Drive link of the full recording." };
  }
  const patch = posted
    ? { video_posted: true, video_posted_at: new Date().toISOString(), ...(url ? { video_url: url } : {}) }
    : { video_posted: false, video_posted_at: null };
  const { error } = await supabase.from("work_classes").update(patch).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function saveWorkSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  const sub = money(form.get("substitute_rate"));
  const head = money(form.get("head_rate"));
  if ((sub !== null && Number.isNaN(sub)) || (head !== null && Number.isNaN(head))) return { error: "Rates must be numbers like 6 or 4.50." };
  const folder = text(form.get("video_folder_url"));
  if (folder && !isHttpUrl(folder)) return { error: "The Drive folder link must start with https://" };
  const supabase = await createClient();
  const { error } = await supabase.from("work_settings").upsert(
    {
      teacher_name: text(form.get("teacher_name")),
      substitute_rate: sub ?? 6,
      head_rate: head ?? 4,
      video_folder_url: folder,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { error: error.message };
  refresh();
  return { ok: true, at: Date.now() };
}
