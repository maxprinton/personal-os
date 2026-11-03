// Block notes (server only): one note per block NAME, shared by every appearance of that block,
// like LifeOS's savedNotes[name]. Rows live in `notes` with block_name set (migration 0017).
// Works with the signed-in client and with the admin client (Telegram), so it filters by user_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "@/lib/calendar/edit";
import { simplifyNotionMarkdown } from "@/lib/notion-md";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";

export type BlockNote = { id: string; name: string; content: string; updated_at: string };

/** Case-insensitive key of a block name. */
export const noteKey = (name: string) => normalizeName(name).toLowerCase();

/** Every live block note of the user. Empty when migration 0017 has not been run yet. */
export async function getBlockNotes(sb: SupabaseClient, userId: string): Promise<BlockNote[]> {
  const { data, error } = await sb
    .from("notes")
    .select("id,block_name,content,updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("block_name", "is", null);
  if (error) return [];
  return ((data ?? []) as { id: string; block_name: string; content: string; updated_at: string }[]).map((n) => ({
    id: n.id,
    name: n.block_name,
    content: n.content,
    updated_at: n.updated_at,
  }));
}

/** A normal note (not a block note) linked to a block: from its "Events & blocks" property or "Link to…". */
export type BlockLinkedNote = { id: string; title: string; icon: string | null; sub: boolean };

/**
 * The normal notes linked to each block, by block_type id (what the block window and the Focus panel list as
 * "Related notes"). The block's own note is not here: it is the shared note found by name. Never throws: the calendar
 * must load even if this fails.
 */
export async function getBlockLinkedNotes(sb: SupabaseClient, userId: string): Promise<Record<string, BlockLinkedNote[]>> {
  try {
    const { data: rels, error } = await sb
      .from("entity_relations")
      .select("source_id,target_id")
      .eq("user_id", userId)
      .eq("source_type", "note")
      .eq("target_type", "block_type")
      .is("deleted_at", null);
    if (error || !rels?.length) return {};
    const links = rels as { source_id: string; target_id: string }[];
    const ids = [...new Set(links.map((r) => r.source_id))];
    const notes = new Map<string, BlockLinkedNote>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb
        .from("notes")
        .select("id,title,page,parent_id,block_name,is_template")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("id", ids.slice(i, i + 200));
      for (const n of (data ?? []) as { id: string; title: string; page: { icon?: string | null } | null; parent_id: string | null; block_name: string | null; is_template: boolean }[]) {
        if (n.block_name || n.is_template) continue;
        notes.set(n.id, { id: n.id, title: (n.title ?? "").trim() || "Untitled", icon: n.page?.icon ?? null, sub: !!n.parent_id });
      }
    }
    const out: Record<string, BlockLinkedNote[]> = {};
    for (const r of links) {
      const n = notes.get(r.source_id);
      if (!n) continue;
      const list = (out[r.target_id] ??= []);
      if (!list.some((x) => x.id === n.id)) list.push(n);
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  } catch {
    return {};
  }
}

/** key (lower-case name) → note. */
export async function blockNotesByKey(sb: SupabaseClient, userId: string) {
  return new Map((await getBlockNotes(sb, userId)).map((n) => [noteKey(n.name), n]));
}

export async function findBlockNote(sb: SupabaseClient, userId: string, name: string) {
  return (await blockNotesByKey(sb, userId)).get(noteKey(name)) ?? null;
}

/** Creates or updates the note of a block name. Returns its id. */
export async function writeBlockNote(sb: SupabaseClient, userId: string, rawName: string, content: string) {
  const name = normalizeName(rawName);
  if (!name) throw new Error("This block has no name.");
  const existing = await findBlockNote(sb, userId, name);
  if (existing) {
    const { error } = await sb
      .from("notes")
      .update({ content, title: name, block_name: name })
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return existing.id;
  }
  const { data, error } = await sb
    .from("notes")
    .insert({ user_id: userId, title: name, content, block_name: name })
    .select("id")
    .single();
  if (error || !data) {
    // Created a moment ago by another save (two devices / two windows): update that one
    if (error?.code === "23505") {
      const again = await findBlockNote(sb, userId, name);
      if (again) {
        await sb.from("notes").update({ content, title: name, block_name: name }).eq("id", again.id).eq("user_id", userId);
        return again.id;
      }
    }
    if (error && /block_name/.test(error.message)) {
      throw new Error("Block notes need migration 0017. Run MIGRACION-0017-notas-de-bloque.sql in Supabase.");
    }
    throw new Error(error?.message ?? "Could not save the note.");
  }
  return (data as { id: string }).id;
}

/**
 * "Renombrar todos": the note follows its block to the new name. If an old note of a deleted block
 * already uses the new name, that old note becomes a normal note (nothing is lost).
 */
export async function renameBlockNote(sb: SupabaseClient, userId: string, oldName: string, newName: string) {
  const map = await blockNotesByKey(sb, userId);
  const mine = map.get(noteKey(oldName));
  const theirs = noteKey(oldName) === noteKey(newName) ? null : map.get(noteKey(newName));
  if (!mine) return { parked: null as string | null }; // no note yet: an old note with the new name simply becomes its note
  let parked: string | null = null;
  if (theirs) {
    await sb
      .from("notes")
      .update({ block_name: null, title: await formerTitle(sb, theirs.name) })
      .eq("id", theirs.id)
      .eq("user_id", userId);
    parked = theirs.name;
  }
  await sb
    .from("notes")
    .update({ block_name: normalizeName(newName), title: normalizeName(newName) })
    .eq("id", mine.id)
    .eq("user_id", userId);
  return { parked };
}

/** "Solo este día" / "Este horario" with a NEW name: the new block starts with a copy of the note. */
export async function copyBlockNote(sb: SupabaseClient, userId: string, fromName: string, toName: string) {
  const map = await blockNotesByKey(sb, userId);
  const source = map.get(noteKey(fromName));
  if (!source?.content.trim() || map.has(noteKey(toName))) return false; // a note with that name already exists: it wins
  await writeBlockNote(sb, userId, toName, source.content);
  return true;
}

// ---------- Former notes (Oct 2026): a note that stopped being the note of a block ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Former · Gym · Oct 29" (the date it stopped being the block's note, in the user's timezone). */
export function formerTitleOn(name: string, ymd: string) {
  const [, m, d] = ymd.split("-").map(Number);
  return `Former · ${normalizeName(name)} · ${MONTHS[(m || 1) - 1]} ${d || 1}`;
}

/** Today's "Former · <block> · <date>" title. */
export async function formerTitle(sb: SupabaseClient, name: string) {
  const { timezone } = await getSettings(sb as never);
  return formerTitleOn(name, localNow(timezone).date);
}

/**
 * The block note of this name (if any) becomes a normal page called "Former · <block> · <date>".
 * Used when a block is deleted, when a new block takes the name of an old note, and by "Detach".
 * Returns the id of the note that was released, or null.
 */
export async function releaseBlockNote(sb: SupabaseClient, userId: string, name: string) {
  const note = await findBlockNote(sb, userId, name);
  if (!note) return null;
  const { error } = await sb
    .from("notes")
    .update({ block_name: null, title: await formerTitle(sb, note.name) })
    .eq("id", note.id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return note.id;
}

/** Plain text for Telegram: no Markdown marks, checkboxes as ☐ / ☑. */
export function noteAsPlainText(md: string) {
  return simplifyNotionMarkdown(md)
    .replace(/\r\n?/g, "\n")
    // Toggles: "▸ Title" and their content below it
    .replace(/<summary>([\s\S]*?)<\/summary>/gi, "▸ $1")
    .replace(/<\/?details\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) =>
      l
        .replace(/^(\s*)[-*+]\s+\[(x|X)\]\s+/, "$1☑ ")
        .replace(/^(\s*)[-*+]\s+\[ \]\s+/, "$1☐ ")
        .replace(/^(\s*)[-*+]\s+/, "$1• ")
        .replace(/^#{1,3}\s+/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/~~([^~]+)~~/g, "$1")
        .replace(/==([^=]+)==/g, "$1")
        .replace(/\+\+([^+]+)\+\+/g, "$1")
        .replace(/^\|?\s*:?-{3,}.*$/, "")
        .replace(/\\([\\`*_{}\[\]()#+\-.!|=~<>])/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
