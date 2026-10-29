"use server";

// Note templates (like Notion's database templates): create / duplicate / delete them, their settings
// (default, "Use for Type", schedule), and making notes from them. Runs as the signed-in user (RLS).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTagsFor, setTags } from "@/lib/tags";
import { getSettings } from "@/lib/agenda";
import { duplicateTemplateTree, isEmptyContent, makeFromTemplate, makeNextScheduledNow, softDeleteTree } from "@/lib/notes-db/templates";
import { cleanSchedule, dueKey, timingChanged } from "@/lib/notes-db/tpl-core";
import { READONLY_TYPES, type NoteProperty, type PropValue, type TemplateConfig } from "@/lib/notes-db/types";
import { isBuiltinRelation } from "@/lib/notes-db/builtins";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

function refresh(...ids: (string | null | undefined)[]) {
  revalidatePath("/notes");
  for (const id of ids) if (id) revalidatePath(`/notes/${id}`);
}

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

async function templateRow(sb: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  const { data } = await sb.from("notes").select("id,title,template,is_template").eq("id", id).eq("user_id", userId).eq("is_template", true).is("deleted_at", null).maybeSingle();
  const r = data as { id: string; title: string; template: TemplateConfig | null } | null;
  return r && !r.template?.child ? r : null;
}

/** "+ New template": an empty template page (open it to write it). */
export async function createTemplate(title?: string): Promise<Result<{ id: string }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data, error } = await sb
    .from("notes")
    .insert({ user_id: userId, title: String(title ?? "").trim().slice(0, 500) || "Untitled", content: "", is_template: true, template: {} })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't create the template." };
  refresh();
  return { ok: true, id: data.id as string };
}

export async function duplicateTemplate(id: string): Promise<Result<{ id: string }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  try {
    const newId = await duplicateTemplateTree(sb, userId, id);
    refresh(id);
    return { ok: true, id: newId };
  } catch (e) {
    return { error: msg(e, "Couldn't duplicate it.") };
  }
}

/** Deletes the template and its sub-pages (the notes made from it stay). */
export async function deleteTemplate(id: string): Promise<Result> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!(await templateRow(sb, userId, id))) return { error: "That template no longer exists." };
  try {
    await softDeleteTree(sb, userId, [id]);
    refresh(id);
    return { ok: true };
  } catch (e) {
    return { error: msg(e, "Couldn't delete it.") };
  }
}

/** Default, "Use for Type", schedule. Only one default; one template per Type. */
export async function updateTemplateConfig(id: string, patch: Partial<TemplateConfig>): Promise<Result<{ config: TemplateConfig }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row = await templateRow(sb, userId, id);
  if (!row) return { error: "That template no longer exists." };
  const cur: TemplateConfig = row.template ?? {};
  const next: TemplateConfig = { ...cur };

  if ("isDefault" in patch) next.isDefault = !!patch.isDefault;
  if ("forType" in patch) {
    const f = patch.forType;
    if (f) {
      const { data: tp } = await sb.from("note_properties").select("config").eq("user_id", userId).eq("key", "type").eq("builtin", true).is("deleted_at", null).maybeSingle();
      const opts = ((tp as { config?: NoteProperty["config"] } | null)?.config?.options ?? []).map((o) => o.id);
      if (!opts.includes(f)) return { error: "That Type option no longer exists." };
      next.forType = f;
    } else next.forType = null;
  }
  if ("schedule" in patch) {
    next.schedule = cleanSchedule(patch.schedule ?? null);
    // Turned on or moved: start from the next date, don't make the ones already past
    if (timingChanged(cur.schedule ?? null, next.schedule)) {
      const { timezone } = await getSettings(sb);
      const past = dueKey(next.schedule, timezone, new Date(), null);
      if (past && (!next.lastKey || past > next.lastKey)) next.lastKey = past;
    }
  }

  // Only one default, one template per Type
  if ((next.isDefault && !cur.isDefault) || (next.forType && next.forType !== cur.forType)) {
    const { data: others } = await sb.from("notes").select("id,template").eq("user_id", userId).eq("is_template", true).is("deleted_at", null).neq("id", id);
    for (const o of (others ?? []) as { id: string; template: TemplateConfig | null }[]) {
      const t = { ...(o.template ?? {}) };
      let changed = false;
      if (next.isDefault && t.isDefault) {
        t.isDefault = false;
        changed = true;
      }
      if (next.forType && t.forType === next.forType) {
        t.forType = null;
        changed = true;
      }
      if (changed) await sb.from("notes").update({ template: t }).eq("id", o.id).eq("user_id", userId);
    }
  }

  const { error } = await sb.from("notes").update({ template: next }).eq("id", id).eq("user_id", userId);
  if (error) return { error: error.message };
  refresh(id);
  return { ok: true, config: next };
}

/** Values from the screen (board column, filters that are on): only real, editable properties. Tags apart. */
async function screenValues(sb: Awaited<ReturnType<typeof createClient>>, userId: string, values: Record<string, unknown> | undefined) {
  const out: Record<string, PropValue> = {};
  const tags: string[] = [];
  if (!values || !Object.keys(values).length) return { values: out, tags };
  const { data } = await sb.from("note_properties").select("id,key,type,builtin,config").eq("user_id", userId).is("deleted_at", null);
  const props = (data ?? []) as NoteProperty[];
  for (const [pid, v] of Object.entries(values)) {
    const p = props.find((x) => x.id === pid);
    if (!p || v === undefined || v === null || v === "") continue;
    if (p.type === "tags") {
      if (Array.isArray(v)) tags.push(...v.filter((x): x is string => typeof x === "string"));
      continue;
    }
    if (READONLY_TYPES.includes(p.type) || p.type === "ai_summary" || isBuiltinRelation(p)) continue;
    if ((p.type === "select" || p.type === "status") && !(p.config?.options ?? []).some((o) => o.id === v)) continue;
    out[p.id] = v as PropValue;
  }
  return { values: out, tags };
}

/** A new note from a template (manual: today's date for the variables). */
export async function createFromTemplate(templateId: string, opts: { values?: Record<string, unknown>; parentId?: string | null } = {}): Promise<Result<{ id: string }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  try {
    const { values, tags } = await screenValues(sb, userId, opts.values);
    const made = await makeFromTemplate(sb, userId, templateId, { values, parentId: opts.parentId ?? null });
    if (tags.length) {
      const have = ((await getTagsFor(sb, "note", [made.id])).get(made.id) ?? []).map((t) => t.name);
      await setTags(sb, "note", made.id, [...new Set([...have, ...tags])].slice(0, 30));
    }
    refresh(made.id, opts.parentId);
    return { ok: true, id: made.id };
  } catch (e) {
    return { error: msg(e, "Couldn't create the note.") };
  }
}

/** "Start with a template" on an empty note: fills it (same note; its title only if it has none). */
export async function applyTemplateToNote(noteId: string, templateId: string): Promise<Result> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data } = await sb.from("notes").select("id,content,is_template").eq("id", noteId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  const note = data as { id: string; content: string; is_template: boolean } | null;
  if (!note) return { error: "Note not found." };
  if (note.is_template) return { error: "This is a template." };
  if (!isEmptyContent(note.content)) return { error: "This note already has text." };
  try {
    await makeFromTemplate(sb, userId, templateId, { intoNoteId: noteId });
    refresh(noteId);
    return { ok: true };
  } catch (e) {
    return { error: msg(e, "Couldn't apply the template.") };
  }
}

/** "Create one now" (to try a schedule): makes the next note of the schedule right away. */
export async function runScheduleNow(templateId: string): Promise<Result<{ id: string; created: boolean }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!(await templateRow(sb, userId, templateId))) return { error: "That template no longer exists." };
  try {
    const made = await makeNextScheduledNow(sb, userId, templateId);
    refresh(templateId, made.id);
    return { ok: true, id: made.id, created: made.created };
  } catch (e) {
    return { error: msg(e, "Couldn't create it.") };
  }
}
