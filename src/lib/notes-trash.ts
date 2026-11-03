// The notes trash: what is in it, restoring (with the sub-pages that went with a page), deleting for good,
// emptying it and the automatic clean-up after TRASH_DAYS. "Trash" = notes.deleted_at set (soft delete).
// Pure helpers (groupTrash, batchOf, daysLeft) are tested in scripts/test-trash.ts; the rest take a Supabase
// client (the signed-in one, or the admin one from the cron) plus the user id.
// A page and its sub-pages are trashed at the SAME instant (deleted_at), which is how they are told apart from
// notes trashed on their own: they come back and go together. Merged-away notes (merged_into) are not trash.
import type { SupabaseClient } from "@supabase/supabase-js";

export const TRASH_DAYS = 30;
const DAY = 86_400_000;
const COLS = "id,title,content,page,parent_id,deleted_at";

export type TrashRow = { id: string; title: string; content: string; page: { icon?: string | null } | null; parent_id: string | null; deleted_at: string };
export type TrashItem = { id: string; title: string; icon: string | null; preview: string; deletedAt: string; subPages: number; daysLeft: number };

/** Days before it is deleted for good (0 = tonight's clean-up takes it). */
export function daysLeft(deletedAt: string, now = Date.now(), days = TRASH_DAYS) {
  return Math.max(0, Math.ceil((Date.parse(deletedAt) + days * DAY - now) / DAY));
}

/** A line of plain text from a note's Markdown. */
export function previewOf(md: string, max = 140) {
  const t = (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** The row plus the sub-pages trashed with it (same instant), at any depth. */
export function batchOf(rows: TrashRow[], id: string): TrashRow[] {
  const root = rows.find((r) => r.id === id);
  if (!root) return [];
  const out = [root];
  const seen = new Set([root.id]);
  for (let i = 0; i < out.length; i++) {
    for (const r of rows) if (r.parent_id === out[i].id && r.deleted_at === root.deleted_at && !seen.has(r.id)) (seen.add(r.id), out.push(r));
  }
  return out;
}

/** What the screen lists: one line per page or note trashed on its own, newest first. Sub-pages trashed with their page are counted, not listed. */
export function groupTrash(rows: TrashRow[], now = Date.now()): TrashItem[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tops = rows.filter((r) => {
    const p = r.parent_id ? byId.get(r.parent_id) : undefined;
    return !p || p.deleted_at !== r.deleted_at;
  });
  return tops
    .map((r) => ({
      id: r.id,
      title: (r.title ?? "").trim() || "Untitled",
      icon: r.page?.icon ?? null,
      preview: previewOf(r.content),
      deletedAt: r.deleted_at,
      subPages: batchOf(rows, r.id).length - 1,
      daysLeft: daysLeft(r.deleted_at, now),
    }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.title.localeCompare(b.title));
}

async function trashedRows(sb: SupabaseClient, userId: string): Promise<TrashRow[]> {
  const out: TrashRow[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await sb
      .from("notes")
      .select(COLS)
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .is("merged_into", null)
      .is("block_name", null)
      .eq("is_template", false)
      .order("deleted_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as TrashRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export async function listTrash(sb: SupabaseClient, userId: string, now = Date.now()): Promise<TrashItem[]> {
  return groupTrash(await trashedRows(sb, userId), now);
}

/** Brings the notes back with the sub-pages, tags and links that went with them. Returns how many notes came back. */
export async function restoreFromTrash(sb: SupabaseClient, userId: string, ids: string[]): Promise<number> {
  const rows = await trashedRows(sb, userId);
  const picked = new Map<string, TrashRow>();
  for (const id of ids) for (const r of batchOf(rows, id)) picked.set(r.id, r);
  if (!picked.size) return 0;

  // One restore per instant, so only what went away at that moment comes back
  const byAt = new Map<string, string[]>();
  for (const r of picked.values()) byAt.set(r.deleted_at, [...(byAt.get(r.deleted_at) ?? []), r.id]);
  for (const [at, list] of byAt) {
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { error } = await sb.from("notes").update({ deleted_at: null }).in("id", chunk).eq("user_id", userId).eq("deleted_at", at);
      if (error) throw new Error(error.message);
      await sb.from("entity_relations").update({ deleted_at: null }).eq("source_type", "note").in("source_id", chunk).eq("deleted_at", at);
      await sb.from("entity_tags").update({ deleted_at: null }).eq("entity_type", "note").in("entity_id", chunk).eq("deleted_at", at);
    }
  }

  // A sub-page restored while its page is still in the trash would be invisible: it goes to the top level
  const stillTrashed = new Set(rows.filter((r) => !picked.has(r.id)).map((r) => r.id));
  const orphans = [...picked.values()].filter((r) => r.parent_id && stillTrashed.has(r.parent_id)).map((r) => r.id);
  if (orphans.length) await sb.from("notes").update({ parent_id: null }).in("id", orphans).eq("user_id", userId);
  return picked.size;
}

/** Hard delete of these exact notes (and every link / tag row that pointed at them). */
async function destroy(sb: SupabaseClient, userId: string, ids: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await sb.from("entity_relations").delete().eq("source_type", "note").in("source_id", chunk);
    await sb.from("entity_relations").delete().eq("target_type", "note").in("target_id", chunk);
    await sb.from("entity_tags").delete().eq("entity_type", "note").in("entity_id", chunk);
    const { data, error } = await sb.from("notes").delete().in("id", chunk).eq("user_id", userId).not("deleted_at", "is", null).select("id");
    if (error) throw new Error(error.message);
    n += (data ?? []).length;
  }
  return n;
}

/** Deletes these trashed notes for good, with the sub-pages that went with them. Live notes are never touched. */
export async function deleteForever(sb: SupabaseClient, userId: string, ids: string[]): Promise<number> {
  const rows = await trashedRows(sb, userId);
  const all = new Set<string>();
  for (const id of ids) for (const r of batchOf(rows, id)) all.add(r.id);
  return all.size ? destroy(sb, userId, [...all]) : 0;
}

export async function emptyTrash(sb: SupabaseClient, userId: string): Promise<number> {
  const rows = await trashedRows(sb, userId);
  return rows.length ? destroy(sb, userId, rows.map((r) => r.id)) : 0;
}

/** The nightly clean-up: whatever has been in the trash longer than TRASH_DAYS goes for good. */
export async function purgeExpired(sb: SupabaseClient, userId: string, now = Date.now(), days = TRASH_DAYS): Promise<number> {
  const cutoff = new Date(now - days * DAY).toISOString();
  let total = 0;
  for (let round = 0; round < 10; round++) {
    const { data, error } = await sb
      .from("notes")
      .select("id")
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .is("merged_into", null)
      .limit(300);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (!ids.length) break;
    total += await destroy(sb, userId, ids);
    if (ids.length < 300) break;
  }
  return total;
}
