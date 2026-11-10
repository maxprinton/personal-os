"use server";
// Template Manager add-on, phase 3 — project profiles ("this project's details, kept once"), "My details",
// the blanks map of each original file, and AI drafts. Working copies are filled from a profile in
// file-template-copy-actions.ts.
import { revalidatePath } from "next/cache";
import { aiChat, aiJson } from "@/lib/ai";
import { withAiUsage } from "@/lib/ai-usage";
import { BASE, MIGRATION_0054 } from "@/lib/file-templates/constants";
import { isMissingTm, tmServer } from "@/lib/file-templates/db";
import { DEFAULT_KEYS, FIELD, cleanProfile, emptyProfile, labelOf, newProfile, resolveValues, valueText, type ProfileData } from "@/lib/file-templates/fields";
import { cleanMap, mergeMap, type MapItem } from "@/lib/file-templates/fill/common";
import { fillKindOf, scanFile } from "@/lib/file-templates/fill";
import { pdfInfo } from "@/lib/file-templates/fill/pdf";
import { downloadBytes, mapFor, planFor, type FillPlan } from "@/lib/file-templates/filler";
import type { Lang } from "@/lib/file-templates/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const MIGRATION_MSG = `Project profiles need new tables: run ${MIGRATION_0054} in Supabase.`;
const langOf = (l: unknown): Lang => (l === "es" ? "es" : "en");

async function who() {
  const { supabase, userId } = await tmServer();
  if (!userId) throw new Error("You are signed out. Sign in again.");
  return { supabase, userId };
}
function fail(e: unknown): { ok: false; error: string } {
  const err = e as { message?: string; code?: string };
  if (isMissingTm(err) || /project_id|filled|source_file_id/.test(err?.message ?? "")) return { ok: false, error: MIGRATION_MSG };
  if (err?.code === "23505") return { ok: false, error: "You already have a project with that name." };
  return { ok: false, error: err?.message || "Something went wrong." };
}
function refresh(projectId?: string) {
  revalidatePath(BASE, "layout");
  if (projectId) revalidatePath(`${BASE}/projects/${projectId}`);
}

// ------------------------------------------------------------------------------------------ profiles

/** Finds a profile by name, or creates it from "My details" (what every new project starts with). */
export async function ensureProjectAction(name: string, lang: Lang = "en"): Promise<Result<{ id: string; created: boolean; data: ProfileData }>> {
  try {
    const { supabase, userId } = await who();
    const clean = String(name ?? "").trim().slice(0, 120);
    if (!clean) return { ok: false, error: "Type the project's name." };
    const { data: found } = await supabase.from("tm_projects").select("id, data").eq("user_id", userId).eq("is_defaults", false).ilike("name", clean.replace(/[%_\\]/g, (c) => `\\${c}`)).maybeSingle();
    if (found) return { ok: true, id: found.id as string, created: false, data: cleanProfile(found.data) };
    const { data: def } = await supabase.from("tm_projects").select("data").eq("user_id", userId).eq("is_defaults", true).maybeSingle();
    const data = newProfile(def ? cleanProfile(def.data) : null, clean, langOf(lang));
    const { data: row, error } = await supabase.from("tm_projects").insert({ user_id: userId, name: clean, data }).select("id").single();
    if (error) throw error;
    refresh();
    return { ok: true, id: row.id as string, created: true, data };
  } catch (e) {
    return fail(e);
  }
}

/** Saves a profile. Renaming it also renames the project on its working copies. */
export async function saveProjectAction(id: string, input: { name?: string; code?: string | null; notes?: string | null; archived?: boolean; data?: unknown }): Promise<Result> {
  try {
    if (!isId(id)) return { ok: false, error: "Unknown project." };
    const { supabase, userId } = await who();
    const patch: Record<string, unknown> = {};
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
    if (typeof input.name === "string") {
      if (!name) return { ok: false, error: "The project needs a name." };
      patch.name = name;
    }
    if ("code" in input) patch.code = typeof input.code === "string" && input.code.trim() ? input.code.trim().slice(0, 60) : null;
    if ("notes" in input) patch.notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 5000) : null;
    if (typeof input.archived === "boolean") patch.archived = input.archived;
    if ("data" in input) {
      const data = cleanProfile(input.data);
      if (name && !data.scalars.project_name) data.scalars.project_name = { en: name };
      patch.data = data;
    }
    const { data: before } = await supabase.from("tm_projects").select("name").eq("id", id).eq("user_id", userId).eq("is_defaults", false).maybeSingle();
    if (!before) return { ok: false, error: "Unknown project." };
    const { error } = await supabase.from("tm_projects").update(patch).eq("id", id).eq("user_id", userId);
    if (error) throw error;
    if (name && name !== before.name) await supabase.from("tm_copies").update({ project: name }).eq("project_id", id).eq("user_id", userId);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Deletes a profile. Its working copies stay (they keep the project's name, but no longer refresh). */
export async function deleteProjectAction(id: string): Promise<Result> {
  try {
    if (!isId(id)) return { ok: false, error: "Unknown project." };
    const { supabase, userId } = await who();
    const { error } = await supabase.from("tm_projects").delete().eq("id", id).eq("user_id", userId).eq("is_defaults", false);
    if (error) throw error;
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Saves "My details" (only the shared fields are kept). With `spread`, empty fields of every profile get them too. */
export async function saveDefaultsAction(data: unknown, opts: { spread?: boolean } = {}): Promise<Result<{ updated: number }>> {
  try {
    const { supabase, userId } = await who();
    const clean = cleanProfile(data);
    const keep = emptyProfile();
    for (const k of DEFAULT_KEYS) if (clean.scalars[k]) keep.scalars[k] = clean.scalars[k];
    const { data: cur } = await supabase.from("tm_projects").select("id").eq("user_id", userId).eq("is_defaults", true).maybeSingle();
    const { error } = cur
      ? await supabase.from("tm_projects").update({ data: keep }).eq("id", cur.id).eq("user_id", userId)
      : await supabase.from("tm_projects").insert({ user_id: userId, name: "My details", is_defaults: true, data: keep });
    if (error) throw error;
    let updated = 0;
    if (opts.spread) {
      const { data: rows } = await supabase.from("tm_projects").select("id, data").eq("user_id", userId).eq("is_defaults", false);
      for (const r of rows ?? []) {
        const p = cleanProfile(r.data);
        let changed = false;
        for (const k of DEFAULT_KEYS) if (keep.scalars[k] && !p.scalars[k]) { p.scalars[k] = keep.scalars[k]; changed = true; }
        if (changed) {
          await supabase.from("tm_projects").update({ data: p }).eq("id", r.id).eq("user_id", userId);
          updated++;
        }
      }
    }
    refresh();
    return { ok: true, updated };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------------------------------ blanks of a file

export type ScanResult = { kind: string | null; items: MapItem[]; confirmed: boolean; pdf?: { pages: { w: number; h: number }[]; fields: number } };

/** Finds the blanks of one original file (keeping the choices you already saved). */
export async function scanFileAction(fileId: string): Promise<Result<ScanResult>> {
  try {
    if (!isId(fileId)) return { ok: false, error: "Unknown file." };
    const { supabase, userId } = await who();
    const { data: f } = await supabase.from("tm_files").select("id, template_id, storage_path, file_name").eq("id", fileId).eq("user_id", userId).eq("role", "original").maybeSingle();
    if (!f) return { ok: false, error: "Unknown file." };
    const kind = fillKindOf(f.file_name as string);
    if (!kind) return { ok: true, kind: null, items: [], confirmed: false };
    const bytes = await downloadBytes(supabase, f.storage_path as string);
    let scanned: MapItem[];
    try {
      scanned = await scanFile(f.file_name as string, bytes);
    } catch {
      return { ok: false, error: "I could not read this file (it may be damaged or password-protected)." };
    }
    const { data: saved } = await supabase.from("tm_field_maps").select("items, confirmed").eq("file_id", fileId).eq("user_id", userId).maybeSingle();
    const items = saved ? mergeMap((saved.items ?? []) as MapItem[], scanned) : scanned;
    const pdf = kind === "pdf" ? await pdfInfo(bytes).catch(() => undefined) : undefined;
    return { ok: true, kind, items, confirmed: !!saved?.confirmed, pdf };
  } catch (e) {
    return fail(e);
  }
}

/** Saves which blank gets which field (once per file; every copy uses it from then on). */
export async function saveMapAction(fileId: string, items: unknown): Promise<Result> {
  try {
    if (!isId(fileId)) return { ok: false, error: "Unknown file." };
    const { supabase, userId } = await who();
    const { data: f } = await supabase.from("tm_files").select("id, template_id").eq("id", fileId).eq("user_id", userId).eq("role", "original").maybeSingle();
    if (!f) return { ok: false, error: "Unknown file." };
    const clean = cleanMap(items);
    const { error } = await supabase.from("tm_field_maps").upsert({ file_id: fileId, user_id: userId, template_id: f.template_id, items: clean, confirmed: true }, { onConflict: "file_id" });
    if (error) throw error;
    revalidatePath(`${BASE}/${f.template_id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Forgets the saved map of a file (the scan's suggestions are used again). */
export async function resetMapAction(fileId: string): Promise<Result> {
  try {
    if (!isId(fileId)) return { ok: false, error: "Unknown file." };
    const { supabase, userId } = await who();
    const { error } = await supabase.from("tm_field_maps").delete().eq("file_id", fileId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Before making a copy: what the file needs from the profile that is still empty, and its "ask me" blanks. */
export async function prepareFillAction(input: { fileId: string; project: string }): Promise<Result<FillPlan & { projectId: string | null; created: boolean; lang: Lang }>> {
  try {
    if (!isId(input.fileId)) return { ok: false, error: "Unknown file." };
    const { supabase, userId } = await who();
    const { data: f } = await supabase.from("tm_files").select("id, template_id, storage_path, file_name, mime, lang").eq("id", input.fileId).eq("user_id", userId).eq("role", "original").maybeSingle();
    if (!f) return { ok: false, error: "Unknown file." };
    const lang = langOf(f.lang);
    const kind = fillKindOf(f.file_name as string);
    const name = String(input.project ?? "").trim();
    if (!name || !kind) return { ok: true, kind, confirmed: false, missing: [], asks: [], blanks: 0, projectId: null, created: false, lang };
    const p = await ensureProjectAction(name, lang);
    if (!p.ok) return p;
    const { items, confirmed } = await mapFor(supabase, userId, { id: f.id as string, template_id: f.template_id as string, storage_path: f.storage_path as string, file_name: f.file_name as string, mime: (f.mime as string) ?? null, lang });
    const v = resolveValues(p.data, lang);
    return { ok: true, ...planFor(items, v, kind, confirmed), projectId: p.id, created: p.created, lang };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------------------------------ AI drafts

function profileContext(data: ProfileData, lang: Lang) {
  const v = resolveValues(data, lang);
  const lines: string[] = [];
  for (const key of Object.keys(FIELD)) {
    if (key === "date" || key === "version") continue;
    const t = valueText(v, key);
    if (t) lines.push(`${labelOf(key, "en")}: ${t.replace(/\n/g, "; ")}`);
  }
  return lines.join("\n") || "(the profile is still empty)";
}

const LANG_NAME: Record<Lang, string> = { en: "English", es: "Spanish (neutral Latin American)" };

export type Draft = { text?: string; items?: string[]; rows?: Record<string, string>[] };

/** Drafts one profile field from the rest of the profile. Nothing is saved: you see it and decide. */
export async function draftFieldAction(input: { data: unknown; field: string; lang: Lang; hint?: string }): Promise<Result<{ draft: Draft }>> {
  try {
    const { supabase, userId } = await who();
    const f = FIELD[input.field];
    if (!f || f.group === "auto") return { ok: false, error: "Unknown field." };
    const lang = langOf(input.lang);
    const data = cleanProfile(input.data);
    const ctx = profileContext(data, lang);
    const shape =
      f.kind === "table"
        ? `{"rows": [{${(f.columns ?? []).map((c) => `"${c.key}": "${c.label.en}${c.kind === "date" ? " (YYYY-MM-DD)" : ""}"`).join(", ")}}]} with 3 to 6 rows`
        : f.kind === "list"
          ? `{"items": ["..."]} with 3 to 6 short items`
          : `{"text": "..."}`;
    const system = [
      "You help a project manager fill a project profile that is used to fill project-management templates (charter, plans, registers).",
      `Write in ${LANG_NAME[lang]}. Be concrete and specific to THIS project; never invent people's names, amounts or dates that are not in the profile (leave those cells empty).`,
      f.key === "project_goal" ? "The goal is ONE measurable sentence: what changes, by how much, by when." : "",
      f.key === "objectives" ? "Objectives are SMART: each with a measure, a target and a date within the project dates." : "",
      f.key === "risks" ? "Risks are written as cause → event → effect, with a practical response; owner empty unless a team member fits." : "",
      f.key === "milestones" ? "Milestones are dated between the start and end dates, in order." : "",
      `Answer with JSON shaped like ${shape}.`,
    ].filter(Boolean).join("\n");
    const user = `Project profile:\n${ctx}\n\nDraft the field "${f.label.en}"${input.hint ? `. Extra guidance: ${String(input.hint).slice(0, 300)}` : ""}.`;
    const out = (await withAiUsage("templates-ai", () => aiJson(system, [{ text: user }], "write"), { sb: supabase, userId })) as Record<string, unknown> | null;
    if (!out) return { ok: false, error: "The AI did not answer. Try again in a minute." };
    if (f.kind === "table" && Array.isArray(out.rows)) {
      const cols = (f.columns ?? []).map((c) => c.key);
      const rows = (out.rows as Record<string, unknown>[]).slice(0, 10).map((r) => Object.fromEntries(cols.map((c) => [c, typeof r?.[c] === "string" ? (r[c] as string).slice(0, 300) : ""])));
      return { ok: true, draft: { rows: rows.filter((r) => Object.values(r).some(Boolean)) } };
    }
    if (f.kind === "list" && Array.isArray(out.items)) return { ok: true, draft: { items: (out.items as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 10) } };
    if (typeof out.text === "string") return { ok: true, draft: { text: out.text.slice(0, 1500) } };
    return { ok: false, error: "The AI answered in an unexpected way. Try again." };
  } catch (e) {
    return fail(e);
  }
}

/** Drafts the "ask me" blanks of a template (purpose, governance...) from the project's profile. */
export async function draftBlanksAction(input: { project: string; lang: Lang; template: string; labels: string[] }): Promise<Result<{ drafts: Record<string, string> }>> {
  try {
    const { supabase, userId } = await who();
    const lang = langOf(input.lang);
    const labels = (Array.isArray(input.labels) ? input.labels : []).filter((l) => typeof l === "string" && l.trim()).slice(0, 12).map((l) => l.slice(0, 80));
    if (!labels.length) return { ok: true, drafts: {} };
    const { data: row } = await supabase.from("tm_projects").select("data").eq("user_id", userId).eq("is_defaults", false).ilike("name", String(input.project ?? "").trim()).maybeSingle();
    const ctx = profileContext(row ? cleanProfile(row.data) : emptyProfile(), lang);
    const system = [
      `You fill the empty sections of the project-management template "${String(input.template).slice(0, 120)}" for one project.`,
      `Write in ${LANG_NAME[lang]}, plainly, 1 to 4 sentences (or up to 5 short lines starting with "- ") per section, specific to the project.`,
      "Never invent names, amounts or dates that are not in the profile; write [to confirm] where one is needed.",
      `Answer with JSON: {"drafts": {${labels.map((l) => JSON.stringify(l) + ': "..."').join(", ")}}}`,
    ].join("\n");
    const res = await withAiUsage("templates-ai", () => aiChat(`${system}\nReply with ONE JSON object only.`, [{ text: `Project profile:\n${ctx}` }], { kind: "write", json: true, temperature: 0.4, maxTokens: 1800, timeoutMs: 40000 }), { sb: supabase, userId });
    if (!("text" in res)) return { ok: false, error: res.error };
    let parsed: { drafts?: Record<string, unknown> } | null = null;
    try {
      parsed = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1));
    } catch {
      parsed = null;
    }
    const drafts: Record<string, string> = {};
    for (const l of labels) {
      const v = parsed?.drafts?.[l];
      if (typeof v === "string" && v.trim()) drafts[l] = v.trim().slice(0, 1500);
    }
    if (!Object.keys(drafts).length) return { ok: false, error: "The AI did not answer in a usable way. Try again." };
    return { ok: true, drafts };
  } catch (e) {
    return fail(e);
  }
}
