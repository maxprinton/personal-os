"use server";
// Template Manager add-on, phase 2 — working copies: "this template, for this project", with version history.
// The original template file is never changed. New versions are uploaded from the browser to your own folder;
// these actions write the rows (and copy the first version inside storage, so nothing passes through you twice).
import { revalidatePath } from "next/cache";
import { BASE, BUCKET } from "@/lib/file-templates/constants";
import { isMissingTm, removeStored, tmServer } from "@/lib/file-templates/db";
import { copyFileName, copyPath, editableKind, fillText } from "@/lib/file-templates/query";
import { cleanProfile } from "@/lib/file-templates/fields";
import { fillKindOf } from "@/lib/file-templates/fill";
import { fillOriginal, type SourceFile } from "@/lib/file-templates/filler";
import type { CopyFill, Lang } from "@/lib/file-templates/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const MIGRATION_MSG = "Working copies need one more table: run MIGRACION-0053-template-manager-copias.sql in Supabase.";

async function who() {
  const { supabase, userId } = await tmServer();
  if (!userId) throw new Error("You are signed out. Sign in again.");
  return { supabase, userId };
}
function fail(e: unknown): { ok: false; error: string } {
  const err = e as { message?: string; code?: string };
  if (/project_id|source_file_id|filled|tm_projects|tm_field_maps/.test(err?.message ?? "")) return { ok: false, error: "Project profiles need new tables: run MIGRACION-0054-template-manager-perfiles.sql in Supabase." };
  if (isMissingTm(err) || (err?.message ?? "").includes("copy_id")) return { ok: false, error: MIGRATION_MSG };
  return { ok: false, error: err?.message || "Something went wrong." };
}
function refresh(templateId?: string, copyId?: string) {
  revalidatePath(BASE, "layout");
  if (templateId) revalidatePath(`${BASE}/${templateId}`);
  if (copyId) revalidatePath(`${BASE}/copies/${copyId}`);
}

/** Makes a working copy of one original file. With a project profile, every blank the file has (Word, Excel,
 *  PowerPoint, PDF, text) is filled from it; `answers` are values typed for this copy (saved to the profile when
 *  `saveAnswers` is on). Without a profile, text files still get {{project_name}} and {{date}}. */
export async function makeCopyAction(input: { templateId: string; fileId: string; title: string; project?: string; projectId?: string | null; answers?: Record<string, string>; saveAnswers?: boolean; note?: string }): Promise<Result<{ copyId: string; path: string; filled: number; skipped: string[] }>> {
  try {
    const { supabase, userId } = await who();
    if (!isId(input.templateId) || !isId(input.fileId)) return { ok: false, error: "Unknown template or file." };
    const title = String(input.title ?? "").trim().slice(0, 200);
    let project = String(input.project ?? "").trim().slice(0, 120) || null;
    if (!title) return { ok: false, error: "Give the copy a title." };
    const { data: tpl } = await supabase.from("tm_templates").select("id, name, times_used").eq("id", input.templateId).eq("user_id", userId).maybeSingle();
    const { data: src } = await supabase.from("tm_files").select("id, template_id, storage_path, file_name, mime, size, lang, role").eq("id", input.fileId).eq("user_id", userId).eq("template_id", input.templateId).maybeSingle();
    if (!tpl || !src) return { ok: false, error: "Unknown template or file." };

    // the project profile (phase 3), if there is one
    let profile: { id: string; name: string; data: ReturnType<typeof cleanProfile> } | null = null;
    if (isId(input.projectId)) {
      const { data: pr } = await supabase.from("tm_projects").select("id, name, data").eq("id", input.projectId).eq("user_id", userId).eq("is_defaults", false).maybeSingle();
      if (pr) {
        profile = { id: pr.id as string, name: pr.name as string, data: cleanProfile(pr.data) };
        project = profile.name;
      }
    }

    const insert: Record<string, unknown> = { user_id: userId, template_id: input.templateId, title, project, lang: src.lang ?? null };
    if (profile) Object.assign(insert, { project_id: profile.id, source_file_id: src.id });
    const { data: copy, error: e1 } = await supabase.from("tm_copies").insert(insert).select("id").single();
    if (e1) throw e1;
    const copyId = copy.id as string;
    const fileName = copyFileName(title, src.file_name as string);
    const path = copyPath(userId, input.templateId, copyId, fileName);

    let size = Number(src.size) || 0;
    let fill: CopyFill | null = null;
    const lang: Lang = src.lang === "es" ? "es" : "en";
    try {
      if (profile && fillKindOf(src.file_name as string)) {
        const r = await fillOriginal(supabase, userId, src as unknown as SourceFile, profile.data, { lang, answers: input.answers, save: !!input.saveAnswers, version: 1 });
        fill = r.fill;
        if (r.changedProfile) await supabase.from("tm_projects").update({ data: r.profile }).eq("id", profile.id).eq("user_id", userId);
        const body = new Blob([r.bytes as BlobPart], { type: (src.mime as string) || "application/octet-stream" });
        size = body.size;
        const { error: up } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: (src.mime as string) || "application/octet-stream" });
        if (up) throw up;
      } else if (editableKind(src.file_name as string)) {
        const { data: blob, error } = await supabase.storage.from(BUCKET).download(src.storage_path as string);
        if (error || !blob) throw new Error("Could not read the original file.");
        const today = new Date().toISOString().slice(0, 10);
        const text = fillText(await blob.text(), { project_name: project, date: today, version: "1.0" });
        const body = new Blob([text], { type: (src.mime as string) || "text/plain" });
        size = body.size;
        const { error: up } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: (src.mime as string) || "text/plain; charset=utf-8" });
        if (up) throw up;
      } else {
        const { error } = await supabase.storage.from(BUCKET).copy(src.storage_path as string, path);
        if (error) throw new Error(`Could not copy the file: ${error.message}`);
      }
    } catch (e) {
      await supabase.from("tm_copies").delete().eq("id", copyId).eq("user_id", userId);
      throw e;
    }

    const auto = fill ? `Filled from the profile “${profile!.name}” (${fill.filled} blank${fill.filled === 1 ? "" : "s"})` : "Created from the template";
    const { error: e2 } = await supabase.from("tm_files").insert({
      user_id: userId, template_id: input.templateId, copy_id: copyId, lang: src.lang ?? null, role: "working_copy", version: 1,
      storage_path: path, file_name: fileName, mime: src.mime ?? null, size, note: String(input.note ?? "").trim().slice(0, 500) || auto,
    });
    if (e2) {
      await removeStored(supabase, [path]);
      await supabase.from("tm_copies").delete().eq("id", copyId).eq("user_id", userId);
      throw e2;
    }
    if (fill) await supabase.from("tm_copies").update({ filled: fill, filled_at: new Date().toISOString() }).eq("id", copyId).eq("user_id", userId);
    await supabase.from("tm_templates").update({ times_used: ((tpl.times_used as number) ?? 0) + 1, last_used_at: new Date().toISOString() }).eq("id", input.templateId).eq("user_id", userId);
    if (profile) revalidatePath(`${BASE}/projects/${profile.id}`);
    refresh(input.templateId, copyId);
    return { ok: true, copyId, path, filled: fill?.filled ?? 0, skipped: fill?.skipped ?? [] };
  } catch (e) {
    return fail(e);
  }
}

/** Fills the copy again from the original with the profile as it is now, saved as a new version. Edits you made to
 *  the copy by hand are not carried over (the earlier versions stay, so nothing is lost). */
export async function refreshCopyAction(copyId: string, input: { answers?: Record<string, string> } = {}): Promise<Result<{ version: number; filled: number }>> {
  try {
    if (!isId(copyId)) return { ok: false, error: "Unknown copy." };
    const { supabase, userId } = await who();
    const { data: copy } = await supabase.from("tm_copies").select("id, template_id, title, lang, project_id, source_file_id, filled").eq("id", copyId).eq("user_id", userId).maybeSingle();
    if (!copy?.project_id || !copy.source_file_id) return { ok: false, error: "This copy was not filled from a project profile." };
    const { data: pr } = await supabase.from("tm_projects").select("id, name, data").eq("id", copy.project_id).eq("user_id", userId).maybeSingle();
    const { data: src } = await supabase.from("tm_files").select("id, template_id, storage_path, file_name, mime, lang").eq("id", copy.source_file_id).eq("user_id", userId).maybeSingle();
    if (!pr) return { ok: false, error: "The project profile was deleted." };
    if (!src) return { ok: false, error: "The original file of this template was removed, so the copy can't be filled again." };
    const { data: last } = await supabase.from("tm_files").select("version").eq("copy_id", copyId).eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = ((last?.version as number | undefined) ?? 0) + 1;
    const lang: Lang = (copy.filled as CopyFill | null)?.lang ?? (copy.lang === "es" ? "es" : "en");
    const r = await fillOriginal(supabase, userId, src as unknown as SourceFile, cleanProfile(pr.data), { lang, answers: { ...((copy.filled as CopyFill | null)?.answers ?? {}), ...(input.answers ?? {}) }, version });
    const fileName = copyFileName(copy.title as string, src.file_name as string);
    const path = copyPath(userId, copy.template_id as string, copyId, fileName);
    const body = new Blob([r.bytes as BlobPart], { type: (src.mime as string) || "application/octet-stream" });
    const { error: up } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: (src.mime as string) || "application/octet-stream" });
    if (up) throw up;
    const { error } = await supabase.from("tm_files").insert({
      user_id: userId, template_id: copy.template_id, copy_id: copyId, lang: copy.lang ?? null, role: "working_copy", version,
      storage_path: path, file_name: fileName, mime: src.mime ?? null, size: body.size, note: `Filled again from the profile “${pr.name}”`,
    });
    if (error) {
      await removeStored(supabase, [path]);
      throw error;
    }
    await supabase.from("tm_copies").update({ filled: r.fill, filled_at: new Date().toISOString(), status: "active" }).eq("id", copyId).eq("user_id", userId);
    revalidatePath(`${BASE}/projects/${pr.id}`);
    refresh(copy.template_id as string, copyId);
    return { ok: true, version, filled: r.fill.filled };
  } catch (e) {
    return fail(e);
  }
}

/** Refreshes every out-of-date copy of a project in one go (each becomes a new version). */
export async function refreshProjectCopiesAction(projectId: string, copyIds: string[]): Promise<Result<{ done: number; failed: string[] }>> {
  if (!isId(projectId)) return { ok: false, error: "Unknown project." };
  const failed: string[] = [];
  let done = 0;
  for (const id of (Array.isArray(copyIds) ? copyIds : []).filter(isId).slice(0, 50)) {
    const r = await refreshCopyAction(id);
    if (r.ok) done++;
    else failed.push(r.error);
  }
  return { ok: true, done, failed };
}

/** Saves a new version that the browser already uploaded to <uid>/templates/<template>/copies/<copy>/... */
export async function addVersionAction(input: { copyId: string; storage_path: string; file_name: string; mime: string | null; size: number; sha256: string | null; note?: string }): Promise<Result<{ version: number }>> {
  try {
    const { supabase, userId } = await who();
    if (!isId(input.copyId)) return { ok: false, error: "Unknown copy." };
    const { data: copy } = await supabase.from("tm_copies").select("id, template_id, lang").eq("id", input.copyId).eq("user_id", userId).maybeSingle();
    if (!copy) return { ok: false, error: "Unknown copy." };
    const prefix = `${userId}/templates/${copy.template_id}/copies/${copy.id}/`;
    if (!String(input.storage_path).startsWith(prefix) || String(input.storage_path).includes("..")) return { ok: false, error: "That file is not in this copy's folder." };
    const { data: last } = await supabase.from("tm_files").select("version").eq("copy_id", copy.id).eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = ((last?.version as number | undefined) ?? 0) + 1;
    const { error } = await supabase.from("tm_files").insert({
      user_id: userId, template_id: copy.template_id, copy_id: copy.id, lang: copy.lang ?? null, role: "working_copy", version,
      storage_path: input.storage_path, file_name: String(input.file_name).slice(0, 200), mime: input.mime ? String(input.mime).slice(0, 120) : null,
      size: Math.max(0, Math.round(Number(input.size) || 0)), sha256: input.sha256 && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null,
      note: String(input.note ?? "").trim().slice(0, 500) || null,
    });
    if (error) throw error;
    await supabase.from("tm_copies").update({ status: "active" }).eq("id", copy.id).eq("user_id", userId).eq("status", "archived");
    await supabase.from("tm_copies").update({ updated_at: new Date().toISOString() }).eq("id", copy.id).eq("user_id", userId);
    refresh(copy.template_id as string, copy.id as string);
    return { ok: true, version };
  } catch (e) {
    return fail(e);
  }
}

export async function updateCopyAction(id: string, input: { title?: string; project?: string | null; status?: string; notes?: string | null }): Promise<Result> {
  try {
    if (!isId(id)) return { ok: false, error: "Unknown copy." };
    const patch: Record<string, unknown> = {};
    if (typeof input.title === "string" && input.title.trim()) patch.title = input.title.trim().slice(0, 200);
    if ("project" in input) patch.project = typeof input.project === "string" && input.project.trim() ? input.project.trim().slice(0, 120) : null;
    if (input.status === "active" || input.status === "done" || input.status === "archived") patch.status = input.status;
    if ("notes" in input) patch.notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 5000) : null;
    if (!Object.keys(patch).length) return { ok: false, error: "Nothing to save." };
    const { supabase, userId } = await who();
    const { data, error } = await supabase.from("tm_copies").update(patch).eq("id", id).eq("user_id", userId).select("template_id").maybeSingle();
    if (error) throw error;
    refresh(data?.template_id as string | undefined, id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Removes one version (never the last one left: delete the whole copy instead). */
export async function deleteVersionAction(fileId: string): Promise<Result> {
  try {
    if (!isId(fileId)) return { ok: false, error: "Unknown version." };
    const { supabase, userId } = await who();
    const { data: f } = await supabase.from("tm_files").select("id, copy_id, template_id, storage_path").eq("id", fileId).eq("user_id", userId).eq("role", "working_copy").maybeSingle();
    if (!f?.copy_id) return { ok: false, error: "Unknown version." };
    const { count } = await supabase.from("tm_files").select("id", { head: true, count: "exact" }).eq("copy_id", f.copy_id).eq("user_id", userId);
    if ((count ?? 0) <= 1) return { ok: false, error: "This is the only version. Delete the whole working copy instead." };
    await removeStored(supabase, [f.storage_path as string]);
    const { error } = await supabase.from("tm_files").delete().eq("id", fileId).eq("user_id", userId);
    if (error) throw error;
    refresh(f.template_id as string, f.copy_id as string);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Deletes a working copy and all its versions for good (the template and its originals stay). */
export async function deleteCopyAction(id: string): Promise<Result> {
  try {
    if (!isId(id)) return { ok: false, error: "Unknown copy." };
    const { supabase, userId } = await who();
    const { data: copy } = await supabase.from("tm_copies").select("id, template_id, tm_files(storage_path)").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!copy) return { ok: false, error: "Unknown copy." };
    await removeStored(supabase, ((copy.tm_files ?? []) as { storage_path: string }[]).map((f) => f.storage_path));
    const { error } = await supabase.from("tm_copies").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    refresh(copy.template_id as string);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
