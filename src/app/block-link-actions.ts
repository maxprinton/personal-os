"use server";

// Linking notes to blocks (Oct 2026, the user's design). Any note can become the note of any block
// (shared by every block with that name). If the block already has a note you choose:
//  · Replace: the old note stays as a normal page called "Former · <block> · <date>".
//  · Merge:   the block keeps its note (same ID and NOTE number) and the other note's text, properties,
//             tags and links go into it. The absorbed note is soft-deleted and points to it
//             (notes.merged_into, migration 0022), so old links open the note it went into.
// A note's real identity is its hidden id; block notes are still found by the block's name
// (notes.block_name), which follows the block when it is renamed.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findBlockNote, formerTitle } from "@/lib/block-notes";
import { normalizeName } from "@/lib/calendar/edit";

type Fail = { ok?: false; error: string };
export type LinkResult =
  | { ok: true; noteId: string; notice?: string }
  | { ok?: false; needsChoice: true; block: string; current: { id: string; title: string; preview: string } }
  | Fail;

export type BlockChoice = { id: string; name: string; color: string; noteId: string | null; noteEmpty: boolean };
export type PageChoice = { id: string; title: string; icon: string | null; parentId: string | null };

type NoteRow = {
  id: string;
  title: string;
  content: string;
  block_name: string | null;
  parent_id: string | null;
  props: Record<string, unknown> | null;
  is_template?: boolean;
};

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

function refresh(...ids: (string | null | undefined)[]) {
  revalidatePath("/", "layout"); // calendar, Today, Notes
  for (const id of ids) if (id) revalidatePath(`/notes/${id}`);
}

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const blank = (md: string | null | undefined) => !String(md ?? "").replace(/<[^>]+>/g, "").replace(/[\s\-*#>|`_~[\]]+/g, "");
const preview = (md: string) => String(md ?? "").replace(/<[^>]+>/g, " ").replace(/[#*_>`~|[\]()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

async function readNote(c: Ctx, id: string): Promise<NoteRow | null> {
  const full = await c.sb
    .from("notes")
    .select("id,title,content,block_name,parent_id,props,is_template")
    .eq("id", id)
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!full.error) return (full.data as NoteRow | null) ?? null;
  const plain = await c.sb.from("notes").select("id,title,content,block_name,parent_id").eq("id", id).eq("user_id", c.userId).is("deleted_at", null).maybeSingle();
  return (plain.data as NoteRow | null) ?? null;
}

async function readBlock(c: Ctx, id: string) {
  const { data } = await c.sb.from("block_types").select("id,name,color").eq("id", id).eq("user_id", c.userId).is("deleted_at", null).maybeSingle();
  return (data as { id: string; name: string; color: string } | null) ?? null;
}

/** Every block (for "Link to a block…") with the note it has now. */
export async function listBlocksForLinking(): Promise<{ ok: true; blocks: BlockChoice[] } | Fail> {
  try {
    const c = await ctx();
    const [{ data: types }, { data: notes }] = await Promise.all([
      c.sb.from("block_types").select("id,name,color").eq("user_id", c.userId).is("deleted_at", null).order("name"),
      c.sb.from("notes").select("id,block_name,content").eq("user_id", c.userId).is("deleted_at", null).not("block_name", "is", null),
    ]);
    const byName = new Map(((notes ?? []) as { id: string; block_name: string; content: string }[]).map((n) => [n.block_name.toLowerCase(), n]));
    const blocks = ((types ?? []) as { id: string; name: string; color: string }[]).map((t) => {
      const n = byName.get(t.name.toLowerCase());
      return { id: t.id, name: t.name, color: t.color, noteId: n?.id ?? null, noteEmpty: !n || blank(n.content) };
    });
    return { ok: true, blocks };
  } catch (e) {
    return { error: errText(e, "Couldn't load your blocks.") };
  }
}

/** Pages a note can go inside (not block notes, not templates, not itself or its own sub-pages). */
export async function searchPagesForMove(q: string, noteId: string): Promise<{ ok: true; pages: PageChoice[] } | Fail> {
  try {
    const c = await ctx();
    const { data, error } = await c.sb
      .from("notes")
      .select("id,title,page,parent_id,is_template")
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .is("block_name", null)
      .order("updated_at", { ascending: false })
      .limit(2000);
    if (error) return { error: error.message };
    const rows = ((data ?? []) as { id: string; title: string; page: { icon?: string | null } | null; parent_id: string | null; is_template?: boolean }[]).filter((r) => !r.is_template);
    // Not inside itself or one of its own sub-pages
    const kids = new Map<string, string[]>();
    for (const r of rows) if (r.parent_id) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r.id]);
    const banned = new Set([noteId]);
    const stack = [noteId];
    while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) if (!banned.has(k)) (banned.add(k), stack.push(k));
    const term = q.trim().toLowerCase();
    const pages = rows
      .filter((r) => !banned.has(r.id) && (!term || (r.title || "untitled").toLowerCase().includes(term)))
      .slice(0, 30)
      .map((r) => ({ id: r.id, title: r.title || "Untitled", icon: r.page?.icon ?? null, parentId: r.parent_id }));
    return { ok: true, pages };
  } catch (e) {
    return { error: errText(e, "Couldn't search your pages.") };
  }
}

/**
 * Makes a note the note of a block. Without `mode`, if the block already has a note with text,
 * nothing changes and the answer asks to choose Replace or Merge.
 */
export async function linkNoteToBlock(input: { noteId: string; blockTypeId: string; mode?: "replace" | "merge" }): Promise<LinkResult> {
  try {
    const c = await ctx();
    const note = await readNote(c, input.noteId);
    if (!note) return { error: "That note is no longer there." };
    if (note.is_template) return { error: "Templates can't be linked to a block." };
    const block = await readBlock(c, input.blockTypeId);
    if (!block) return { error: "That block is no longer there." };
    const name = normalizeName(block.name);
    const current = await findBlockNote(c.sb, c.userId, name);
    if (current?.id === note.id) return { ok: true, noteId: note.id, notice: `It is already the note of “${name}”.` };

    if (current && !blank(current.content) && !input.mode) {
      return { needsChoice: true, block: name, current: { id: current.id, title: current.name, preview: preview(current.content) } };
    }

    if (current && input.mode === "merge") {
      await mergeNotes(c, note.id, current.id);
      refresh(note.id, current.id);
      return { ok: true, noteId: current.id, notice: `Merged into the “${name}” note. Its old link now opens this one.` };
    }

    let notice: string | undefined;
    if (current) {
      if (blank(current.content)) {
        // An empty note: nothing to keep
        await c.sb.from("notes").update({ deleted_at: new Date().toISOString(), block_name: null }).eq("id", current.id).eq("user_id", c.userId);
      } else {
        const former = await formerTitle(c.sb, name);
        const { error } = await c.sb.from("notes").update({ block_name: null, title: former }).eq("id", current.id).eq("user_id", c.userId);
        if (error) return { error: error.message };
        notice = `The previous note is kept in Notes as “${former}”.`;
      }
    }
    // The note leaves its page (the page keeps its link to it) and takes the block's name
    const { error } = await c.sb.from("notes").update({ block_name: name, title: name, parent_id: null }).eq("id", note.id).eq("user_id", c.userId);
    if (error) return { error: error.code === "23505" ? `“${name}” got a note a moment ago. Try again.` : error.message };
    refresh(note.id, current?.id);
    return { ok: true, noteId: note.id, notice };
  } catch (e) {
    return { error: errText(e, "Couldn't link the note.") };
  }
}

/** "Detach from block": the note becomes "Former · <block> · <date>"; the block starts with an empty note. */
export async function detachFromBlock(noteId: string): Promise<{ ok: true; noteId: string; notice?: string } | Fail> {
  try {
    const c = await ctx();
    const note = await readNote(c, noteId);
    if (!note) return { error: "That note is no longer there." };
    if (!note.block_name) return { ok: true, noteId, notice: "This note isn't linked to a block." };
    const former = await formerTitle(c.sb, note.block_name);
    const { error } = await c.sb.from("notes").update({ block_name: null, title: former }).eq("id", noteId).eq("user_id", c.userId);
    if (error) return { error: error.message };
    refresh(noteId);
    return { ok: true, noteId, notice: `Now a normal page: “${former}”. “${note.block_name}” starts with an empty note.` };
  } catch (e) {
    return { error: errText(e, "Couldn't detach the note.") };
  }
}

/** Calendar → block → "Change note…" → "Start a new empty note". */
export async function startNewBlockNote(blockTypeId: string): Promise<{ ok: true; notice?: string } | Fail> {
  try {
    const c = await ctx();
    const block = await readBlock(c, blockTypeId);
    if (!block) return { error: "That block is no longer there." };
    const current = await findBlockNote(c.sb, c.userId, block.name);
    if (!current) return { ok: true };
    const r = await detachFromBlock(current.id);
    if (!r.ok) return r;
    return { ok: true, notice: blank(current.content) ? undefined : r.notice };
  } catch (e) {
    return { error: errText(e, "Couldn't start a new note.") };
  }
}

// ---------- Merge ----------

/**
 * Puts note `fromId` into note `intoId`: text appended at the end, empty properties filled, tags added,
 * relations, links in other notes and sub-pages moved over. `fromId` is soft-deleted with merged_into.
 */
async function mergeNotes(c: Ctx, fromId: string, intoId: string) {
  const from = await readNote(c, fromId);
  const into = await readNote(c, intoId);
  if (!from || !into) throw new Error("One of the notes is no longer there.");
  const now = new Date().toISOString();

  // 1) Text: the block's note first, then the other note under a divider
  const a = String(into.content ?? "").replace(/\s+$/, "");
  const b = String(from.content ?? "").trim();
  const heading = from.title && from.title !== "Untitled" ? `**From “${from.title}”**\n\n` : "";
  const content = blank(b) ? a : blank(a) ? `${b}\n` : `${a}\n\n---\n\n${heading}${b}\n`;
  if (content.length > 200_000) throw new Error("Together these notes are too long to merge.");

  // 2) Properties: values the block's note doesn't have yet
  const props = { ...(into.props ?? {}) };
  for (const [k, v] of Object.entries(from.props ?? {})) {
    const empty = props[k] === undefined || props[k] === null || props[k] === "" || (Array.isArray(props[k]) && !(props[k] as unknown[]).length);
    if (empty && v !== null && v !== undefined) props[k] = v;
  }
  const patch: Record<string, unknown> = { content };
  if (into.props !== undefined) patch.props = props;
  const up = await c.sb.from("notes").update(patch).eq("id", intoId).eq("user_id", c.userId);
  if (up.error) throw new Error(up.error.message);

  // 3) Tags
  const { data: tagRows } = await c.sb
    .from("entity_tags")
    .select("id,tag_id,entity_id")
    .eq("user_id", c.userId)
    .eq("entity_type", "note")
    .is("deleted_at", null)
    .in("entity_id", [fromId, intoId]);
  const tags = (tagRows ?? []) as { id: string; tag_id: string; entity_id: string }[];
  const have = new Set(tags.filter((t) => t.entity_id === intoId).map((t) => t.tag_id));
  const add = tags.filter((t) => t.entity_id === fromId && !have.has(t.tag_id));
  if (add.length) await c.sb.from("entity_tags").insert(add.map((t) => ({ user_id: c.userId, tag_id: t.tag_id, entity_type: "note", entity_id: intoId })));
  const old = tags.filter((t) => t.entity_id === fromId).map((t) => t.id);
  if (old.length) await c.sb.from("entity_tags").update({ deleted_at: now }).in("id", old);

  // 4) Relations (tasks, events & blocks, related notes) now point to the block's note
  type Rel = { id: string; source_type: string; source_id: string; target_type: string; target_id: string; relationship_type: string };
  const { data: relRows } = await c.sb
    .from("entity_relations")
    .select("id,source_type,source_id,target_type,target_id,relationship_type")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .or(`and(source_type.eq.note,source_id.in.(${fromId},${intoId})),and(target_type.eq.note,target_id.in.(${fromId},${intoId}))`);
  const rels = (relRows ?? []) as Rel[];
  const keyOf = (r: Omit<Rel, "id">) => `${r.source_type}:${r.source_id}>${r.target_type}:${r.target_id}:${r.relationship_type}`;
  const seen = new Set(rels.filter((r) => !(r.source_type === "note" && r.source_id === fromId) && !(r.target_type === "note" && r.target_id === fromId)).map(keyOf));
  for (const r of rels) {
    const moved = { ...r };
    if (r.source_type === "note" && r.source_id === fromId) moved.source_id = intoId;
    if (r.target_type === "note" && r.target_id === fromId) moved.target_id = intoId;
    if (moved.source_id === r.source_id && moved.target_id === r.target_id) continue;
    const self = moved.source_type === moved.target_type && moved.source_id === moved.target_id;
    if (self || seen.has(keyOf(moved))) {
      await c.sb.from("entity_relations").update({ deleted_at: now }).eq("id", r.id);
      continue;
    }
    seen.add(keyOf(moved));
    const res = await c.sb.from("entity_relations").update({ source_id: moved.source_id, target_id: moved.target_id }).eq("id", r.id);
    if (res.error) await c.sb.from("entity_relations").update({ deleted_at: now }).eq("id", r.id);
  }

  // 5) Links and @mentions in other notes, and your own relation properties
  const { data: linking } = await c.sb.from("notes").select("id,content").eq("user_id", c.userId).is("deleted_at", null).ilike("content", `%${fromId}%`);
  for (const n of (linking ?? []) as { id: string; content: string }[]) {
    const next = n.content.split(fromId).join(intoId);
    if (next !== n.content) await c.sb.from("notes").update({ content: next }).eq("id", n.id).eq("user_id", c.userId);
  }
  const { data: withProps, error: propsErr } = await c.sb.from("notes").select("id,props").eq("user_id", c.userId).is("deleted_at", null).neq("id", fromId);
  if (!propsErr) {
    for (const n of (withProps ?? []) as { id: string; props: Record<string, unknown> | null }[]) {
      if (!n.props || !JSON.stringify(n.props).includes(fromId)) continue;
      const next = JSON.parse(JSON.stringify(n.props).split(fromId).join(intoId)) as Record<string, unknown>;
      // A note related to itself after the merge: drop that one link
      for (const [k, v] of Object.entries(next))
        if (Array.isArray(v) && n.id === intoId) next[k] = v.filter((x) => !(x && typeof x === "object" && (x as { id?: string }).id === intoId));
      await c.sb.from("notes").update({ props: next }).eq("id", n.id).eq("user_id", c.userId);
    }
  }

  // 6) Its sub-pages now live in the block's note
  await c.sb.from("notes").update({ parent_id: intoId }).eq("user_id", c.userId).eq("parent_id", fromId).is("deleted_at", null);

  // 7) The absorbed note: soft-deleted (can be restored), its ID and NOTE number are never reused
  const gone = await c.sb.from("notes").update({ deleted_at: now, block_name: null, merged_into: intoId }).eq("id", fromId).eq("user_id", c.userId);
  if (gone.error) {
    // Migration 0022 not run yet: still merge, without the pointer
    const again = await c.sb.from("notes").update({ deleted_at: now, block_name: null }).eq("id", fromId).eq("user_id", c.userId);
    if (again.error) throw new Error(again.error.message);
  }
}
