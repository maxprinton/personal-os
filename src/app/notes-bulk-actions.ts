"use server";

// Bulk actions on several notes of the notes database: move to the trash (with undo), duplicate.
// Everything runs as the signed-in user (RLS). Edits of property values are setNoteValues
// (notes-db-actions.ts). Block notes and templates are never trashed or duplicated from here.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTagsFor, setTags } from "@/lib/tags";
import { getProperties } from "@/lib/notes-db/server";
import type { PropValue } from "@/lib/notes-db/types";

type Fail = { ok?: false; error: string };
const MAX = 200;

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

const cleanIds = (ids: unknown) => [...new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && !!x))];

/**
 * Soft-deletes the notes and their sub-pages (like deleting a page). Returns every id that went and the
 * timestamp, so restoreNotes can bring back exactly these. Block notes and templates are skipped.
 */
export async function trashNotes(ids: string[]): Promise<{ ok: true; at: string; ids: string[]; skipped: number } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const wanted = cleanIds(ids);
  if (!wanted.length) return { error: "No notes selected." };
  if (wanted.length > MAX) return { error: `That's too many notes at once (${MAX} at most).` };

  const { data, error } = await sb.from("notes").select("id,block_name,is_template").in("id", wanted).is("deleted_at", null);
  if (error) return { error: error.message };
  const rows = (data ?? []) as { id: string; block_name: string | null; is_template: boolean }[];
  const ok = rows.filter((r) => !r.block_name && !r.is_template).map((r) => r.id);
  const skipped = wanted.length - ok.length;
  if (!ok.length) return { error: skipped ? "Block notes and templates can't be trashed from here." : "Those notes are already gone." };

  // Sub-pages go with their page
  const all = [...ok];
  let level = [...ok];
  for (let i = 0; level.length && i < 20; i++) {
    const { data: kids } = await sb.from("notes").select("id").in("parent_id", level).is("deleted_at", null);
    level = ((kids ?? []) as { id: string }[]).map((r) => r.id).filter((x) => !all.includes(x));
    all.push(...level);
  }

  const at = new Date().toISOString();
  await sb.from("entity_relations").update({ deleted_at: at }).eq("source_type", "note").in("source_id", all).is("deleted_at", null);
  await sb.from("entity_tags").update({ deleted_at: at }).eq("entity_type", "note").in("entity_id", all).is("deleted_at", null);
  const { error: e2 } = await sb.from("notes").update({ deleted_at: at }).in("id", all);
  if (e2) return { error: e2.message };
  revalidatePath("/notes");
  return { ok: true, at, ids: all, skipped };
}

/** Undo of trashNotes: brings back the notes (and the links / tags that went with them) trashed at `at`. */
export async function restoreNotes(ids: string[], at: string): Promise<{ ok: true } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const list = cleanIds(ids).slice(0, MAX * 20);
  if (!list.length || typeof at !== "string" || !at) return { error: "Nothing to restore." };
  const { error } = await sb.from("notes").update({ deleted_at: null }).in("id", list).eq("deleted_at", at);
  if (error) return { error: error.message };
  await sb.from("entity_relations").update({ deleted_at: null }).eq("source_type", "note").in("source_id", list).eq("deleted_at", at);
  await sb.from("entity_tags").update({ deleted_at: null }).eq("entity_type", "note").in("entity_id", list).eq("deleted_at", at);
  revalidatePath("/notes");
  return { ok: true };
}

/**
 * A copy of each note next to it (same parent): title "… (1)", text, cover / icon, property values, tags and
 * the links it points to. The AI summary is not copied (it would describe the old note). A block note is
 * copied as a normal page. Templates are skipped.
 */
export async function duplicateNotes(ids: string[]): Promise<{ ok: true; ids: string[]; failed: number } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const wanted = cleanIds(ids);
  if (!wanted.length) return { error: "No notes selected." };
  if (wanted.length > MAX) return { error: `That's too many notes at once (${MAX} at most).` };

  const { data, error } = await sb.from("notes").select("id,title,content,page,parent_id,props,is_template").in("id", wanted).is("deleted_at", null);
  if (error) return { error: error.message };
  type Src = { id: string; title: string; content: string; page: unknown; parent_id: string | null; props: Record<string, PropValue> | null; is_template: boolean };
  const byId = new Map(((data ?? []) as Src[]).map((r) => [r.id, r]));
  const sources = wanted.map((id) => byId.get(id)).filter((r): r is Src => !!r && !r.is_template);
  if (!sources.length) return { error: "Nothing to duplicate." };

  const aiIds = new Set((await getProperties(sb, userId)).filter((p) => p.type === "ai_summary").map((p) => p.id));
  const tags = await getTagsFor(sb, "note", sources.map((s) => s.id));
  const { data: rels } = await sb
    .from("entity_relations")
    .select("source_id,target_type,target_id,relationship_type")
    .eq("source_type", "note")
    .in("source_id", sources.map((s) => s.id))
    .is("deleted_at", null);
  const relRows = (rels ?? []) as { source_id: string; target_type: string; target_id: string; relationship_type: string }[];

  const made: string[] = [];
  let failed = 0;
  for (const s of sources) {
    const props = Object.fromEntries(Object.entries(s.props ?? {}).filter(([k]) => !aiIds.has(k)));
    const { data: row, error: e } = await sb
      .from("notes")
      .insert({ title: `${s.title || "Untitled"} (1)`, content: s.content, page: s.page ?? {}, parent_id: s.parent_id ?? null, props })
      .select("id")
      .single();
    if (e || !row) {
      failed++;
      continue;
    }
    const newId = (row as { id: string }).id;
    made.push(newId);
    const names = (tags.get(s.id) ?? []).map((t) => t.name);
    if (names.length) await setTags(sb, "note", newId, names);
    const mine = relRows.filter((r) => r.source_id === s.id);
    if (mine.length) {
      await sb.from("entity_relations").insert(mine.map((r) => ({ source_type: "note", source_id: newId, target_type: r.target_type, target_id: r.target_id, relationship_type: r.relationship_type })));
    }
  }
  revalidatePath("/notes");
  if (!made.length) return { error: "Couldn't duplicate those notes." };
  return { ok: true, ids: made, failed };
}
