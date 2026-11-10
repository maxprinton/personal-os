"use server";
// Template Manager add-on — server actions (library of project-management template FILES).
// Files are uploaded from the browser straight to the private "note-files" bucket (your own folder);
// these actions only write the rows, so nothing large passes through the server.
import { revalidatePath } from "next/cache";
import { BASE } from "@/lib/file-templates/constants";
import { isMissingTm, removeStored, tmServer } from "@/lib/file-templates/db";
import { catalogRows, cleanPatch, formatFromName, nameFromFile } from "@/lib/file-templates/query";
import type { CatalogRow, Lang } from "@/lib/file-templates/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MIGRATION_MSG = "The Template Manager needs its tables first: run MIGRACION-0052-template-manager.sql in Supabase.";
const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

async function who() {
  const { supabase, userId } = await tmServer();
  if (!userId) throw new Error("You are signed out. Sign in again.");
  return { supabase, userId };
}

function fail(e: unknown): { ok: false; error: string } {
  const err = e as { message?: string; code?: string };
  if (isMissingTm(err)) return { ok: false, error: MIGRATION_MSG };
  return { ok: false, error: err?.message || "Something went wrong." };
}

function refresh(id?: string) {
  revalidatePath(BASE, "layout");
  if (id) revalidatePath(`${BASE}/${id}`);
}

// ------------------------------------------------------------------------------------------ import

/** Creates or updates the library templates listed in catalog.json. New ones start as "Ready to use";
 *  existing ones get the catalog's names and descriptions back but keep your status, tags, favorite and notes.
 *  Returns the id of every code and the fingerprints of the files you already have (to skip re-uploads). */
export async function importCatalogAction(json: unknown): Promise<Result<{ ids: Record<string, string>; created: number; updated: number; known: string[] }>> {
  try {
    const { rows, error } = catalogRows(json);
    if (error) return { ok: false, error };
    const { supabase, userId } = await who();
    const { data: existing, error: e1 } = await supabase.from("tm_templates").select("id, code").eq("user_id", userId).in("code", rows.map((r) => r.code));
    if (e1) throw e1;
    const have = new Map((existing ?? []).map((r) => [r.code as string, r.id as string]));
    const fresh = rows.filter((r) => !have.has(r.code));
    const old = rows.filter((r) => have.has(r.code));
    const ids: Record<string, string> = Object.fromEntries(have);
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = fresh.slice(i, i + 100).map((r: CatalogRow) => ({ ...r, user_id: userId, status: "ready" }));
      const { data, error: e2 } = await supabase.from("tm_templates").insert(chunk).select("id, code");
      if (e2) throw e2;
      for (const r of data ?? []) ids[r.code as string] = r.id as string;
    }
    for (const r of old) {
      const { error: e3 } = await supabase.from("tm_templates").update({ ...r, deleted_at: null }).eq("id", have.get(r.code)!).eq("user_id", userId);
      if (e3) throw e3;
    }
    const { data: files } = await supabase.from("tm_files").select("sha256").eq("user_id", userId).not("sha256", "is", null).limit(20000);
    refresh();
    return { ok: true, ids, created: fresh.length, updated: old.length, known: (files ?? []).map((f) => f.sha256 as string) };
  } catch (e) {
    return fail(e);
  }
}

export type FileRow = { template_id: string; lang: Lang | null; storage_path: string; file_name: string; mime: string | null; size: number; sha256: string | null };

/** Saves the rows of files already uploaded to storage (same path = replaced). */
export async function registerFilesAction(files: FileRow[]): Promise<Result<{ saved: number }>> {
  try {
    const { supabase, userId } = await who();
    const clean = files
      .filter((f) => isId(f.template_id) && typeof f.storage_path === "string" && f.storage_path.startsWith(`${userId}/templates/`) && !f.storage_path.includes(".."))
      .map((f) => ({
        user_id: userId,
        template_id: f.template_id,
        lang: f.lang === "en" || f.lang === "es" ? f.lang : null,
        role: "original",
        storage_path: f.storage_path,
        file_name: String(f.file_name).slice(0, 200),
        mime: f.mime ? String(f.mime).slice(0, 120) : null,
        size: Math.max(0, Math.round(Number(f.size) || 0)),
        sha256: f.sha256 && /^[0-9a-f]{64}$/.test(f.sha256) ? f.sha256 : null,
      }));
    if (!clean.length) return { ok: true, saved: 0 };
    const { error } = await supabase.from("tm_files").upsert(clean, { onConflict: "user_id,storage_path" });
    if (error) throw error;
    refresh();
    return { ok: true, saved: clean.length };
  } catch (e) {
    return fail(e);
  }
}

/** For files dropped in "Add templates": tells which ones you already have (same fingerprint) and creates an
 *  Inbox template for each new one. Returns, in order, the new template id or the existing template it matches. */
export async function newInboxTemplatesAction(items: { name: string; sha256: string | null }[]): Promise<Result<{ results: ({ id: string; duplicateOf?: undefined } | { id?: undefined; duplicateOf: { id: string; name: string } })[] }>> {
  try {
    const { supabase, userId } = await who();
    const hashes = items.map((i) => i.sha256).filter((h): h is string => !!h);
    const dupes = new Map<string, { id: string; name: string }>();
    if (hashes.length) {
      const { data } = await supabase.from("tm_files").select("sha256, template_id, tm_templates(name)").eq("user_id", userId).in("sha256", hashes);
      for (const r of (data ?? []) as unknown as { sha256: string; template_id: string; tm_templates: { name: string } | null }[]) {
        dupes.set(r.sha256, { id: r.template_id, name: r.tm_templates?.name ?? "a template" });
      }
    }
    const results: ({ id: string; duplicateOf?: undefined } | { id?: undefined; duplicateOf: { id: string; name: string } })[] = [];
    const seen = new Map<string, string>();
    for (const it of items.slice(0, 200)) {
      const d = it.sha256 ? dupes.get(it.sha256) : undefined;
      if (d) { results.push({ duplicateOf: d }); continue; }
      if (it.sha256 && seen.has(it.sha256)) { results.push({ duplicateOf: { id: seen.get(it.sha256)!, name: nameFromFile(it.name) } }); continue; }
      const { data, error } = await supabase
        .from("tm_templates")
        .insert({ user_id: userId, name: nameFromFile(String(it.name)).slice(0, 200), format: formatFromName(String(it.name)), grp: "other", status: "inbox" })
        .select("id")
        .single();
      if (error) throw error;
      if (it.sha256) seen.set(it.sha256, data.id as string);
      results.push({ id: data.id as string });
    }
    refresh();
    return { ok: true, results };
  } catch (e) {
    return fail(e);
  }
}

/** A template that is only a link (Google Docs, Sheets, Notion...). */
export async function addLinkTemplateAction(name: string, url: string): Promise<Result<{ id: string }>> {
  try {
    const { supabase, userId } = await who();
    const n = String(name ?? "").trim().slice(0, 200);
    const u = String(url ?? "").trim();
    if (!n) return { ok: false, error: "Give the template a name." };
    if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, error: "The link must start with http:// or https://" };
    const { data, error } = await supabase.from("tm_templates").insert({ user_id: userId, name: n, format: "link", grp: "other", status: "inbox", source_url: u }).select("id").single();
    if (error) throw error;
    refresh();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------------------------------ edits

export async function updateTemplateAction(id: string, input: Record<string, unknown>): Promise<Result> {
  try {
    if (!isId(id)) return { ok: false, error: "Unknown template." };
    const patch = cleanPatch(input);
    if (!patch) return { ok: false, error: "Nothing to save." };
    const { supabase, userId } = await who();
    const { error } = await supabase.from("tm_templates").update(patch).eq("id", id).eq("user_id", userId);
    if (error) throw error;
    refresh(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Same edit for many templates (bulk: status, favorite, phase, group...). */
export async function updateManyAction(ids: string[], input: Record<string, unknown>): Promise<Result<{ count: number }>> {
  try {
    const list = ids.filter(isId).slice(0, 1000);
    const patch = cleanPatch(input);
    if (!list.length || !patch) return { ok: false, error: "Nothing to save." };
    if ("name" in patch || "about" in patch) return { ok: false, error: "Names and descriptions are edited one template at a time." };
    const { supabase, userId } = await who();
    const { error } = await supabase.from("tm_templates").update(patch).in("id", list).eq("user_id", userId);
    if (error) throw error;
    refresh();
    return { ok: true, count: list.length };
  } catch (e) {
    return fail(e);
  }
}

/** Counts a use (you downloaded it to work on it). */
export async function recordUseAction(id: string): Promise<Result> {
  try {
    if (!isId(id)) return { ok: false, error: "Unknown template." };
    const { supabase, userId } = await who();
    const { data } = await supabase.from("tm_templates").select("times_used").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!data) return { ok: false, error: "Unknown template." };
    await supabase.from("tm_templates").update({ times_used: (data.times_used as number) + 1, last_used_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeFileAction(fileId: string): Promise<Result> {
  try {
    if (!isId(fileId)) return { ok: false, error: "Unknown file." };
    const { supabase, userId } = await who();
    const { data } = await supabase.from("tm_files").select("storage_path, template_id").eq("id", fileId).eq("user_id", userId).maybeSingle();
    if (!data) return { ok: false, error: "Unknown file." };
    await removeStored(supabase, [data.storage_path as string]);
    const { error } = await supabase.from("tm_files").delete().eq("id", fileId).eq("user_id", userId);
    if (error) throw error;
    refresh(data.template_id as string);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------------------------------ trash

export async function trashAction(ids: string[]): Promise<Result<{ count: number }>> {
  try {
    const list = ids.filter(isId);
    if (!list.length) return { ok: false, error: "Nothing selected." };
    const { supabase, userId } = await who();
    const { error } = await supabase.from("tm_templates").update({ deleted_at: new Date().toISOString() }).in("id", list).eq("user_id", userId);
    if (error) throw error;
    refresh();
    return { ok: true, count: list.length };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreAction(ids: string[]): Promise<Result<{ count: number }>> {
  try {
    const list = ids.filter(isId);
    if (!list.length) return { ok: false, error: "Nothing selected." };
    const { supabase, userId } = await who();
    const { error } = await supabase.from("tm_templates").update({ deleted_at: null }).in("id", list).eq("user_id", userId);
    if (error) throw error;
    refresh();
    return { ok: true, count: list.length };
  } catch (e) {
    return fail(e);
  }
}

/** Deletes for good (rows and stored files). Only templates already in the trash. */
export async function deleteForeverAction(ids: string[] | "all"): Promise<Result<{ count: number }>> {
  try {
    const { supabase, userId } = await who();
    let q = supabase.from("tm_templates").select("id, tm_files(storage_path)").eq("user_id", userId).not("deleted_at", "is", null);
    if (ids !== "all") {
      const list = ids.filter(isId);
      if (!list.length) return { ok: false, error: "Nothing selected." };
      q = q.in("id", list);
    }
    const { data, error } = await q.limit(2000);
    if (error) throw error;
    const rows = (data ?? []) as { id: string; tm_files: { storage_path: string }[] }[];
    await removeStored(supabase, rows.flatMap((r) => r.tm_files.map((f) => f.storage_path)));
    if (rows.length) {
      const { error: e2 } = await supabase.from("tm_templates").delete().in("id", rows.map((r) => r.id)).eq("user_id", userId);
      if (e2) throw e2;
    }
    refresh();
    return { ok: true, count: rows.length };
  } catch (e) {
    return fail(e);
  }
}
