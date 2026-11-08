// Portfolio publishing — the engine: stage (preview), publish, update, unpublish, roll back, history.
// Everything a visitor can ever see passes through here. Talks to the database with the signed-in user's client
// (RLS "own rows") and to storage through a MediaStore (the service key lives only in storage.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "@/lib/portfolio/constants";
import { isSingleton, pathFor, slugFor } from "@/lib/portfolio/slots";
import type { Slot } from "@/lib/portfolio/types";
import { loadSite } from "@/lib/portfolio/site";
import { renderNote, type MediaRef, type TocItem } from "./render";
import { htmlToText } from "./sanitize";
import { Warnings, hasErrors, needsConfirm, type Warning } from "./warnings";
import { checkPage } from "./check";
import { copyMedia, removeUnused, type MediaStore } from "./media";
import { publicToc, readingMinutes, searchText } from "./search";
import { sourceHash } from "./hash";

export type Deps = { db: SupabaseClient; store: MediaStore; userId: string; osHosts?: string[]; now?: () => Date };

/** Everything the public row will hold (also what a version stores). */
export type Snapshot = {
  slot_key: string;
  kind: string;
  lang: Lang;
  slug: string;
  path: string;
  title: string;
  summary: string | null;
  icon: string | null;
  cover_url: string | null;
  body_html: string;
  toc: TocItem[];
  meta: Record<string, unknown>;
  search_text: string;
  reading_minutes: number;
  featured: boolean;
  position: number;
  source_note_id: string;
  source_hash: string;
  /** media files this page uses, as paths inside the public bucket */
  media: string[];
};

export type Built = { snapshot: Snapshot | null; warnings: Warning[]; blocked: boolean; needsConfirm: boolean };
export type Failure = { ok: false; error: string; warnings?: Warning[]; needsConfirm?: boolean; changed?: boolean };
/** Where a publish changed the site: the caller tells the site to refresh these. */
export type Affected = { lang: Lang; paths: string[] };

const nowIso = (d: Deps) => (d.now ? d.now() : new Date()).toISOString();
const MAX_VERSIONS = 30;

// ——— loading ———
type NoteRow = { id: string; title: string | null; content: string | null; page: { icon?: string | null; cover?: string | null } | null; updated_at: string; deleted_at: string | null };
type SlotRow = Slot & { user_id: string };

async function loadSlot(d: Deps, slotId: string): Promise<SlotRow | null> {
  const { data } = await d.db.from("portfolio_slots").select("*").eq("user_id", d.userId).eq("id", slotId).maybeSingle();
  return (data as SlotRow | null) ?? null;
}
async function loadNote(d: Deps, slotId: string, lang: Lang): Promise<NoteRow | null> {
  const { data } = await d.db.from("notes").select("id,title,content,page,updated_at,deleted_at").eq("user_id", d.userId).eq("portfolio_slot_id", slotId).eq("portfolio_lang", lang).limit(1);
  return ((data ?? [])[0] as NoteRow | undefined) ?? null;
}

/** noteId → public path, for the notes that are live in this language (links between published pages). */
async function liveLinks(d: Deps, lang: Lang): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: pages } = await d.db.from("portfolio_pages").select("slot_id,slot_key,kind,slug").eq("user_id", d.userId).eq("lang", lang).eq("is_live", true);
  const rows = (pages ?? []) as { slot_id: string; slot_key: string; kind: Slot["kind"]; slug: string }[];
  if (!rows.length) return map;
  const { data: notes } = await d.db.from("notes").select("id,portfolio_slot_id").eq("user_id", d.userId).eq("portfolio_lang", lang).in("portfolio_slot_id", rows.map((r) => r.slot_id)).is("deleted_at", null);
  for (const n of (notes ?? []) as { id: string; portfolio_slot_id: string }[]) {
    const p = rows.find((r) => r.slot_id === n.portfolio_slot_id);
    if (p) map.set(n.id.toLowerCase(), pathFor({ kind: p.kind, key: p.slot_key, langs: { [lang]: { slug: p.slug } } }, lang));
  }
  return map;
}

function mergeWarnings(w: Warnings, list: Warning[], skip: string[] = []) {
  for (const x of list) {
    if (skip.includes(x.code)) continue;
    const det = x.detail?.length ? x.detail : [undefined];
    det.forEach((dt, i) => w.add(x.code, dt, i === 0 ? x.count - (det.length - 1) : 1));
  }
}

const ASSET_IMG = /^\/api\/files\//;
/** A cover/icon value → what to do with it. */
function assetOf(v: string | null | undefined, kind: "cover" | "icon"): { ref?: MediaRef; base?: string; frag: string; keep?: string } {
  if (!v) return { frag: "" };
  if (kind === "cover" && /^(gradient|color):/.test(v)) return { keep: v, frag: "" };
  const [base, ...rest] = v.split("#");
  const frag = rest.length ? `#${rest.join("#")}` : "";
  if (ASSET_IMG.test(base)) return { ref: { src: base, kind: "image" }, base, frag };
  if (kind === "cover" && /^https:\/\//i.test(base)) return { keep: v, frag };
  if (kind === "icon" && base.length <= 16 && !/[<>"&/]/.test(base)) return { keep: base, frag: "" };
  return { frag: "" };
}

// ——— build ———
export async function buildSnapshot(d: Deps, slotId: string, lang: Lang): Promise<Built> {
  const w = new Warnings();
  const slot = await loadSlot(d, slotId);
  if (!slot) {
    w.add("no_note");
    return { snapshot: null, warnings: w.list(), blocked: true, needsConfirm: false };
  }
  const note = await loadNote(d, slotId, lang);
  if (!note) w.add("no_note");
  else if (note.deleted_at) w.add("note_trashed");
  if (!note || note.deleted_at) return { snapshot: null, warnings: w.list(), blocked: true, needsConfirm: false };

  const [{ data: allSlots }, siteRes, links] = await Promise.all([
    d.db.from("portfolio_slots").select("id,kind,key,langs,archived").eq("user_id", d.userId),
    loadSite(d.db, d.userId),
    liveLinks(d, lang),
  ]);
  const content = note.content ?? "";
  const ctx = { lang, osHosts: d.osHosts, noteLink: (id: string) => links.get(id.toLowerCase()) ?? null };

  const first = renderNote(content, ctx);
  const cover = assetOf(note.page?.cover, "cover");
  const icon = assetOf(note.page?.icon, "icon");
  const refs = [...first.media, ...(cover.ref ? [cover.ref] : []), ...(icon.ref ? [icon.ref] : [])];
  const copy = await copyMedia(d.store, d.userId, slotId, refs);
  const FAIL = { missing: "media_failed", failed: "media_failed", too_big: "media_too_big", type: "media_type", unsafe: "media_unsafe" } as const;
  for (const f of copy.failed) w.add(FAIL[f.reason], decodeURIComponent(f.src.split("/").pop() ?? f.src));
  for (const u of copy.unstripped) w.add(u.why === "archive" ? "archive_unchecked" : "metadata_kept", u.name);
  if (copy.copied) w.add("media_copied", undefined, copy.copied);

  const out = renderNote(content, { ...ctx, media: (s) => copy.urls.get(s) ?? null });
  mergeWarnings(w, out.warnings, ["media_failed"]);

  const text = htmlToText(out.html);
  const title = (note.title ?? "").trim();
  checkPage({ title, text, hasMedia: /<(img|iframe)\b/.test(out.html), slot, lang, slots: (allSlots ?? []) as Slot[], blockedWords: siteRes.site.blocked_words ?? [] }, w);

  const asUrl = (a: ReturnType<typeof assetOf>) => (a.keep ?? (a.base && copy.urls.get(a.base) ? copy.urls.get(a.base)! + a.frag : null));
  const langMeta = slot.langs?.[lang] ?? {};
  const slug = isSingleton(slot.kind) ? slot.kind : slugFor(slot, lang);
  const warnings = w.list();
  const snapshot: Snapshot = {
    slot_key: slot.key,
    kind: slot.kind,
    lang,
    slug,
    path: pathFor(slot, lang),
    title,
    summary: langMeta.summary?.trim() || null,
    icon: asUrl(icon),
    cover_url: asUrl(cover),
    body_html: out.html,
    toc: publicToc(out.toc),
    meta: { ...slot.meta, role: langMeta.role ?? null, seo_title: langMeta.seo_title ?? null, seo_desc: langMeta.seo_desc ?? null, show_toc: out.hasToc },
    search_text: searchText(title, text),
    reading_minutes: readingMinutes(text),
    featured: slot.featured,
    position: slot.position,
    source_note_id: note.id,
    source_hash: sourceHash(note, slot, lang),
    media: [...new Set(copy.paths.values())].sort(),
  };
  return { snapshot, warnings, blocked: hasErrors(warnings), needsConfirm: needsConfirm(warnings) };
}

// ——— versions ———
async function nextVersion(d: Deps, slotId: string, lang: Lang): Promise<number> {
  const { data } = await d.db.from("portfolio_page_versions").select("version").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).order("version", { ascending: false }).limit(1);
  return (((data ?? [])[0] as { version: number } | undefined)?.version ?? 0) + 1;
}
async function dropStages(d: Deps, slotId: string, lang: Lang) {
  await d.db.from("portfolio_page_versions").delete().eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).eq("action", "stage");
}
async function addVersion(d: Deps, slotId: string, lang: Lang, version: number, action: "stage" | "publish" | "unpublish" | "rollback", snap: Snapshot, warnings: Warning[]) {
  return d.db.from("portfolio_page_versions").insert({
    user_id: d.userId,
    slot_id: slotId,
    lang,
    version,
    action,
    source_note_id: snap.source_note_id,
    source_hash: snap.source_hash,
    snapshot: snap,
    warnings,
  });
}
async function prune(d: Deps, slotId: string, lang: Lang) {
  const { data } = await d.db.from("portfolio_page_versions").select("id,version").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).order("version", { ascending: false });
  const old = ((data ?? []) as { id: string }[]).slice(MAX_VERSIONS).map((r) => r.id);
  if (old.length) await d.db.from("portfolio_page_versions").delete().in("id", old);
}

/** Preview: builds the page, stores it as the (single) "stage" version and returns it with its warnings. Nothing goes public. */
export async function stage(d: Deps, slotId: string, lang: Lang): Promise<Built & { version: number | null }> {
  const b = await buildSnapshot(d, slotId, lang);
  if (!b.snapshot) return { ...b, version: null };
  await dropStages(d, slotId, lang);
  const version = await nextVersion(d, slotId, lang);
  await addVersion(d, slotId, lang, version, "stage", b.snapshot, b.warnings);
  return { ...b, version };
}

// ——— the public row ———
type PageRow = { id: string; slug: string; version: number; is_live: boolean; meta: Record<string, unknown> | null; kind: string; lang: Lang; published_at: string | null };

function rowOf(d: Deps, slotId: string, s: Snapshot, version: number, existing: PageRow | null) {
  const prev = new Set<string>(Array.isArray(existing?.meta?.previous_slugs) ? (existing!.meta!.previous_slugs as string[]) : []);
  if (existing && existing.slug !== s.slug) prev.add(existing.slug);
  prev.delete(s.slug);
  return {
    user_id: d.userId,
    slot_id: slotId,
    slot_key: s.slot_key,
    kind: s.kind,
    lang: s.lang,
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    icon: s.icon,
    cover_url: s.cover_url,
    body_html: s.body_html,
    toc: s.toc,
    meta: { ...s.meta, previous_slugs: [...prev] },
    search_text: s.search_text,
    reading_minutes: s.reading_minutes,
    featured: s.featured,
    position: s.position,
    version,
    is_live: true,
    // the first publish date stays (articles are listed by it); an update only bumps updated_at
    published_at: existing?.published_at ?? nowIso(d),
  };
}
async function existingPage(d: Deps, slotId: string, lang: Lang): Promise<PageRow | null> {
  const { data } = await d.db.from("portfolio_pages").select("id,slug,version,is_live,meta,kind,lang,published_at").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).maybeSingle();
  return (data as PageRow | null) ?? null;
}
async function writePage(d: Deps, slotId: string, existing: PageRow | null, row: ReturnType<typeof rowOf>) {
  return existing ? d.db.from("portfolio_pages").update(row).eq("id", existing.id) : d.db.from("portfolio_pages").insert(row);
}

export function affected(s: Pick<Snapshot, "kind" | "lang" | "path">, previousPaths: string[] = []): Affected {
  const list = s.kind === "project" ? ["/projects"] : s.kind === "article" ? ["/writing", "/rss.xml"] : [];
  return { lang: s.lang, paths: [...new Set([s.path, "/", ...list, "/sitemap.xml", "/search-index.json", ...previousPaths])] };
}

/** Deletes the files of the slot that no live page and no recent version still uses. */
export async function cleanupMedia(d: Deps, slotId: string): Promise<number> {
  const { data: pages } = await d.db.from("portfolio_pages").select("lang,body_html,cover_url,icon,is_live").eq("user_id", d.userId).eq("slot_id", slotId);
  const live = ((pages ?? []) as { lang: Lang; body_html: string; cover_url: string | null; icon: string | null; is_live: boolean }[]).filter((p) => p.is_live);
  const used = live.map((p) => `${p.body_html}\n${p.cover_url ?? ""}\n${p.icon ?? ""}`);
  const { data: vers } = await d.db.from("portfolio_page_versions").select("lang,version,snapshot").eq("user_id", d.userId).eq("slot_id", slotId).in("action", ["publish", "rollback"]).order("version", { ascending: false }).limit(40);
  const kept: Partial<Record<Lang, number>> = {};
  for (const v of (vers ?? []) as { lang: Lang; snapshot: Snapshot }[]) {
    if (!live.some((p) => p.lang === v.lang)) continue; // an unpublished language keeps nothing public
    if ((kept[v.lang] = (kept[v.lang] ?? 0) + 1) > 5) continue;
    used.push((v.snapshot?.media ?? []).join("\n"));
  }
  return removeUnused(d.store, slotId, used);
}

export type PublishOpts = { confirm?: boolean; /** hash of the preview the user confirmed */ expectHash?: string };
export type Published = { ok: true; version: number; path: string; slug: string; warnings: Warning[]; affected: Affected };

/** Makes the page live (first time or update). Re-builds from the note, so what goes live is always what the note says now. */
export async function publish(d: Deps, slotId: string, lang: Lang, opts: PublishOpts = {}): Promise<Published | Failure> {
  const b = await buildSnapshot(d, slotId, lang);
  if (!b.snapshot) return { ok: false, error: b.warnings.find((x) => x.level === "error")?.message ?? "Nothing to publish.", warnings: b.warnings };
  if (opts.expectHash && opts.expectHash !== b.snapshot.source_hash) return { ok: false, changed: true, error: "The note changed after the preview. Check the new preview first.", warnings: b.warnings };
  if (b.blocked) return { ok: false, error: "Fix the errors before publishing.", warnings: b.warnings };
  if (b.needsConfirm && !opts.confirm) return { ok: false, needsConfirm: true, error: "Review the warnings and confirm.", warnings: b.warnings };

  const s = b.snapshot;
  const existing = await existingPage(d, slotId, lang);
  await dropStages(d, slotId, lang);
  const version = await nextVersion(d, slotId, lang);
  const row = rowOf(d, slotId, s, version, existing);
  const { error } = await writePage(d, slotId, existing, row);
  if (error) return { ok: false, error: `Could not publish: ${error.message}`, warnings: b.warnings };
  await addVersion(d, slotId, lang, version, "publish", s, b.warnings);
  await prune(d, slotId, lang);
  await cleanupMedia(d, slotId);
  const prevPaths = (row.meta.previous_slugs as string[]).map((p) => s.path.replace(new RegExp(`${s.slug}$`), p));
  return { ok: true, version, path: s.path, slug: s.slug, warnings: b.warnings, affected: affected(s, prevPaths) };
}

function snapshotOfRow(r: Record<string, unknown>, slot: SlotRow, lang: Lang, noteId: string, hash: string, media: string[]): Snapshot {
  return {
    slot_key: r.slot_key as string,
    kind: r.kind as string,
    lang,
    slug: r.slug as string,
    path: pathFor({ kind: slot.kind, key: slot.key, langs: { [lang]: { slug: r.slug as string } } }, lang),
    title: r.title as string,
    summary: (r.summary as string | null) ?? null,
    icon: (r.icon as string | null) ?? null,
    cover_url: (r.cover_url as string | null) ?? null,
    body_html: r.body_html as string,
    toc: (r.toc as TocItem[]) ?? [],
    meta: (r.meta as Record<string, unknown>) ?? {},
    search_text: (r.search_text as string) ?? "",
    reading_minutes: (r.reading_minutes as number) ?? 1,
    featured: !!r.featured,
    position: (r.position as number) ?? 0,
    source_note_id: noteId,
    source_hash: hash,
    media,
  };
}

/** Takes the page offline (the row stays, hidden; the history keeps it). */
export async function unpublish(d: Deps, slotId: string, lang: Lang): Promise<{ ok: true; version: number; affected: Affected } | Failure> {
  const slot = await loadSlot(d, slotId);
  if (!slot) return { ok: false, error: "Page not found." };
  const { data } = await d.db.from("portfolio_pages").select("*").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).maybeSingle();
  const row = data as (Record<string, unknown> & { id: string; is_live: boolean }) | null;
  if (!row || !row.is_live) return { ok: false, error: "This page is not live." };
  const { error } = await d.db.from("portfolio_pages").update({ is_live: false }).eq("id", row.id);
  if (error) return { ok: false, error: error.message };
  const { data: last } = await d.db.from("portfolio_page_versions").select("source_note_id,source_hash,snapshot").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).in("action", ["publish", "rollback"]).order("version", { ascending: false }).limit(1);
  const lv = ((last ?? [])[0] as { source_note_id: string; source_hash: string; snapshot: Snapshot } | undefined) ?? null;
  const snap = snapshotOfRow(row, slot, lang, lv?.source_note_id ?? "", lv?.source_hash ?? "", lv?.snapshot?.media ?? []);
  const version = await nextVersion(d, slotId, lang);
  await dropStages(d, slotId, lang);
  await addVersion(d, slotId, lang, version, "unpublish", snap, []);
  await prune(d, slotId, lang);
  await cleanupMedia(d, slotId);
  return { ok: true, version, affected: affected(snap) };
}

/** Puts an older published version back as the live page (as a new version). */
export async function rollback(d: Deps, slotId: string, lang: Lang, version: number): Promise<{ ok: true; version: number; affected: Affected } | Failure> {
  const { data } = await d.db.from("portfolio_page_versions").select("*").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).eq("version", version).maybeSingle();
  const v = data as { action: string; snapshot: Snapshot; warnings: Warning[] } | null;
  if (!v || (v.action !== "publish" && v.action !== "rollback")) return { ok: false, error: "That version can't be restored." };
  const s = v.snapshot;
  for (const p of s.media ?? []) if (!(await d.store.exists(p))) return { ok: false, error: "Some images of that version were removed from the public site. Publish again from the note instead." };
  const { data: clash } = await d.db.from("portfolio_pages").select("slot_id").eq("user_id", d.userId).eq("lang", lang).eq("kind", s.kind).eq("slug", s.slug);
  if (((clash ?? []) as { slot_id: string }[]).some((r) => r.slot_id !== slotId)) return { ok: false, error: "Another page now uses that address." };
  const existing = await existingPage(d, slotId, lang);
  const next = await nextVersion(d, slotId, lang);
  const { error } = await writePage(d, slotId, existing, rowOf(d, slotId, s, next, existing));
  if (error) return { ok: false, error: error.message };
  await dropStages(d, slotId, lang);
  await addVersion(d, slotId, lang, next, "rollback", s, v.warnings ?? []);
  await prune(d, slotId, lang);
  await cleanupMedia(d, slotId);
  return { ok: true, version: next, affected: affected(s) };
}

export type HistoryItem = { version: number; action: "publish" | "unpublish" | "rollback"; created_at: string; title: string; source_hash: string | null; warnings: { errors: number; warnings: number; info: number }; current: boolean; restorable: boolean };

/** The last versions (publish / unpublish / rollback), newest first. */
export async function history(d: Deps, slotId: string, lang: Lang, limit = 10): Promise<HistoryItem[]> {
  const [{ data }, page] = await Promise.all([
    d.db.from("portfolio_page_versions").select("version,action,created_at,source_hash,warnings,snapshot").eq("user_id", d.userId).eq("slot_id", slotId).eq("lang", lang).in("action", ["publish", "unpublish", "rollback"]).order("version", { ascending: false }).limit(limit),
    existingPage(d, slotId, lang),
  ]);
  return ((data ?? []) as { version: number; action: HistoryItem["action"]; created_at: string; source_hash: string | null; warnings: Warning[]; snapshot: Snapshot }[]).map((r) => ({
    version: r.version,
    action: r.action,
    created_at: r.created_at,
    title: r.snapshot?.title ?? "",
    source_hash: r.source_hash,
    warnings: { errors: (r.warnings ?? []).filter((x) => x.level === "error").length, warnings: (r.warnings ?? []).filter((x) => x.level === "warning").length, info: (r.warnings ?? []).filter((x) => x.level === "info").length },
    current: !!page?.is_live && page.version === r.version,
    restorable: r.action !== "unpublish",
  }));
}
