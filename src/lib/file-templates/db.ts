// Template Manager add-on — SERVER loaders. They use the signed-in user's client (RLS "own rows") and
// report `missing: true` instead of throwing when migration 0052 has not been run.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { BUCKET, TRASH_DAYS } from "./constants";
import type { FileTemplate, TmCopy, TmProject } from "./types";
import { cleanProfile, resolveValues, snapshot, changedKeys } from "./fields";
import type { MapItem } from "./fill/common";

type PgError = { code?: string; message?: string } | null | undefined;

export function isMissingTm(error: PgError) {
  if (!error) return false;
  const c = error.code ?? "";
  return c === "42P01" || c === "42703" || c === "PGRST204" || c === "PGRST205" || (error.message ?? "").includes("tm_");
}

export const tmServer = cache(async (): Promise<{ supabase: SupabaseClient; userId: string | null }> => {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  return { supabase, userId };
});

export const tmReady = cache(async (): Promise<{ missing: boolean }> => {
  const { supabase, userId } = await tmServer();
  if (!userId) return { missing: false };
  const { error } = await supabase.from("tm_templates").select("id", { head: true, count: "exact" }).limit(1);
  return { missing: isMissingTm(error) };
});

const SELECT = "*, tm_files(*)";

/** All templates (not in the trash) with their files. */
export async function loadTemplates(opts: { trash?: boolean } = {}): Promise<FileTemplate[]> {
  const { supabase, userId } = await tmServer();
  if (!userId) return [];
  let q = supabase.from("tm_templates").select(SELECT).eq("user_id", userId);
  q = opts.trash ? q.not("deleted_at", "is", null).order("deleted_at", { ascending: false }) : q.is("deleted_at", null);
  const { data, error } = await q.limit(5000);
  if (error) {
    if (isMissingTm(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as FileTemplate[];
}

export async function loadTemplate(id: string): Promise<FileTemplate | null> {
  const { supabase, userId } = await tmServer();
  if (!userId || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("tm_templates").select(SELECT).eq("user_id", userId).eq("id", id).maybeSingle();
  return (data as FileTemplate | null) ?? null;
}

/** Deletes for good the templates (and their stored files) that have been in the trash for 30 days or more. */
export async function purgeOldTrash(supabase: SupabaseClient, userId: string) {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const { data } = await supabase.from("tm_templates").select("id, tm_files(storage_path)").eq("user_id", userId).lt("deleted_at", cutoff).limit(200);
  const rows = (data ?? []) as { id: string; tm_files: { storage_path: string }[] }[];
  if (!rows.length) return 0;
  await removeStored(supabase, rows.flatMap((r) => r.tm_files.map((f) => f.storage_path)));
  await supabase.from("tm_templates").delete().in("id", rows.map((r) => r.id)).eq("user_id", userId);
  return rows.length;
}

export async function removeStored(supabase: SupabaseClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    if (chunk.length) await supabase.storage.from(BUCKET).remove(chunk);
  }
}

// ------------------------------------------------------------------------------------------ working copies (phase 2)

const COPY_SELECT = "*, tm_files(*), tm_templates(id, code, name, name_es, format, phase)";

/** Is migration 0053 (working copies) in place? */
export const copiesReady = cache(async (): Promise<{ missing: boolean }> => {
  const { supabase, userId } = await tmServer();
  if (!userId) return { missing: false };
  const { error } = await supabase.from("tm_copies").select("id", { head: true, count: "exact" }).limit(1);
  return { missing: isMissingTm(error) };
});

export async function loadCopies(opts: { templateId?: string } = {}): Promise<TmCopy[]> {
  const { supabase, userId } = await tmServer();
  if (!userId) return [];
  let q = supabase.from("tm_copies").select(COPY_SELECT).eq("user_id", userId);
  if (opts.templateId) q = q.eq("template_id", opts.templateId);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(2000);
  if (error) {
    if (isMissingTm(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as TmCopy[];
}

export async function loadCopy(id: string): Promise<TmCopy | null> {
  const { supabase, userId } = await tmServer();
  if (!userId || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("tm_copies").select(COPY_SELECT).eq("user_id", userId).eq("id", id).maybeSingle();
  return (data as TmCopy | null) ?? null;
}

// ------------------------------------------------------------------------------------------ project profiles (phase 3)

/** Is migration 0054 (project profiles) in place? */
export const profilesReady = cache(async (): Promise<{ missing: boolean }> => {
  const { supabase, userId } = await tmServer();
  if (!userId) return { missing: false };
  const { error } = await supabase.from("tm_projects").select("id", { head: true, count: "exact" }).limit(1);
  return { missing: isMissingTm(error) };
});

const asProject = (r: Record<string, unknown>): TmProject => ({ ...(r as unknown as TmProject), data: cleanProfile(r.data) });

/** Your project profiles (not "My details"), newest first. */
export async function loadProjects(): Promise<TmProject[]> {
  const { supabase, userId } = await tmServer();
  if (!userId) return [];
  const { data, error } = await supabase.from("tm_projects").select("*").eq("user_id", userId).eq("is_defaults", false).order("updated_at", { ascending: false }).limit(1000);
  if (error) {
    if (isMissingTm(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(asProject);
}

export async function loadProject(id: string): Promise<TmProject | null> {
  const { supabase, userId } = await tmServer();
  if (!userId || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("tm_projects").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? asProject(data) : null;
}

/** "My details": what repeats in every project. Null until you save it once. */
export async function loadDefaults(): Promise<TmProject | null> {
  const { supabase, userId } = await tmServer();
  if (!userId) return null;
  const { data } = await supabase.from("tm_projects").select("*").eq("user_id", userId).eq("is_defaults", true).maybeSingle();
  return data ? asProject(data) : null;
}

/** Saved blank maps of a template's original files (file id -> map). */
export async function loadFieldMaps(templateId: string): Promise<Record<string, { items: MapItem[]; confirmed: boolean }>> {
  const { supabase, userId } = await tmServer();
  if (!userId) return {};
  const { data, error } = await supabase.from("tm_field_maps").select("file_id, items, confirmed").eq("user_id", userId).eq("template_id", templateId);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((r) => [r.file_id as string, { items: (r.items ?? []) as MapItem[], confirmed: !!r.confirmed }]));
}

/** Which fields of a filled copy have changed in its profile since the fill (empty = up to date). */
export function outdatedKeys(copy: TmCopy, project: TmProject | null | undefined): string[] {
  const old = copy.filled?.snapshot;
  if (!old || !project) return [];
  const v = resolveValues(project.data, copy.filled?.lang ?? copy.lang ?? "en");
  return changedKeys(old, snapshot(v, Object.keys(old)));
}
