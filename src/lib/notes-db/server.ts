// Server side of the notes database: makes sure the built-in properties exist, loads every note with
// its values, tags, relations and computed numbers (words, open to-dos, backlinks). Works with the
// signed-in client (RLS) and with the admin client when userId is given (every query filters by user).
import type { SupabaseClient } from "@supabase/supabase-js";
import { noteAsPlainText } from "@/lib/block-notes";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { BUILTINS, isBuiltinRelation } from "@/lib/notes-db/builtins";
import { ensureStarterTemplates } from "@/lib/notes-db/templates";
import type { DbData, DbNote, NoteProperty, PropValue, RelatedItem, RelationRef, TemplateConfig, TemplateInfo } from "@/lib/notes-db/types";

type Row = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  block_name: string | null;
  page: { icon?: string | null; cover?: string | null } | null;
  parent_id: string | null;
  props: Record<string, PropValue> | null;
  seq: number | null;
  is_template: boolean;
  template: TemplateConfig | null;
  template_id: string | null;
};

export const NOTE_COLS = "id,title,content,created_at,updated_at,block_name,page,parent_id,props,seq,is_template,template,template_id";

async function uid(sb: SupabaseClient, userId?: string) {
  if (userId) return userId;
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user?.id ?? null;
}

/** Creates the built-in properties that are missing (first load, or new ones added later). */
export async function ensureBuiltins(sb: SupabaseClient, userId: string) {
  const { data, error } = await sb.from("note_properties").select("key,position").eq("user_id", userId).is("deleted_at", null);
  if (error) throw new Error(error.message.includes("note_properties") ? "Run MIGRACION-0021-notas-base-de-datos.sql in Supabase first." : error.message);
  const have = new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
  const max = Math.max(-1, ...((data ?? []) as { position: number }[]).map((r) => r.position));
  const missing = BUILTINS.filter((b) => !have.has(b.key));
  if (!missing.length) return;
  await sb.from("note_properties").insert(
    missing.map((b, i) => ({
      user_id: userId,
      key: b.key,
      name: b.name,
      type: b.type,
      config: b.config ?? {},
      position: max + 1 + BUILTINS.indexOf(b) + i * 0,
      hidden: !!b.hidden,
      builtin: true,
    })),
  );
}

export async function getProperties(sb: SupabaseClient, userId?: string): Promise<NoteProperty[]> {
  const id = await uid(sb, userId);
  if (!id) return [];
  await ensureBuiltins(sb, id);
  const { data } = await sb
    .from("note_properties")
    .select("id,key,name,type,config,position,hidden,builtin")
    .eq("user_id", id)
    .is("deleted_at", null)
    .order("position")
    .order("created_at");
  return ((data ?? []) as NoteProperty[]).map((p) => ({ ...p, config: p.config ?? {} }));
}

const NOTE_LINK = /\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** Words, open to-dos (☐ not ticked) and the notes it links to, from the note's Markdown. */
export function noteStats(md: string) {
  const text = noteAsPlainText(md ?? "");
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const openTodos = (md.match(/^\s*[-*+]\s+\[ \]\s/gm) ?? []).length;
  const links = new Set<string>();
  for (const m of md.matchAll(NOTE_LINK)) links.add(m[1].toLowerCase());
  return { text, words, openTodos, links };
}

function kindOf(r: Pick<Row, "block_name" | "parent_id">) {
  return r.block_name ? "block" : r.parent_id ? "subpage" : "page";
}

/** Titles (and done / date) of the related tasks, events, blocks and notes. */
async function relatedItems(sb: SupabaseClient, userId: string, refs: RelationRef[], notesById: Map<string, Row>) {
  const out = new Map<string, RelatedItem>();
  const ids = (t: RelationRef["type"]) => [...new Set(refs.filter((r) => r.type === t).map((r) => r.id))];
  const [tasks, events, blocks] = await Promise.all([
    ids("task").length ? sb.from("tasks").select("id,title,status,scheduled_for").eq("user_id", userId).is("deleted_at", null).in("id", ids("task")) : Promise.resolve({ data: [] }),
    ids("event").length ? sb.from("events").select("id,title,event_date").eq("user_id", userId).is("deleted_at", null).in("id", ids("event")) : Promise.resolve({ data: [] }),
    ids("block_type").length ? sb.from("block_types").select("id,name").eq("user_id", userId).is("deleted_at", null).in("id", ids("block_type")) : Promise.resolve({ data: [] }),
  ]);
  for (const t of (tasks.data ?? []) as { id: string; title: string; status: string; scheduled_for: string | null }[])
    out.set(`task:${t.id}`, { type: "task", id: t.id, title: t.title, done: t.status === "completed", date: t.scheduled_for });
  for (const e of (events.data ?? []) as { id: string; title: string; event_date: string | null }[])
    out.set(`event:${e.id}`, { type: "event", id: e.id, title: e.title, date: e.event_date });
  for (const b of (blocks.data ?? []) as { id: string; name: string }[]) out.set(`block_type:${b.id}`, { type: "block_type", id: b.id, title: b.name });
  for (const id of ids("note")) {
    const n = notesById.get(id);
    if (n) out.set(`note:${id}`, { type: "note", id, title: n.block_name ? `✏️ ${n.block_name}` : n.title || "Untitled", icon: n.page?.icon ?? null });
  }
  return out;
}

/** Everything the database screens need. Templates are not in `notes` (they come in `templates`). */
export async function getNotesDatabase(sb: SupabaseClient, opts: { userId?: string } = {}): Promise<DbData> {
  const userId = await uid(sb, opts.userId);
  const { timezone } = await getSettings(sb as never);
  const today = localNow(timezone).date;
  if (!userId) return { properties: [], notes: [], templates: [], today, timezone };
  const properties = await getProperties(sb, userId);
  await ensureStarterTemplates(sb, userId, properties).catch((e) => console.error("starter templates", e));

  const rows: Row[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await sb.from("notes").select(NOTE_COLS).eq("user_id", userId).is("deleted_at", null).order("updated_at", { ascending: false }).range(from, from + 999);
    if (error) throw new Error(error.message.includes("props") || error.message.includes("seq") ? "Run MIGRACION-0021-notas-base-de-datos.sql in Supabase first." : error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const notesRows = rows; // templates too (their page shows the values they give); split at the end
  const ids = notesRows.map((r) => r.id);

  // Tags
  const tagMap = new Map<string, { name: string; color: string | null }[]>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb
      .from("entity_tags")
      .select("entity_id,tags(name,color,deleted_at)")
      .eq("entity_type", "note")
      .is("deleted_at", null)
      .in("entity_id", ids.slice(i, i + 300));
    type TagJoin = { name: string; color: string | null; deleted_at: string | null };
    for (const r of (data ?? []) as unknown as { entity_id: string; tags: TagJoin | TagJoin[] | null }[]) {
      const t = Array.isArray(r.tags) ? r.tags[0] : r.tags;
      if (!t || t.deleted_at) continue;
      tagMap.set(r.entity_id, [...(tagMap.get(r.entity_id) ?? []), { name: t.name, color: t.color }]);
    }
  }

  // Built-in relations (entity_relations): from the note, and to the note from other notes (two-way "Related notes")
  type Rel = { source_type: string; source_id: string; target_type: string; target_id: string };
  const rels: Rel[] = [];
  {
    const { data } = await sb
      .from("entity_relations")
      .select("source_type,source_id,target_type,target_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .or("source_type.eq.note,target_type.eq.note");
    rels.push(...((data ?? []) as Rel[]));
  }
  const pTasks = properties.find((p) => p.builtin && p.key === "tasks");
  const pEvents = properties.find((p) => p.builtin && p.key === "events");
  const pRelated = properties.find((p) => p.builtin && p.key === "related");
  const refsByNote = new Map<string, Record<string, RelationRef[]>>();
  const add = (noteId: string, propId: string | undefined, ref: RelationRef) => {
    if (!propId || !byId.has(noteId)) return;
    const m = refsByNote.get(noteId) ?? {};
    const list = (m[propId] ??= []);
    if (!list.some((x) => x.type === ref.type && x.id === ref.id)) list.push(ref);
    refsByNote.set(noteId, m);
  };
  for (const r of rels) {
    if (r.source_type === "note") {
      if (r.target_type === "task") add(r.source_id, pTasks?.id, { type: "task", id: r.target_id });
      else if (r.target_type === "event" || r.target_type === "block_type") add(r.source_id, pEvents?.id, { type: r.target_type, id: r.target_id });
      else if (r.target_type === "note") {
        add(r.source_id, pRelated?.id, { type: "note", id: r.target_id });
        add(r.target_id, pRelated?.id, { type: "note", id: r.source_id }); // two-way
      }
    } else if (r.target_type === "note" && r.source_type === "task") {
      add(r.target_id, pTasks?.id, { type: "task", id: r.source_id }); // a task linked to this note
    }
  }
  // Your own relation properties (stored in props)
  const ownRelations = properties.filter((p) => p.type === "relation" && !isBuiltinRelation(p));
  for (const r of notesRows) {
    for (const p of ownRelations) {
      const v = r.props?.[p.id];
      if (Array.isArray(v)) for (const ref of v as RelationRef[]) if (ref && typeof ref === "object" && "id" in ref) add(r.id, p.id, ref);
      // two-way to notes: show on the other note too
      if (p.config.twoWay && Array.isArray(v)) for (const ref of v as RelationRef[]) if (ref?.type === "note") add(ref.id, p.id, { type: "note", id: r.id });
    }
  }
  const allRefs = [...refsByNote.values()].flatMap((m) => Object.values(m).flat());
  const items = await relatedItems(sb, userId, allRefs, byId);

  // Computed numbers + backlinks (how many notes link to each one)
  const stats = new Map(notesRows.map((r) => [r.id, noteStats(r.content ?? "")]));
  const backlinks = new Map<string, number>();
  for (const [from, s] of stats) for (const to of s.links) if (to !== from) backlinks.set(to, (backlinks.get(to) ?? 0) + 1);

  const status = properties.find((p) => p.type === "status" && p.config.defaultOptionId);
  const all: DbNote[] = notesRows.map((r) => {
    const s = stats.get(r.id)!;
    const values = { ...(r.props ?? {}) };
    // A note without a status shows the default one (new notes from the web and Telegram start in "Inbox")
    if (status && (values[status.id] === undefined || values[status.id] === null)) values[status.id] = status.config.defaultOptionId!;
    const refs = refsByNote.get(r.id) ?? {};
    const relations: Record<string, RelatedItem[]> = {};
    for (const [pid, list] of Object.entries(refs)) relations[pid] = list.map((ref) => items.get(`${ref.type}:${ref.id}`)).filter((x): x is RelatedItem => Boolean(x));
    return {
      id: r.id,
      title: r.block_name || r.title || "",
      icon: r.page?.icon ?? null,
      cover: r.page?.cover ?? null,
      parentId: r.parent_id,
      blockName: r.block_name,
      kind: kindOf(r),
      seq: r.seq,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      templateId: r.template_id,
      values,
      tags: tagMap.get(r.id) ?? [],
      relations,
      wordCount: s.words,
      openTodos: s.openTodos,
      backlinks: backlinks.get(r.id.toLowerCase()) ?? 0,
      text: s.text.slice(0, 4000),
      content: r.content ?? "",
    };
  });

  const templateIds = new Set(rows.filter((r) => r.is_template).map((r) => r.id));
  const notes = all.filter((n) => !templateIds.has(n.id));
  const templateNotes = all.filter((n) => templateIds.has(n.id));
  const templates: TemplateInfo[] = rows
    .filter((r) => r.is_template && !r.template?.child)
    .map((r) => ({ id: r.id, title: r.title || "Untitled template", icon: r.page?.icon ?? null, config: r.template ?? {} }));

  return { properties, notes, templates, templateNotes, today, timezone };
}

/** One note (for its page): the same data as the database row. */
export async function getNoteRow(sb: SupabaseClient, noteId: string, opts: { userId?: string } = {}) {
  const db = await getNotesDatabase(sb, opts);
  const note = db.notes.find((n) => n.id === noteId) ?? db.templateNotes?.find((n) => n.id === noteId) ?? null;
  return { ...db, note, template: db.templates.find((t) => t.id === noteId) ?? null };
}
