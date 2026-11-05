"use server";
// YouTube add-on (Worker A) — Research Laboratory: buckets (per video) and topic shelves (video_id null),
// cards (note · fragment · quick · link · reference), annotations, moving/copying cards, "New note" from a
// bucket (Type = Research), quick card → note, video ↔ video links and ✨ refined note suggestions.
// Every write runs as the signed-in user (RLS "own rows"). Cards point to notes (never copies).
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, hasAi } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { ytServer, isMissingTable } from "@/lib/youtube/db";
import { AI_PROMPT_MAX, BASE, LINK_KINDS, MIGRATION_FILE, NOTE_TYPES, REFERENCES_BUCKET, videoHref } from "@/lib/youtube/constants";
import { bucketName, cleanUrl, defaultBuckets, ensureBlockId, keywords, siteOf, splitBlocks, suggestNotes, type NoteBlock } from "@/lib/youtube/research";
import { getProperties } from "@/lib/notes-db/server";
import { addOption } from "@/app/notes-db-actions";
import type { CardKind, LinkKind, YtBucket, YtCard } from "@/lib/youtube/types";

type Res = { ok?: boolean; error?: string };
const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const fail = (e: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again.") =>
  isMissingTable(e) ? MISSING : e?.message || fallback;
const UUID = /^[0-9a-f-]{36}$/i;
const txt = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

function refresh(videoId?: string | null) {
  revalidatePath(`${BASE}/lab`);
  if (videoId) revalidatePath(videoHref(videoId, "research"));
  revalidatePath(BASE);
}
async function ctx() {
  const { supabase, userId } = await ytServer();
  return { sb: supabase, userId };
}

async function bucketOf(sb: SupabaseClient, id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await sb.from("yt_buckets").select("id,video_id,name,position").eq("id", id).maybeSingle();
  return data as Pick<YtBucket, "id" | "video_id" | "name" | "position"> | null;
}
async function lastCardPos(sb: SupabaseClient, bucketId: string) {
  const { data } = await sb.from("yt_cards").select("position").eq("bucket_id", bucketId).order("position", { ascending: false }).limit(1);
  return ((data ?? [])[0] as { position: number } | undefined)?.position ?? 0;
}
async function insertCard(sb: SupabaseClient, bucketId: string, row: Partial<YtCard> & { kind: CardKind }): Promise<{ id?: string; error?: string; videoId?: string | null }> {
  const b = await bucketOf(sb, bucketId);
  if (!b) return { error: "That bucket doesn't exist anymore. Reload the page." };
  const position = (await lastCardPos(sb, b.id)) + 1;
  const { data, error } = await sb
    .from("yt_cards")
    .insert({ ...row, bucket_id: b.id, video_id: b.video_id, position })
    .select("id")
    .single();
  if (error || !data) return { error: fail(error, "Couldn't add the card.") };
  return { id: data.id as string, videoId: b.video_id };
}

// ----- Setup (called by the page, server side) --------------------------------------------------------
/**
 * Makes sure a video has its buckets (default template the first time) and that each saved outlier reference
 * of the video has a card in "References". Safe to call on every visit. Returns true when it added something.
 */
export async function ensureResearch(videoId: string): Promise<boolean> {
  const { sb, userId } = await ctx();
  if (!userId || !UUID.test(videoId)) return false;
  let changed = false;
  const { data: bs, error } = await sb.from("yt_buckets").select("id,name,position").eq("video_id", videoId).order("position");
  if (error) return false;
  let buckets = (bs ?? []) as Pick<YtBucket, "id" | "name" | "position">[];
  if (!buckets.length) {
    const { data, error: e2 } = await sb
      .from("yt_buckets")
      .insert(defaultBuckets().map((b) => ({ ...b, video_id: videoId })))
      .select("id,name,position");
    if (e2) return false;
    buckets = (data ?? []) as typeof buckets;
    changed = true;
  }
  const { data: refs } = await sb.from("yt_references").select("id").eq("video_id", videoId);
  const refIds = ((refs ?? []) as { id: string }[]).map((r) => r.id);
  if (!refIds.length) return changed;
  const { data: have } = await sb.from("yt_cards").select("reference_id").eq("video_id", videoId).not("reference_id", "is", null);
  const done = new Set(((have ?? []) as { reference_id: string }[]).map((c) => c.reference_id));
  const todo = refIds.filter((id) => !done.has(id));
  if (!todo.length) return changed;
  let refBucket = buckets.find((b) => b.name.toLowerCase() === REFERENCES_BUCKET.toLowerCase());
  if (!refBucket) {
    const pos = Math.max(0, ...buckets.map((b) => b.position)) + 1;
    const { data } = await sb.from("yt_buckets").insert({ video_id: videoId, name: REFERENCES_BUCKET, position: pos }).select("id,name,position").single();
    if (!data) return changed;
    refBucket = data as (typeof buckets)[number];
  }
  let pos = await lastCardPos(sb, refBucket.id);
  await sb.from("yt_cards").insert(todo.map((reference_id) => ({ bucket_id: refBucket!.id, video_id: videoId, kind: "reference", reference_id, position: ++pos })));
  return true;
}

// ----- Buckets & shelves ---------------------------------------------------------------------------
/** New bucket of a video, or a new topic shelf when videoId is null. */
export async function addBucket(videoId: string | null, name: string, description?: string): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const q = sb.from("yt_buckets").select("name,position");
  const { data, error } = await (videoId ? q.eq("video_id", videoId) : q.is("video_id", null));
  if (error) return { error: fail(error) };
  const list = (data ?? []) as { name: string; position: number }[];
  const clean = bucketName(name, list.map((b) => b.name));
  if (!clean) return { error: "Write a name." };
  const position = Math.max(0, ...list.map((b) => b.position)) + 1;
  const { data: row, error: e2 } = await sb
    .from("yt_buckets")
    .insert({ video_id: videoId, name: clean, description: txt(description, 300), position })
    .select("id")
    .single();
  if (e2 || !row) return { error: fail(e2, "Couldn't add it.") };
  refresh(videoId);
  return { ok: true, id: row.id as string };
}

export async function updateBucket(id: string, patch: { name?: string; description?: string }): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const b = await bucketOf(sb, id);
  if (!b) return { error: "Not found." };
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const q = sb.from("yt_buckets").select("name").neq("id", id);
    const { data } = await (b.video_id ? q.eq("video_id", b.video_id) : q.is("video_id", null));
    const clean = bucketName(patch.name, ((data ?? []) as { name: string }[]).map((x) => x.name));
    if (!clean) return { error: "Write a name." };
    row.name = clean;
  }
  if (patch.description !== undefined) row.description = txt(patch.description, 300);
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await sb.from("yt_buckets").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  refresh(b.video_id);
  return { ok: true };
}

/** Deletes a bucket and its cards (the notes themselves are never touched). */
export async function deleteBucket(id: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const b = await bucketOf(sb, id);
  if (!b) return { ok: true };
  const { error } = await sb.from("yt_buckets").delete().eq("id", id);
  if (error) return { error: fail(error) };
  refresh(b.video_id);
  return { ok: true };
}

/** New order of a video's buckets (or of the shelves). */
export async function reorderBuckets(ids: string[]): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const list = ids.filter((x) => UUID.test(x)).slice(0, 100);
  const res = await Promise.all(list.map((id, i) => sb.from("yt_buckets").update({ position: i + 1 }).eq("id", id)));
  const err = res.find((r) => r.error)?.error;
  if (err) return { error: fail(err) };
  const b = list[0] ? await bucketOf(sb, list[0]) : null;
  refresh(b?.video_id);
  return { ok: true };
}

/** Adds the default buckets that are missing (after you deleted some). */
export async function restoreDefaultBuckets(videoId: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data } = await sb.from("yt_buckets").select("name,position").eq("video_id", videoId);
  const have = (data ?? []) as { name: string; position: number }[];
  const names = new Set(have.map((b) => b.name.toLowerCase()));
  let pos = Math.max(0, ...have.map((b) => b.position));
  const rows = defaultBuckets()
    .filter((b) => !names.has(b.name.toLowerCase()))
    .map((b) => ({ video_id: videoId, name: b.name, position: ++pos }));
  if (!rows.length) return { ok: true };
  const { error } = await sb.from("yt_buckets").insert(rows);
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { ok: true };
}

// ----- Cards ---------------------------------------------------------------------------------------
/** Whole note → card (a reference to the note: editing the note shows everywhere). */
export async function addNoteCard(bucketId: string, noteId: string): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!UUID.test(noteId)) return { error: "Note not found." };
  const { data: dup } = await sb.from("yt_cards").select("id").eq("bucket_id", bucketId).eq("note_id", noteId).eq("kind", "note").limit(1);
  if ((dup ?? []).length) return { error: "That note is already in this bucket." };
  const r = await insertCard(sb, bucketId, { kind: "note", note_id: noteId });
  if (r.error) return { error: r.error };
  refresh(r.videoId);
  return { ok: true, id: r.id };
}

/** The paragraphs/headings of a note that can become a fragment card. */
export async function noteBlocks(noteId: string): Promise<{ blocks?: NoteBlock[]; title?: string; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!UUID.test(noteId)) return { error: "Note not found." };
  const { data, error } = await sb.from("notes").select("title,block_name,content").eq("id", noteId).is("deleted_at", null).maybeSingle();
  if (error || !data) return { error: error?.message ?? "Note not found." };
  return { blocks: splitBlocks(String(data.content ?? "")).slice(0, 400), title: String(data.block_name || data.title || "Untitled") };
}

/**
 * One block of a note → fragment card linked to that exact block. When the block has no anchor yet, one is
 * added at the end of its line ({id="…"}, the editor's own block id), so the link jumps right there.
 */
export async function addFragmentCard(bucketId: string, noteId: string, line: number, annotation?: string): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!UUID.test(noteId) || !Number.isInteger(line) || line < 0) return { error: "Pick a paragraph." };
  const { data: note, error } = await sb.from("notes").select("content").eq("id", noteId).is("deleted_at", null).maybeSingle();
  if (error || !note) return { error: error?.message ?? "Note not found." };
  const md = String(note.content ?? "");
  const block = splitBlocks(md).find((b) => b.line === line);
  if (!block) return { error: "That paragraph changed. Open the note again." };
  const fresh = `r${Math.random().toString(36).slice(2, 10)}`;
  const anchored = ensureBlockId(md, line, fresh);
  let blockId: string | null = block.blockId;
  if (anchored) {
    blockId = anchored.id;
    if (anchored.md !== md) {
      const { error: e2 } = await sb.from("notes").update({ content: anchored.md }).eq("id", noteId);
      if (e2) blockId = null; // still save the quote, just without the jump
      else revalidatePath(`/notes/${noteId}`);
    }
  }
  const r = await insertCard(sb, bucketId, { kind: "fragment", note_id: noteId, block_id: blockId, quote_text: block.text.slice(0, 2000), annotation: txt(annotation, 300) });
  if (r.error) return { error: r.error };
  refresh(r.videoId);
  return { ok: true, id: r.id };
}

/** A thought written straight on the board. */
export async function addQuickCard(bucketId: string, text: string): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const t = txt(text, 4000);
  if (!t) return { error: "Write something first." };
  const r = await insertCard(sb, bucketId, { kind: "quick", text: t });
  if (r.error) return { error: r.error };
  refresh(r.videoId);
  return { ok: true, id: r.id };
}

/** Web link card. The browser gets the preview from /api/link-preview and sends it here. */
export async function addLinkCard(bucketId: string, rawUrl: string, preview?: { title?: string | null; description?: string | null; image?: string | null }): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const url = cleanUrl(rawUrl);
  if (!url) return { error: "That doesn't look like a link." };
  const img = preview?.image && /^https:\/\//i.test(preview.image) ? preview.image.slice(0, 1000) : undefined;
  const r = await insertCard(sb, bucketId, {
    kind: "link",
    url,
    preview: { title: txt(preview?.title, 300) ?? undefined, description: txt(preview?.description, 500) ?? undefined, image: img, site: siteOf(url) },
  });
  if (r.error) return { error: r.error };
  refresh(r.videoId);
  return { ok: true, id: r.id };
}

/** Annotation ("for the intro", "contradicts point 2") and the text of a quick card. */
export async function updateCard(id: string, patch: { annotation?: string; text?: string }): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if (patch.annotation !== undefined) row.annotation = txt(patch.annotation, 300);
  if (patch.text !== undefined) {
    const t = txt(patch.text, 4000);
    if (!t) return { error: "A quick card can't be empty." };
    row.text = t;
  }
  const { data, error } = await sb.from("yt_cards").update(row).eq("id", id).select("video_id").maybeSingle();
  if (error) return { error: fail(error) };
  refresh((data as { video_id: string | null } | null)?.video_id);
  return { ok: true };
}

/** Moves a card to another bucket of the SAME place (video or shelves), at `position` (end when missing). */
export async function moveCard(id: string, bucketId: string, position?: number): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const [{ data: card }, b] = await Promise.all([sb.from("yt_cards").select("id,video_id").eq("id", id).maybeSingle(), bucketOf(sb, bucketId)]);
  if (!card || !b) return { error: "Not found. Reload the page." };
  const pos = typeof position === "number" && Number.isFinite(position) ? position : (await lastCardPos(sb, b.id)) + 1;
  const { error } = await sb.from("yt_cards").update({ bucket_id: b.id, video_id: b.video_id, position: pos }).eq("id", id);
  if (error) return { error: fail(error) };
  refresh((card as { video_id: string | null }).video_id);
  if (b.video_id !== (card as { video_id: string | null }).video_id) refresh(b.video_id);
  return { ok: true };
}

/** Copies a card into another bucket (a shelf card taken into a video, or the other way). */
export async function copyCard(id: string, bucketId: string): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: card, error } = await sb.from("yt_cards").select("*").eq("id", id).maybeSingle();
  if (error || !card) return { error: fail(error, "Card not found.") };
  const c = card as YtCard;
  if (c.kind === "reference") return { error: "Reference cards belong to their video. Copy the link instead." };
  const r = await insertCard(sb, bucketId, {
    kind: c.kind,
    note_id: c.note_id,
    block_id: c.block_id,
    quote_text: c.quote_text,
    url: c.url,
    preview: c.preview,
    text: c.text,
    annotation: c.annotation,
  });
  if (r.error) return { error: r.error };
  refresh(r.videoId);
  return { ok: true, id: r.id };
}

/**
 * Removes a card (never the note). A reference card also removes that saved reference from the video
 * (otherwise it would come back on the next visit).
 */
export async function deleteCard(id: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data } = await sb.from("yt_cards").select("video_id,kind,reference_id").eq("id", id).maybeSingle();
  const c = data as { video_id: string | null; kind: CardKind; reference_id: string | null } | null;
  const { error } = await sb.from("yt_cards").delete().eq("id", id);
  if (error) return { error: fail(error) };
  if (c?.kind === "reference" && c.reference_id) await sb.from("yt_references").delete().eq("id", c.reference_id);
  refresh(c?.video_id);
  if (c?.video_id && c.kind === "reference") revalidatePath(videoHref(c.video_id), "layout");
  return { ok: true };
}

// ----- Back to Notes -------------------------------------------------------------------------------
/** Type = "Research" option id (created the first time) and the "Source" url property id. */
async function researchProps(sb: SupabaseClient, userId: string) {
  const props = await getProperties(sb, userId).catch(() => []);
  const type = props.find((p) => p.builtin && p.key === "type");
  const source = props.find((p) => p.builtin && p.key === "source");
  let typeOption: string | null = null;
  if (type) {
    const found = (type.config.options ?? []).find((o) => o.name.toLowerCase() === NOTE_TYPES.research.toLowerCase());
    if (found) typeOption = found.id;
    else {
      const r = await addOption(type.id, NOTE_TYPES.research, "red");
      if (r.ok) typeOption = r.option.id;
    }
  }
  return { typeId: type?.id ?? null, typeOption, sourceId: source?.id ?? null };
}

async function createResearchNote(sb: SupabaseClient, userId: string, videoId: string | null, title: string, content: string) {
  const p = await researchProps(sb, userId);
  const props: Record<string, unknown> = {};
  if (p.typeId && p.typeOption) props[p.typeId] = p.typeOption;
  if (p.sourceId && videoId) {
    const site = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").replace(/\/$/, "");
    if (site) props[p.sourceId] = `${site}${videoHref(videoId, "research")}`;
  }
  const row: Record<string, unknown> = { title: title.slice(0, 500) || "Untitled", content, props };
  let res = await sb.from("notes").insert(row).select("id").single();
  if (res.error && /props/.test(res.error.message)) {
    delete row.props; // notes database migration not run: still create the note
    res = await sb.from("notes").insert(row).select("id").single();
  }
  if (res.error || !res.data) return { error: res.error?.message ?? "Couldn't create the note." };
  revalidatePath("/notes");
  return { id: res.data.id as string };
}

/** "New note" inside a bucket: a real note in Notes (Type = Research, linked to the video) + its card. */
export async function newNoteInBucket(bucketId: string, title: string): Promise<Res & { noteId?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const b = await bucketOf(sb, bucketId);
  if (!b) return { error: "That bucket doesn't exist anymore." };
  let intro = "";
  if (b.video_id) {
    const { data: v } = await sb.from("yt_videos").select("code,idea_name").eq("id", b.video_id).maybeSingle();
    if (v) intro = `Research for [${v.code ? `${v.code} · ` : ""}${v.idea_name}](${videoHref(b.video_id, "research")}) — ${b.name}\n\n`;
  } else intro = `Topic shelf: [${b.name}](${BASE}/lab)\n\n`;
  const t = txt(title, 300) ?? `${b.name} — research`;
  const n = await createResearchNote(sb, userId, b.video_id, t, intro);
  if (n.error || !n.id) return { error: n.error };
  const r = await insertCard(sb, b.id, { kind: "note", note_id: n.id });
  if (r.error) return { error: r.error };
  refresh(b.video_id);
  return { ok: true, noteId: n.id };
}

/** Quick card → "Turn into note": the card becomes a note card pointing to a new real note. */
export async function quickCardToNote(cardId: string): Promise<Res & { noteId?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data } = await sb.from("yt_cards").select("id,kind,text,annotation,bucket_id,video_id").eq("id", cardId).maybeSingle();
  const c = data as Pick<YtCard, "id" | "kind" | "text" | "annotation" | "bucket_id" | "video_id"> | null;
  if (!c || c.kind !== "quick") return { error: "Only quick cards can turn into notes." };
  const text = String(c.text ?? "").trim();
  const first = text.split("\n")[0].replace(/[#>*_`]/g, "").trim();
  const title = first.length > 80 ? `${first.slice(0, 77)}…` : first || "Research note";
  let body = text;
  if (c.video_id) {
    const { data: v } = await sb.from("yt_videos").select("code,idea_name").eq("id", c.video_id).maybeSingle();
    if (v) body = `${text}\n\n— From the research of [${v.code ? `${v.code} · ` : ""}${v.idea_name}](${videoHref(c.video_id, "research")})`;
  }
  const n = await createResearchNote(sb, userId, c.video_id, title, `${body}\n`);
  if (n.error || !n.id) return { error: n.error };
  const { error } = await sb.from("yt_cards").update({ kind: "note", note_id: n.id, text: null }).eq("id", cardId);
  if (error) return { error: fail(error) };
  refresh(c.video_id);
  return { ok: true, noteId: n.id };
}

// ----- Video ↔ video links -------------------------------------------------------------------------
export async function addVideoLink(fromId: string, toId: string, kind: LinkKind, note?: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!UUID.test(fromId) || !UUID.test(toId)) return { error: "Pick a video." };
  if (fromId === toId) return { error: "A video can't link to itself." };
  if (!LINK_KINDS.some((k) => k.id === kind)) return { error: "Pick a kind of link." };
  const { data: last } = await sb.from("yt_video_links").select("position").eq("from_id", fromId).order("position", { ascending: false }).limit(1);
  const position = (((last ?? [])[0] as { position: number } | undefined)?.position ?? 0) + 1;
  const { error } = await sb.from("yt_video_links").insert({ from_id: fromId, to_id: toId, kind, note: txt(note, 300), position });
  if (error) return { error: error.code === "23505" ? "That link already exists." : fail(error) };
  refresh(fromId);
  refresh(toId);
  return { ok: true };
}

export async function deleteVideoLink(id: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data } = await sb.from("yt_video_links").select("from_id,to_id").eq("id", id).maybeSingle();
  const { error } = await sb.from("yt_video_links").delete().eq("id", id);
  if (error) return { error: fail(error) };
  const l = data as { from_id: string; to_id: string } | null;
  refresh(l?.from_id);
  refresh(l?.to_id);
  return { ok: true };
}

// ----- ✨ Suggested notes ---------------------------------------------------------------------------
export type RefinedSuggestion = { id: string; why: string };

/**
 * ✨ Refine "Suggested for this video": the AI reads the video (idea, topic, angle, gap) and up to 40
 * candidate notes (keyword matches first, then the newest) and picks the useful ones with a reason.
 */
export async function aiRefineSuggestions(videoId: string): Promise<{ items?: RefinedSuggestion[]; error?: string; usage?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const { data: v } = await sb.from("yt_videos").select("idea_name,topic,base_idea,angle_notes,gap_known,gap_want,tags").eq("id", videoId).maybeSingle();
  if (!v) return { error: "Video not found." };
  const { data: rows, error } = await sb
    .from("notes")
    .select("id,title,block_name,content,updated_at,is_template")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(600);
  if (error) return { error: error.message };
  const notes = ((rows ?? []) as { id: string; title: string | null; block_name: string | null; content: string | null; is_template?: boolean }[])
    .filter((n) => !n.is_template)
    .map((n) => ({ id: n.id, title: n.block_name || n.title || "Untitled", text: String(n.content ?? "").replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").slice(0, 1500) }));
  const terms = keywords([v.idea_name, v.topic, v.base_idea, v.angle_notes, ((v.tags as string[] | null) ?? []).join(" ")].filter(Boolean).join(" "), 20);
  const matched = suggestNotes(notes, terms, { limit: 30 });
  const ids = new Set(matched.map((n) => n.id));
  const pool = [...matched, ...notes.filter((n) => !ids.has(n.id)).slice(0, 40 - matched.length)];
  if (!pool.length) return { error: "You have no notes yet." };
  const video = [
    `Video idea: ${v.idea_name}`,
    v.topic ? `Topic: ${String(v.topic).slice(0, 800)}` : "",
    v.base_idea ? `Base idea: ${String(v.base_idea).slice(0, 400)}` : "",
    v.angle_notes ? `Angle: ${String(v.angle_notes).slice(0, 400)}` : "",
    v.gap_want ? `Viewer wants to know: ${v.gap_want}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const per = Math.max(120, Math.floor((AI_PROMPT_MAX - 2500 - video.length) / pool.length) - 40);
  const list = pool.map((n, i) => `[${i + 1}] ${n.title} — ${n.text.slice(0, per)}`).join("\n");
  const prompt = `${video}\n\nNotes:\n${list}`.slice(0, AI_PROMPT_MAX - 1500);
  const system = `You help a YouTuber research a video. From the numbered notes, pick the ones that would really help make THIS video (facts, stories, examples, counterpoints, hooks). Skip notes that only share a word. Reply with JSON: {"items":[{"n":<note number>,"why":"<how it helps, ≤ 12 words>"}]} — best first, at most 10, an empty list if none fit. Write "why" in English.`;
  let usage: string | null = null;
  const out = await withAiUsage(
    "youtube-research",
    async () => {
      const o = await aiChat(system, [{ text: prompt }], { kind: "fast", json: true, temperature: 0.2, maxTokens: 900, timeoutMs: 40000 });
      const { timezone } = await getSettings(sb);
      usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb, userId },
  );
  if (!("text" in out)) return { error: out.error, usage };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1)) as Record<string, unknown>;
  } catch {
    return { error: "The AI answered in a strange way. Try again.", usage };
  }
  const seen = new Set<string>();
  const items = (Array.isArray(json.items) ? json.items : [])
    .map((x: unknown) => x as Record<string, unknown>)
    .map((x) => ({ note: pool[Number(x.n) - 1], why: String(x.why ?? "").trim().slice(0, 160) }))
    .filter((x) => x.note && !seen.has(x.note.id) && seen.add(x.note.id))
    .map((x) => ({ id: x.note.id, why: x.why }));
  if (!items.length) return { error: "The AI didn't find notes that fit this video.", usage };
  return { items, usage };
}
