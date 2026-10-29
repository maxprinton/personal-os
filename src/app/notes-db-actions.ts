"use server";

// The notes database: change a note's property values, and create / edit / delete the properties and
// their options. Everything runs as the signed-in user (RLS). Migration 0021.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setTags } from "@/lib/tags";
import { getNotesDatabase, getProperties } from "@/lib/notes-db/server";
import { isBuiltinRelation } from "@/lib/notes-db/builtins";
import { applyTypeTemplate } from "@/lib/notes-db/templates";
import { CREATABLE_TYPES, READONLY_TYPES, newId, type DateValue, type DbData, type FileValue, type NoteProperty, type PropConfig, type PropType, type PropValue, type RelatedItem, type RelationRef, type RelationTarget, type SelectOption } from "@/lib/notes-db/types";
import { COLOR_NAMES, type ColorName } from "@/lib/editor/colors";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

function refresh(noteId?: string) {
  revalidatePath("/notes");
  if (noteId) revalidatePath(`/notes/${noteId}`);
}

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

/** The whole database again (after a change, or to refresh a view). */
export async function loadNotesDatabase(): Promise<Result<{ data: DbData }>> {
  try {
    const { sb } = await ctx();
    return { ok: true, data: await getNotesDatabase(sb) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load the notes." };
  }
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown): s is string => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

/** Checks and cleans a value for a property type. undefined = invalid. */
function clean(prop: NoteProperty, v: unknown): PropValue | undefined {
  if (v === null || v === undefined || v === "") return null;
  const ids = new Set((prop.config.options ?? []).map((o) => o.id));
  switch (prop.type) {
    case "text":
    case "phone":
      return typeof v === "string" ? v.slice(0, 2000) : undefined;
    case "url": {
      if (typeof v !== "string") return undefined;
      const t = v.trim();
      return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t.slice(0, 2000) : `https://${t}`.slice(0, 2000);
    }
    case "email":
      return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim() : undefined;
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    }
    case "select":
    case "status":
      return typeof v === "string" && ids.has(v) ? v : undefined;
    case "multi_select":
      return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ids.has(x)))] : undefined;
    case "checkbox":
      return Boolean(v);
    case "date": {
      const d = v as DateValue;
      if (!d || !isDate(d.start)) return undefined;
      return { start: d.start, end: isDate(d.end) && d.end >= d.start ? d.end : null, time: isTime(d.time) ? d.time : null };
    }
    case "files":
      return Array.isArray(v)
        ? (v as FileValue[]).filter((f) => f && typeof f.url === "string" && f.url).slice(0, 30).map((f) => ({ url: f.url, name: String(f.name ?? "file").slice(0, 200), size: typeof f.size === "number" ? f.size : undefined }))
        : undefined;
    case "relation":
      return Array.isArray(v)
        ? (v as RelationRef[]).filter((r) => r && ["note", "task", "event", "block_type"].includes(r.type) && typeof r.id === "string").slice(0, 100).map((r) => ({ type: r.type, id: r.id }))
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Sets one value. propId = a property id, or "title". Tags take the tag names (string[]).
 * Built-in relations (Tasks, Events & blocks, Related notes) are saved as links (entity_relations).
 */
export async function setNoteValue(noteId: string, propId: string, value: unknown): Promise<Result<{ templateApplied?: boolean }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!noteId) return { error: "Missing note." };

  if (propId === "title") {
    const { error } = await sb.from("notes").update({ title: String(value ?? "").trim().slice(0, 500) || "Untitled" }).eq("id", noteId);
    if (error) return { error: error.message };
    refresh(noteId);
    return { ok: true };
  }

  const props = await getProperties(sb, userId);
  const prop = props.find((p) => p.id === propId);
  if (!prop) return { error: "That property no longer exists." };
  if (READONLY_TYPES.includes(prop.type) || prop.type === "ai_summary") return { error: `${prop.name} fills itself.` };

  if (prop.type === "tags") {
    const names = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").map((x) => x.trim().replace(/^#/, "")).filter(Boolean) : [];
    await setTags(sb, "note", noteId, [...new Set(names)].slice(0, 30));
    refresh(noteId);
    return { ok: true };
  }

  if (isBuiltinRelation(prop)) {
    const refs = (clean(prop, value) as RelationRef[] | null) ?? [];
    const allowed = prop.key === "tasks" ? ["task"] : prop.key === "events" ? ["event", "block_type"] : ["note"];
    const want = refs.filter((r) => allowed.includes(r.type) && !(r.type === "note" && r.id === noteId));
    const types = prop.key === "events" ? ["event", "block_type"] : allowed;
    const { data: existing } = await sb
      .from("entity_relations")
      .select("id,source_type,source_id,target_type,target_id")
      .is("deleted_at", null)
      .or(
        prop.key === "related"
          ? `and(source_type.eq.note,source_id.eq.${noteId},target_type.eq.note),and(target_type.eq.note,target_id.eq.${noteId},source_type.eq.note)`
          : prop.key === "tasks"
            ? `and(source_type.eq.note,source_id.eq.${noteId},target_type.eq.task),and(source_type.eq.task,target_type.eq.note,target_id.eq.${noteId})`
            : `and(source_type.eq.note,source_id.eq.${noteId},target_type.in.(${types.join(",")}))`,
      );
    type Rel = { id: string; source_type: string; source_id: string; target_type: string; target_id: string };
    const rows = (existing ?? []) as Rel[];
    const other = (r: Rel): RelationRef => (r.source_type === "note" && r.source_id === noteId ? { type: r.target_type as RelationRef["type"], id: r.target_id } : { type: r.source_type as RelationRef["type"], id: r.source_id });
    const has = (ref: RelationRef) => want.some((w) => w.type === ref.type && w.id === ref.id);
    const gone = rows.filter((r) => !has(other(r))).map((r) => r.id);
    if (gone.length) await sb.from("entity_relations").update({ deleted_at: new Date().toISOString() }).in("id", gone);
    const current = rows.map(other);
    const added = want.filter((w) => !current.some((c) => c.type === w.type && c.id === w.id));
    if (added.length) {
      const { error } = await sb.from("entity_relations").insert(
        added.map((w) => ({ source_type: "note", source_id: noteId, target_type: w.type, target_id: w.id, relationship_type: "mentions" })),
      );
      if (error) return { error: error.message };
    }
    refresh(noteId);
    return { ok: true };
  }

  const v = clean(prop, value);
  if (v === undefined) return { error: `That isn't a valid ${prop.name}.` };
  const { data: row, error: e1 } = await sb.from("notes").select("props").eq("id", noteId).maybeSingle();
  if (e1 || !row) return { error: e1?.message ?? "Note not found." };
  const next = { ...((row.props as Record<string, PropValue> | null) ?? {}) };
  if (v === null) delete next[prop.id];
  else next[prop.id] = v;
  // Status cleared → back to its default, like Notion (a status is never empty)
  if (prop.type === "status" && v === null && prop.config.defaultOptionId) next[prop.id] = prop.config.defaultOptionId;
  const { error } = await sb.from("notes").update({ props: next }).eq("id", noteId);
  if (error) return { error: error.message };

  let templateApplied = false;
  if (prop.builtin && prop.key === "type" && typeof v === "string") {
    templateApplied = await applyTypeTemplate(sb, userId, noteId, v).catch(() => false);
  }
  refresh(noteId);
  return { ok: true, templateApplied };
}

const okColor = (c: unknown): ColorName => (typeof c === "string" && (COLOR_NAMES as readonly string[]).includes(c) ? (c as ColorName) : "default");
const PALETTE: ColorName[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

function defaultConfig(type: PropType): PropConfig {
  switch (type) {
    case "status":
      return {
        options: [
          { id: newId("o"), name: "Not started", color: "gray", group: "todo" },
          { id: newId("o"), name: "In progress", color: "blue", group: "in_progress" },
          { id: newId("o"), name: "Done", color: "green", group: "done" },
        ],
      };
    case "select":
    case "multi_select":
      return { options: [] };
    case "number":
      return { numberFormat: "number" };
    case "relation":
      return { target: "notes" };
    case "rollup":
      return { calc: "count" };
    case "unique_id":
      return { prefix: "" };
    default:
      return {};
  }
}

function cleanConfig(type: PropType, c: PropConfig | undefined, base: PropConfig): PropConfig {
  const out: PropConfig = { ...base, ...(c ?? {}) };
  if (out.options) {
    out.options = out.options
      .filter((o) => o && typeof o.name === "string" && o.name.trim())
      .slice(0, 200)
      .map((o) => ({ id: o.id || newId("o"), name: o.name.trim().slice(0, 100), color: okColor(o.color), ...(type === "status" ? { group: o.group ?? "todo" } : {}) }));
  }
  if (out.target && !["notes", "tasks", "events"].includes(out.target)) out.target = "notes";
  if (out.prefix !== undefined) out.prefix = String(out.prefix).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12).toUpperCase();
  return out;
}

/** "+ Add a property". Returns the new property. */
export async function createProperty(name: string, type: PropType, config?: PropConfig): Promise<Result<{ property: NoteProperty }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!CREATABLE_TYPES.includes(type)) return { error: "That type can't be created." };
  const props = await getProperties(sb, userId);
  const clean = name.trim().slice(0, 100) || "Property";
  const { data, error } = await sb
    .from("note_properties")
    .insert({ user_id: userId, key: `p_${newId()}`, name: clean, type, config: cleanConfig(type, config, defaultConfig(type)), position: Math.max(0, ...props.map((p) => p.position)) + 1, builtin: false })
    .select("id,key,name,type,config,position,hidden,builtin")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't create it." };
  refresh();
  return { ok: true, property: data as NoteProperty };
}

/** Rename, change options / format / target, hide in page, or (your own properties) change the type. */
export async function updateProperty(id: string, patch: { name?: string; type?: PropType; config?: PropConfig; hidden?: boolean }): Promise<Result<{ property: NoteProperty }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const props = await getProperties(sb, userId);
  const prop = props.find((p) => p.id === id);
  if (!prop) return { error: "That property no longer exists." };
  const type = patch.type && !prop.builtin && CREATABLE_TYPES.includes(patch.type) ? patch.type : prop.type;
  const base = type === prop.type ? prop.config : defaultConfig(type);
  // Keep options when switching between select / multi-select / status
  if (type !== prop.type && prop.config.options && ["select", "multi_select", "status"].includes(type)) base.options = prop.config.options;
  const row = {
    name: patch.name !== undefined ? patch.name.trim().slice(0, 100) || prop.name : prop.name,
    type,
    config: patch.config !== undefined || type !== prop.type ? cleanConfig(type, patch.config, base) : prop.config,
    hidden: patch.hidden ?? prop.hidden,
  };
  const { data, error } = await sb.from("note_properties").update(row).eq("id", id).select("id,key,name,type,config,position,hidden,builtin").single();
  if (error || !data) return { error: error?.message ?? "Couldn't save it." };
  refresh();
  return { ok: true, property: data as NoteProperty };
}

/** Deletes one of your properties (its values stay in the notes, unused). Built-in ones can only be hidden. */
export async function deleteProperty(id: string): Promise<Result> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const props = await getProperties(sb, userId);
  const prop = props.find((p) => p.id === id);
  if (!prop) return { ok: true };
  if (prop.builtin) return { error: `${prop.name} is built in: you can hide it, not delete it.` };
  const { error } = await sb.from("note_properties").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/** New order of the properties (all ids, first to last). */
export async function reorderProperties(ids: string[]): Promise<Result> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  await Promise.all(ids.slice(0, 300).map((id, i) => sb.from("note_properties").update({ position: i }).eq("id", id)));
  refresh();
  return { ok: true };
}

/** Typing a new option in a select / multi-select / status: creates it (random color, like Notion). */
export async function addOption(propId: string, name: string, color?: ColorName, group?: SelectOption["group"]): Promise<Result<{ option: SelectOption; property: NoteProperty }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const props = await getProperties(sb, userId);
  const prop = props.find((p) => p.id === propId);
  if (!prop || !["select", "multi_select", "status"].includes(prop.type)) return { error: "That property has no options." };
  const clean = name.trim().slice(0, 100);
  if (!clean) return { error: "Write a name." };
  const found = (prop.config.options ?? []).find((o) => o.name.toLowerCase() === clean.toLowerCase());
  if (found) return { ok: true, option: found, property: prop };
  const option: SelectOption = { id: newId("o"), name: clean, color: color ?? PALETTE[(prop.config.options?.length ?? 0) % PALETTE.length], ...(prop.type === "status" ? { group: group ?? "todo" } : {}) };
  const r = await updateProperty(propId, { config: { ...prop.config, options: [...(prop.config.options ?? []), option] } });
  if (!r.ok) return r;
  return { ok: true, option, property: r.property };
}

/** Rename / recolor / regroup an option, or delete it (notes with it become empty). */
export async function updateOption(propId: string, optionId: string, patch: { name?: string; color?: ColorName; group?: SelectOption["group"] } | null): Promise<Result<{ property: NoteProperty }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const props = await getProperties(sb, userId);
  const prop = props.find((p) => p.id === propId);
  if (!prop) return { error: "That property no longer exists." };
  const options = (prop.config.options ?? []).flatMap((o) => (o.id !== optionId ? [o] : patch === null ? [] : [{ ...o, ...patch, name: (patch.name ?? o.name).trim() || o.name }]));
  if (patch === null && prop.config.defaultOptionId === optionId) return { error: "That's the default option: pick another default first." };
  return updateProperty(propId, { config: { ...prop.config, options } });
}

/** For relation pickers: notes, tasks, or events + blocks matching the words (latest first). */
export async function searchRelationTargets(target: RelationTarget, q: string, exceptNoteId?: string): Promise<Result<{ items: RelatedItem[] }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const term = q.replace(/[%_,()*\\]/g, " ").trim().slice(0, 60);
  const like = `%${term}%`;
  const items: RelatedItem[] = [];
  if (target === "notes") {
    let query = sb.from("notes").select("id,title,block_name,page").eq("user_id", userId).is("deleted_at", null).eq("is_template", false).order("updated_at", { ascending: false }).limit(20);
    if (term) query = query.or(`title.ilike.${like},block_name.ilike.${like}`);
    const { data } = await query;
    for (const n of (data ?? []) as { id: string; title: string; block_name: string | null; page: { icon?: string | null } | null }[])
      if (n.id !== exceptNoteId) items.push({ type: "note", id: n.id, title: n.block_name ? `✏️ ${n.block_name}` : n.title || "Untitled", icon: n.page?.icon ?? null });
  } else if (target === "tasks") {
    let query = sb.from("tasks").select("id,title,status,scheduled_for").eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(20);
    if (term) query = query.ilike("title", like);
    const { data } = await query;
    const rows = (data ?? []) as { id: string; title: string; status: string; scheduled_for: string | null }[];
    rows.sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed"));
    for (const t of rows) items.push({ type: "task", id: t.id, title: t.title, done: t.status === "completed", date: t.scheduled_for });
  } else {
    let ev = sb.from("events").select("id,title,event_date").eq("user_id", userId).is("deleted_at", null).order("event_date", { ascending: false }).limit(15);
    let bl = sb.from("block_types").select("id,name").eq("user_id", userId).is("deleted_at", null).order("name").limit(15);
    if (term) {
      ev = ev.ilike("title", like);
      bl = bl.ilike("name", like);
    }
    const [e, b] = await Promise.all([ev, bl]);
    for (const x of (b.data ?? []) as { id: string; name: string }[]) items.push({ type: "block_type", id: x.id, title: x.name });
    for (const x of (e.data ?? []) as { id: string; title: string; event_date: string | null }[]) items.push({ type: "event", id: x.id, title: x.title, date: x.event_date });
  }
  return { ok: true, items };
}

/** "New" without a template: an empty note, optionally with values (e.g. the board column it was added to). */
export async function createNoteInDb(input: { title?: string; values?: Record<string, unknown>; parentId?: string | null } = {}): Promise<Result<{ id: string }>> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const props = await getProperties(sb, userId);
  const values: Record<string, PropValue> = {};
  const tagNames: string[] = [];
  for (const [pid, raw] of Object.entries(input.values ?? {})) {
    const p = props.find((x) => x.id === pid);
    if (!p) continue;
    if (p.type === "tags") {
      if (Array.isArray(raw)) tagNames.push(...raw.filter((x): x is string => typeof x === "string"));
      continue;
    }
    if (READONLY_TYPES.includes(p.type) || isBuiltinRelation(p)) continue;
    const v = clean(p, raw);
    if (v !== undefined && v !== null) values[p.id] = v;
  }
  const { data, error } = await sb
    .from("notes")
    .insert({ title: (input.title ?? "").trim().slice(0, 500) || "Untitled", props: values, parent_id: input.parentId ?? null })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't create the note." };
  if (tagNames.length) await setTags(sb, "note", data.id as string, tagNames);
  refresh();
  return { ok: true, id: data.id as string };
}
