// Portfolio add-on — slots and note links (SERVER only). Works with the signed-in client and filters by user_id.
// Same idea as block notes: a note is linked to a slot + language through notes.portfolio_slot_id / portfolio_lang.
import type { SupabaseClient } from "@supabase/supabase-js";
import { LANGS, type Lang, type SlotKind } from "@/lib/portfolio/constants";
import { cleanLangs, isSingleton, keyFor, keyProblem, KIND_LABEL, nextPosition, renameKey, slugFor, slugProblem, slugTaken, sortSlots } from "@/lib/portfolio/slots";
import { computeStatus } from "@/lib/portfolio/status";
import type { LinkedNote, PublishedInfo, Slot, SlotLangs, SlotMeta, SlotView } from "@/lib/portfolio/types";
import { isMissingPortfolio } from "@/lib/portfolio/errors";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** "Former · About · es · Nov 7" (what a replaced note is renamed to). */
export function formerTitle(slotLabel: string, lang: Lang, ymd: string) {
  const [, m, d] = ymd.split("-").map(Number);
  return `Former · ${slotLabel} · ${lang} · ${MONTHS[(m || 1) - 1]} ${d || 1}`;
}

const todayYmd = () => new Date().toISOString().slice(0, 10);

/** Every slot of the user with, per language, its linked note, its public row and its status. */
export async function loadSlotViews(sb: SupabaseClient, userId: string, opts: { includeArchived?: boolean } = {}): Promise<{ slots: SlotView[]; missing: boolean }> {
  const { data: rows, error } = await sb.from("portfolio_slots").select("*").eq("user_id", userId);
  if (error) return { slots: [], missing: isMissingPortfolio(error) };
  const slots = ((rows ?? []) as Slot[]).filter((s) => opts.includeArchived || !s.archived);
  if (!slots.length) return { slots: [], missing: false };
  const ids = slots.map((s) => s.id);

  const [notesRes, pagesRes, versRes] = await Promise.all([
    sb.from("notes").select("id,title,page,updated_at,deleted_at,portfolio_slot_id,portfolio_lang").eq("user_id", userId).in("portfolio_slot_id", ids),
    sb.from("portfolio_pages").select("slot_id,lang,version,is_live,published_at,slug").eq("user_id", userId).in("slot_id", ids),
    sb.from("portfolio_page_versions").select("slot_id,lang,version,source_hash,action").eq("user_id", userId).in("slot_id", ids).in("action", ["publish", "rollback"]).order("version", { ascending: false }),
  ]);

  const notes = new Map<string, LinkedNote>();
  for (const n of (notesRes.data ?? []) as { id: string; title: string; page: { icon?: string | null } | null; updated_at: string; deleted_at: string | null; portfolio_slot_id: string; portfolio_lang: Lang }[]) {
    // a note in the trash still counts as the linked note (status "Source note in trash"), unless a live one replaced it
    const k = `${n.portfolio_slot_id}:${n.portfolio_lang}`;
    if (notes.has(k) && n.deleted_at) continue;
    notes.set(k, { id: n.id, title: (n.title ?? "").trim() || "Untitled", icon: n.page?.icon ?? null, updated_at: n.updated_at, deleted_at: n.deleted_at });
  }
  const hash = new Map<string, string | null>();
  for (const v of (versRes.data ?? []) as { slot_id: string; lang: Lang; source_hash: string | null }[]) {
    const k = `${v.slot_id}:${v.lang}`;
    if (!hash.has(k)) hash.set(k, v.source_hash);
  }
  const pubs = new Map<string, PublishedInfo>();
  for (const p of (pagesRes.data ?? []) as { slot_id: string; lang: Lang; version: number; is_live: boolean; published_at: string | null; slug: string }[]) {
    pubs.set(`${p.slot_id}:${p.lang}`, { version: p.version, is_live: p.is_live, published_at: p.published_at, slug: p.slug, source_hash: hash.get(`${p.slot_id}:${p.lang}`) ?? null });
  }

  const views: SlotView[] = slots.map((s) => {
    const pages = {} as SlotView["pages"];
    for (const lang of LANGS) {
      const note = notes.get(`${s.id}:${lang}`) ?? null;
      const published = pubs.get(`${s.id}:${lang}`) ?? null;
      pages[lang] = { note, published, status: computeStatus(note, published) };
    }
    return { ...s, pages };
  });
  return { slots: sortSlots(views), missing: false };
}

async function allSlots(sb: SupabaseClient, userId: string): Promise<Slot[]> {
  const { data } = await sb.from("portfolio_slots").select("*").eq("user_id", userId);
  return (data ?? []) as Slot[];
}

async function everPublished(sb: SupabaseClient, userId: string, slotId: string) {
  const { count } = await sb.from("portfolio_page_versions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("slot_id", slotId).eq("action", "publish");
  return (count ?? 0) > 0;
}

export async function createSlot(sb: SupabaseClient, userId: string, input: { kind: SlotKind; name?: string; meta?: SlotMeta }): Promise<Result<{ id: string }>> {
  const slots = await allSlots(sb, userId);
  const key = keyFor(input.kind, input.name ?? "");
  const problem = keyProblem(input.kind, key);
  if (problem) return fail(problem);
  if (slots.some((s) => !s.archived && s.kind === input.kind && s.key.toLowerCase() === key)) {
    return fail(isSingleton(input.kind) ? `${KIND_LABEL[input.kind]} already exists.` : `A ${KIND_LABEL[input.kind].toLowerCase()} called "${key}" already exists.`);
  }
  const { data, error } = await sb
    .from("portfolio_slots")
    .insert({ user_id: userId, kind: input.kind, key, position: nextPosition(slots, input.kind), meta: input.meta ?? {} })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create the slot.");
  return { ok: true, id: data.id as string };
}

export type SlotPatch = { key?: string; featured?: boolean; archived?: boolean; position?: number; meta?: SlotMeta; langs?: SlotLangs };

export async function updateSlot(sb: SupabaseClient, userId: string, id: string, patch: SlotPatch): Promise<Result> {
  const slots = await allSlots(sb, userId);
  const slot = slots.find((s) => s.id === id);
  if (!slot) return fail("This slot no longer exists.");
  const update: Record<string, unknown> = {};

  if (patch.key !== undefined && patch.key !== slot.key) {
    if (isSingleton(slot.kind)) return fail(`The key of ${KIND_LABEL[slot.kind]} cannot change.`);
    const key = keyFor(slot.kind, patch.key);
    const problem = keyProblem(slot.kind, key);
    if (problem) return fail(problem);
    if (slots.some((s) => s.id !== id && !s.archived && s.kind === slot.kind && s.key.toLowerCase() === key)) return fail(`A ${KIND_LABEL[slot.kind].toLowerCase()} called "${key}" already exists.`);
    Object.assign(update, renameKey(slot, key, await everPublished(sb, userId, id)));
  }
  if (patch.featured !== undefined) update.featured = !!patch.featured;
  if (patch.archived !== undefined) update.archived = !!patch.archived;
  if (patch.position !== undefined && Number.isFinite(patch.position)) update.position = patch.position;
  if (patch.meta !== undefined) update.meta = patch.meta;
  if (patch.langs !== undefined) {
    const langs = cleanLangs(patch.langs);
    for (const lang of LANGS) {
      const slug = langs[lang]?.slug;
      if (!slug) continue;
      const p = slugProblem(slug);
      if (p) return fail(`${lang.toUpperCase()}: ${p}`);
      const clash = slugTaken(slots, id, slot.kind, lang, slug);
      if (clash) return fail(`${lang.toUpperCase()}: the URL name "${slug}" is already used by "${clash.key}".`);
    }
    update.langs = langs;
  }
  // un-archiving must not collide with a live slot of the same key
  if (patch.archived === false && slot.archived && slots.some((s) => s.id !== id && !s.archived && s.kind === slot.kind && s.key.toLowerCase() === slot.key.toLowerCase())) {
    return fail(`Another ${KIND_LABEL[slot.kind].toLowerCase()} already uses "${slot.key}".`);
  }
  if (!Object.keys(update).length) return { ok: true };
  const { error } = await sb.from("portfolio_slots").update(update).eq("id", id).eq("user_id", userId);
  return error ? fail(error.message) : { ok: true };
}

/** Delete a slot only when it was never published (otherwise archive it). Linked notes stay as normal notes. */
export async function deleteSlot(sb: SupabaseClient, userId: string, id: string): Promise<Result> {
  if (await everPublished(sb, userId, id)) return fail("This slot was published before. Archive it instead (its history is kept).");
  const { error } = await sb.from("portfolio_slots").delete().eq("id", id).eq("user_id", userId);
  return error ? fail(error.message) : { ok: true };
}

// ---------- notes ----------

type NoteRow = { id: string; title: string; block_name: string | null; is_template: boolean; deleted_at: string | null; portfolio_slot_id: string | null; portfolio_lang: string | null };

async function linkedNoteOf(sb: SupabaseClient, userId: string, slotId: string, lang: Lang) {
  const { data } = await sb
    .from("notes")
    .select("id,title")
    .eq("user_id", userId)
    .eq("portfolio_slot_id", slotId)
    .eq("portfolio_lang", lang)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as { id: string; title: string } | null) ?? null;
}

/**
 * Link a note to a slot + language. When the slot already has a note in that language, `replace` must be true:
 * the old note becomes a normal note titled "Former · <slot> · <lang> · <date>".
 */
export async function linkNote(sb: SupabaseClient, userId: string, input: { slotId: string; lang: Lang; noteId: string; replace?: boolean }): Promise<Result<{ released?: string }>> {
  const slot = (await allSlots(sb, userId)).find((s) => s.id === input.slotId);
  if (!slot) return fail("This slot no longer exists.");
  const { data } = await sb.from("notes").select("id,title,block_name,is_template,deleted_at,portfolio_slot_id,portfolio_lang").eq("id", input.noteId).eq("user_id", userId).maybeSingle();
  const note = data as NoteRow | null;
  if (!note) return fail("That note does not exist.");
  if (note.deleted_at) return fail("That note is in the trash.");
  if (note.block_name) return fail("That is the note of a calendar block. Pick a normal note.");
  if (note.is_template) return fail("A template cannot be a portfolio page. Pick a normal note.");
  if (note.portfolio_slot_id === input.slotId && note.portfolio_lang === input.lang) return { ok: true };
  if (note.portfolio_slot_id) return fail("That note is already the page of another slot. Unlink it there first.");

  const current = await linkedNoteOf(sb, userId, input.slotId, input.lang);
  let released: string | undefined;
  if (current) {
    if (!input.replace) return fail("This slot already has a note in this language. Choose replace to keep the old one as a \"Former\" note.");
    const label = isSingleton(slot.kind) ? KIND_LABEL[slot.kind] : slot.key;
    const { error } = await sb
      .from("notes")
      .update({ portfolio_slot_id: null, portfolio_lang: null, title: formerTitle(label, input.lang, todayYmd()) })
      .eq("id", current.id)
      .eq("user_id", userId);
    if (error) return fail(error.message);
    released = current.id;
  }
  const { error } = await sb.from("notes").update({ portfolio_slot_id: input.slotId, portfolio_lang: input.lang }).eq("id", input.noteId).eq("user_id", userId);
  if (error) return fail(error.message);
  return { ok: true, released };
}

/** A new empty note linked to the slot (its title starts as the slot's name). Fails when the language already has a note. */
export async function createLinkedNote(sb: SupabaseClient, userId: string, input: { slotId: string; lang: Lang; title?: string; content?: string }): Promise<Result<{ noteId: string }>> {
  const slot = (await allSlots(sb, userId)).find((s) => s.id === input.slotId);
  if (!slot) return fail("This slot no longer exists.");
  if (await linkedNoteOf(sb, userId, input.slotId, input.lang)) return fail("This slot already has a note in this language.");
  const title = (input.title ?? "").trim() || (isSingleton(slot.kind) ? KIND_LABEL[slot.kind] : slot.key);
  const { data, error } = await sb
    .from("notes")
    .insert({ user_id: userId, title, content: input.content ?? "", portfolio_slot_id: input.slotId, portfolio_lang: input.lang })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create the note.");
  return { ok: true, noteId: data.id as string };
}

/** Unlink: the note stays as a normal note (the live page does not change until the next publish/unpublish). */
export async function unlinkNote(sb: SupabaseClient, userId: string, input: { slotId: string; lang: Lang }): Promise<Result> {
  const { error } = await sb
    .from("notes")
    .update({ portfolio_slot_id: null, portfolio_lang: null })
    .eq("user_id", userId)
    .eq("portfolio_slot_id", input.slotId)
    .eq("portfolio_lang", input.lang);
  return error ? fail(error.message) : { ok: true };
}

/** For a note: the slot + language it is the page of (null when it is a normal note). */
export async function portfolioLinkOfNote(sb: SupabaseClient, userId: string, noteId: string): Promise<{ slotId: string; lang: Lang; kind: SlotKind; key: string; slug: string } | null> {
  const { data: n } = await sb.from("notes").select("portfolio_slot_id,portfolio_lang").eq("id", noteId).eq("user_id", userId).maybeSingle();
  const row = n as { portfolio_slot_id: string | null; portfolio_lang: Lang | null } | null;
  if (!row?.portfolio_slot_id || !row.portfolio_lang) return null;
  const { data: s } = await sb.from("portfolio_slots").select("*").eq("id", row.portfolio_slot_id).eq("user_id", userId).maybeSingle();
  const slot = s as Slot | null;
  if (!slot) return null;
  return { slotId: slot.id, lang: row.portfolio_lang, kind: slot.kind, key: slot.key, slug: slugFor(slot, row.portfolio_lang) };
}
