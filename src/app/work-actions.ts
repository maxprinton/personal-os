"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isDate, isTime } from "@/lib/time";
import { calcHours, hhmm, isHttpUrl, needsEvidence, rateFor, ruleError, type SheetType, type WorkRole, type WorkStatus } from "@/lib/work-log";
import type { ImportRow } from "@/lib/work-import";
import type { ActionState } from "@/app/actions";

function refresh() {
  revalidatePath("/work");
}

const SHEET_TYPES = ["recovery", "extra", "collaboration"];

/** Columns added by migration 0028 — a clear message instead of a database error when it has not been run. */
function friendly(message: string) {
  return /status|attendance_urls/i.test(message) && /column|schema cache/i.test(message)
    ? "Run MIGRACION-0028-registro-de-horas-extras.sql in Supabase (SQL Editor) first, then try again."
    : message;
}

const STATUSES = ["taught", "cancelled_early", "cancelled_late"];

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
  status?: WorkStatus; // only sent when it is not "taught", so saving works even before migration 0028
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
  const stRaw = String(form.get("status") ?? "taught");
  const status = (STATUSES.includes(stRaw) ? stRaw : "taught") as WorkStatus;
  const wasStatus = String(form.get("was_status") ?? "taught");
  // Company rules: no extra classes on your own initiative, and a collaboration names the teacher who sent the students.
  // (A class the student cancelled is not reported, so the rules do not apply to it.)
  const broken = status === "taught" ? ruleError(st, String(form.get("requested_by") ?? "")) : null;
  if (broken) return { error: broken };
  const hours = calcHours(start, end);
  if (hours <= 0) return { error: "The end time must be different from the start time." };
  if (hours > 12) return { error: "That is more than 12 hours — check the times." };

  let rate = money(form.get("rate"));
  if (rate !== null && Number.isNaN(rate)) return { error: "The rate must be a number like 6 or 6.50." };
  if (rate === null && status === "cancelled_early") rate = 0; // nothing was taught
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
      ...(status !== "taught" || wasStatus !== "taught" ? { status } : {}),
    },
  };
}

export async function createWorkClass(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = await parseClass(form);
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.from("work_classes").insert(parsed.row);
  if (error) return { error: friendly(error.message) };
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
  if (error) return { error: friendly(error.message) };
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

/**
 * Marks many classes at once (the checkboxes on /work). posted = true → "video posted" (no link needed: it is a manual tick,
 * e.g. for old months or videos you already uploaded); false → undo. Only touches classes that are not already in that state.
 */
export async function setVideosPosted(ids: string[], posted: boolean): Promise<ActionState> {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 500);
  if (!clean.length) return { error: "Select at least one class first." };
  const supabase = await createClient();
  const patch = posted ? { video_posted: true, video_posted_at: new Date().toISOString() } : { video_posted: false, video_posted_at: null };
  const { data, error } = await supabase.from("work_classes").update(patch).in("id", clean).eq("video_posted", !posted).select("id");
  if (error) return { error: error.message };
  refresh();
  const n = data?.length ?? 0;
  return { ok: true, at: Date.now(), info: `${n} ${n === 1 ? "class" : "classes"} ${posted ? "marked as posted" : "back to “not posted”"}.` };
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

/** Adds screenshots (links already uploaded to the private bucket from the browser) to a class's attendance. */
export async function addAttendance(id: string, urls: string[]): Promise<ActionState> {
  const clean = urls.filter((u) => typeof u === "string" && u.startsWith("/api/files/") && u.length < 600).slice(0, 20);
  if (!id || !clean.length) return { error: "Nothing to add." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_classes").select("attendance_urls").eq("id", id).maybeSingle();
  if (error) return { error: friendly(error.message) };
  const current = (data?.attendance_urls as string[] | null) ?? [];
  const next = [...new Set([...current, ...clean])].slice(0, 30);
  const { error: e2 } = await supabase.from("work_classes").update({ attendance_urls: next }).eq("id", id);
  if (e2) return { error: friendly(e2.message) };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function removeAttendance(id: string, url: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_classes").select("attendance_urls").eq("id", id).maybeSingle();
  if (error) return { error: friendly(error.message) };
  const next = ((data?.attendance_urls as string[] | null) ?? []).filter((u) => u !== url);
  const { error: e2 } = await supabase.from("work_classes").update({ attendance_urls: next }).eq("id", id);
  if (e2) return { error: friendly(e2.message) };
  refresh();
  return { ok: true, at: Date.now() };
}

/** Imports the rows read from the pasted Notion table. Rows already in the log (same day, start time and class) are skipped. */
export async function importWorkClasses(_prev: ActionState, form: FormData): Promise<ActionState> {
  let rows: ImportRow[];
  try {
    rows = JSON.parse(String(form.get("payload") ?? "[]"));
  } catch {
    return { error: "I couldn't read the table. Paste it again." };
  }
  if (!Array.isArray(rows) || !rows.length) return { error: "There is nothing to import." };
  if (rows.length > 500) return { error: "Import at most 500 classes at a time." };
  const st = String(form.get("sheet_type") ?? "");
  if (st && !SHEET_TYPES.includes(st)) return { error: "Unknown class type." };
  const requested = text(form.get("requested_by"));
  const broken = ruleError(st, requested);
  if (broken) return { error: broken };
  const role: WorkRole = form.get("role") === "head" ? "head" : "substitute";

  const supabase = await createClient();
  const { data: set } = await supabase.from("work_settings").select("substitute_rate,head_rate").maybeSingle();
  const fallback = rateFor(role, { substitute_rate: set?.substitute_rate ?? null, head_rate: set?.head_rate ?? null });

  const clean: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  for (const r of rows) {
    const group = String(r.group_name ?? "").trim().slice(0, 80);
    const hours = calcHours(String(r.start_time), String(r.end_time));
    if (!isDate(String(r.class_date)) || !isTime(String(r.start_time)) || !isTime(String(r.end_time)) || !group || hours <= 0 || hours > 12) continue;
    const rate = typeof r.rate === "number" && Number.isFinite(r.rate) && r.rate >= 0 ? r.rate : fallback;
    const url = r.video_url && isHttpUrl(String(r.video_url)) ? String(r.video_url) : null;
    clean.push({
      class_date: r.class_date,
      start_time: hhmm(String(r.start_time)),
      end_time: hhmm(String(r.end_time)),
      group_name: group,
      role,
      sheet_type: st || null,
      requested_by: requested,
      hours,
      rate,
      video_posted: !!url,
      video_url: url,
      video_posted_at: url ? now : null,
      notes: r.notes ? String(r.notes).trim().slice(0, 300) || null : null,
    });
  }
  if (!clean.length) return { error: "None of the rows could be used." };

  const dates = clean.map((c) => String(c.class_date)).sort();
  const { data: have } = await supabase.from("work_classes").select("class_date,start_time,group_name").gte("class_date", dates[0]).lte("class_date", dates[dates.length - 1]);
  const key = (d: unknown, t: unknown, g: unknown) => `${d}|${hhmm(String(t))}|${String(g).trim().toLowerCase()}`;
  const seen = new Set(((have ?? []) as { class_date: string; start_time: string; group_name: string }[]).map((h) => key(h.class_date, h.start_time, h.group_name)));
  const fresh = clean.filter((c) => {
    const k = key(c.class_date, c.start_time, c.group_name);
    if (seen.has(k)) return false;
    seen.add(k); // also drops duplicates inside the pasted text
    return true;
  });
  for (let i = 0; i < fresh.length; i += 100) {
    const { error } = await supabase.from("work_classes").insert(fresh.slice(i, i + 100));
    if (error) return { error: friendly(error.message) };
  }
  refresh();
  const skipped = rows.length - fresh.length;
  return { ok: true, at: Date.now(), info: `Imported ${fresh.length} ${fresh.length === 1 ? "class" : "classes"}${skipped ? `; ${skipped} skipped (already in the log or unusable)` : ""}.` };
}
