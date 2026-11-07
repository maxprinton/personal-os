// Portfolio add-on, Phase 5 — public snapshot of FINISHED long-form videos.
// Only a short, fixed list of fields ever leaves the YouTube add-on: title, short description, YouTube id, date,
// thumbnail and length. Scripts, shot lists, A/B tests, ratings and strategy are never read. SERVER or tests (no Next imports).
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffType, type MediaStore } from "@/lib/portfolio/publish/media";

export const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ——— what the YouTube add-on gives us (read-only) ———
export type VideoSource = {
  id: string;
  idea_name: string;
  kind: string;
  stage: string;
  youtube_video_id: string | null;
  published_at: string | null;
  fields?: { title?: string; description?: string; privacy?: string } | null;
  localizations?: Record<string, { title?: string; description?: string }> | null;
  /** title of the primary title/thumbnail pair, when there is one */
  pairTitle?: string | null;
};

/** A video can be shown only when it is a finished, public, long-form video with a YouTube id. */
export function eligibility(v: VideoSource): { ok: true } | { ok: false; reason: string } {
  if (v.kind !== "long") return { ok: false, reason: "Only long videos can be shown (not Shorts)." };
  if (v.stage !== "published") return { ok: false, reason: "The video is not published yet." };
  if (!v.youtube_video_id || !YT_ID.test(v.youtube_video_id)) return { ok: false, reason: "The video has no valid YouTube id." };
  const privacy = v.fields?.privacy;
  if (privacy && privacy !== "public") return { ok: false, reason: "The video is not public on YouTube." };
  return { ok: true };
}

const clean = (s: unknown) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim();

/** Public title in a language: its localization, else the main title, else the title of the primary pair, else the idea name. */
export function publicTitle(v: VideoSource, lang: "en" | "es"): string {
  const t = clean(v.localizations?.[lang]?.title) || clean(v.fields?.title) || clean(v.pairTitle) || clean(v.idea_name) || "Untitled";
  return t.length > 150 ? t.slice(0, 149).trimEnd() + "…" : t;
}

/** A short plain-text description: first paragraphs only, no links, no chapter list, 400 characters at most. */
export function publicDescription(v: VideoSource, lang: "en" | "es", max = 400): string {
  const raw = String(v.localizations?.[lang]?.description ?? v.fields?.description ?? "").replace(/\r/g, "");
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (/^\s*[(\[]?\d{1,2}:\d{2}/.test(line)) break; // chapters start here
    lines.push(line.replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, ""));
  }
  const text = clean(lines.join(" "));
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/** Exactly the columns we copy. Nothing else from the source can get in. */
export type VideoSnapshot = {
  yt_video_id: string;
  youtube_video_id: string;
  title: { en: string; es: string };
  description: { en: string; es: string };
  published_at: string | null;
};
export function snapshotOf(v: VideoSource): VideoSnapshot {
  return {
    yt_video_id: v.id,
    youtube_video_id: v.youtube_video_id!,
    title: { en: publicTitle(v, "en"), es: publicTitle(v, "es") },
    description: { en: publicDescription(v, "en"), es: publicDescription(v, "es") },
    published_at: v.published_at ?? null,
  };
}

// ——— reading the sources ———
export async function loadSources(sb: SupabaseClient, userId: string, ids?: string[]): Promise<VideoSource[]> {
  let q = sb.from("yt_videos").select("id,idea_name,kind,stage,youtube_video_id,published_at").eq("user_id", userId).eq("kind", "long").eq("stage", "published").not("youtube_video_id", "is", null);
  if (ids) q = q.in("id", ids);
  const { data } = await q.order("published_at", { ascending: false });
  const vids = (data ?? []) as VideoSource[];
  if (!vids.length) return [];
  const vids_ids = vids.map((v) => v.id);
  const [pub, pairs] = await Promise.all([
    sb.from("yt_publish").select("video_id,fields,localizations").eq("user_id", userId).in("video_id", vids_ids),
    sb.from("yt_pairs").select("video_id,title_id").eq("user_id", userId).eq("is_primary", true).in("video_id", vids_ids),
  ]);
  const pubBy = new Map(((pub.data ?? []) as { video_id: string; fields: VideoSource["fields"]; localizations: VideoSource["localizations"] }[]).map((p) => [p.video_id, p]));
  const pairRows = (pairs.data ?? []) as { video_id: string; title_id: string | null }[];
  const titleIds = pairRows.map((p) => p.title_id).filter((x): x is string => !!x);
  const titles = titleIds.length ? ((await sb.from("yt_variants").select("id,value").eq("user_id", userId).in("id", titleIds)).data ?? []) as { id: string; value: string }[] : [];
  const titleBy = new Map(titles.map((t) => [t.id, t.value]));
  return vids.map((v) => {
    const p = pubBy.get(v.id);
    const pair = pairRows.find((r) => r.video_id === v.id);
    return { ...v, fields: p?.fields ?? null, localizations: p?.localizations ?? null, pairTitle: pair?.title_id ? titleBy.get(pair.title_id) ?? null : null };
  });
}

// ——— thumbnail: copied to our own bucket so visitors do not call YouTube until they press play ———
const THUMB_MAX = 2 * 1024 * 1024;
export async function copyThumbnail(store: MediaStore, ytId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!YT_ID.test(ytId)) return null;
  for (const name of ["maxresdefault", "hqdefault"]) {
    try {
      const res = await fetcher(`https://i.ytimg.com/vi/${ytId}/${name}.jpg`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > THUMB_MAX || sniffType(bytes) !== "image/jpeg") continue;
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const path = `videos/${ytId}-${hash}.jpg`;
      if (!(await store.exists(path)) && !(await store.upload(path, bytes, "image/jpeg"))) continue;
      // an older picture of the same video is no longer needed
      const old = (await store.list("videos")).filter((p) => p.startsWith(`videos/${ytId}-`) && p !== path);
      if (old.length) await store.remove(old);
      return store.publicBase + path;
    } catch {
      /* try the next size */
    }
  }
  return null;
}

// ——— the owner's list ———
export type VideoRow = {
  id: string;
  yt_video_id: string | null;
  youtube_video_id: string;
  title: { en?: string; es?: string };
  description: { en?: string; es?: string };
  thumb_url: string | null;
  duration_s: number | null;
  published_at: string | null;
  featured: boolean;
  position: number;
  is_live: boolean;
};
const ROW_COLS = "id,yt_video_id,youtube_video_id,title,description,thumb_url,duration_s,published_at,featured,position,is_live";

export type VideoDeps = {
  sb: SupabaseClient;
  userId: string;
  store: MediaStore;
  fetcher?: typeof fetch;
  /** length in seconds (best effort: null when the YouTube API key is missing) */
  durationOf?: (ytId: string) => Promise<number | null>;
};

export async function listVideos(sb: SupabaseClient, userId: string): Promise<VideoRow[]> {
  const { data } = await sb.from("portfolio_videos").select(ROW_COLS).eq("user_id", userId).order("position", { ascending: true });
  return (data ?? []) as VideoRow[];
}

/** Finished videos that can still be added (not already in the list). */
export async function pickable(sb: SupabaseClient, userId: string): Promise<{ id: string; name: string; youtube_video_id: string; published_at: string | null; reason?: string }[]> {
  const [sources, have] = await Promise.all([loadSources(sb, userId), listVideos(sb, userId)]);
  const taken = new Set(have.map((h) => h.yt_video_id).concat(have.map((h) => h.youtube_video_id)));
  return sources
    .filter((v) => !taken.has(v.id) && !taken.has(v.youtube_video_id))
    .map((v) => {
      const e = eligibility(v);
      return { id: v.id, name: publicTitle(v, "en"), youtube_video_id: v.youtube_video_id!, published_at: v.published_at, ...(e.ok ? {} : { reason: e.reason }) };
    });
}

async function extras(d: VideoDeps, ytId: string) {
  const [thumb, dur] = await Promise.all([copyThumbnail(d.store, ytId, d.fetcher), d.durationOf ? d.durationOf(ytId).catch(() => null) : Promise.resolve(null)]);
  return { thumb_url: thumb ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, duration_s: dur };
}

export async function addVideo(d: VideoDeps, ytVideoUuid: string): Promise<Result<{ id: string }>> {
  const [src] = await loadSources(d.sb, d.userId, [ytVideoUuid]);
  if (!src) return fail("That video is not a finished long video.");
  const e = eligibility(src);
  if (!e.ok) return fail(e.reason);
  const have = await listVideos(d.sb, d.userId);
  if (have.some((h) => h.yt_video_id === src.id || h.youtube_video_id === src.youtube_video_id)) return fail("That video is already on the list.");
  const snap = snapshotOf(src);
  const position = have.reduce((m, h) => Math.max(m, h.position), 0) + 1;
  const row = { ...snap, ...(await extras(d, snap.youtube_video_id)), user_id: d.userId, featured: false, is_live: true, position };
  const { data, error } = await d.sb.from("portfolio_videos").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Could not add the video.");
  return { ok: true, id: (data as { id: string }).id };
}

/** Pulls title, description, date, thumbnail and length again from the YouTube add-on. Videos whose source is gone keep what they have. */
export async function refreshVideos(d: VideoDeps, id?: string): Promise<Result<{ updated: number; skipped: number }>> {
  const rows = (await listVideos(d.sb, d.userId)).filter((r) => !id || r.id === id);
  if (id && !rows.length) return fail("That video is not on the list.");
  const ids = rows.map((r) => r.yt_video_id).filter((x): x is string => !!x);
  const sources = ids.length ? await loadSources(d.sb, d.userId, ids) : [];
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const src = sources.find((s) => s.id === r.yt_video_id);
    if (!src || !eligibility(src).ok) {
      skipped++;
      continue;
    }
    const snap = snapshotOf(src);
    const { error } = await d.sb
      .from("portfolio_videos")
      .update({ title: snap.title, description: snap.description, published_at: snap.published_at, youtube_video_id: snap.youtube_video_id, ...(await extras(d, snap.youtube_video_id)) })
      .eq("user_id", d.userId)
      .eq("id", r.id);
    if (error) return fail(error.message);
    updated++;
  }
  return { ok: true, updated, skipped };
}

export async function removeVideo(d: VideoDeps, id: string): Promise<Result> {
  const row = (await listVideos(d.sb, d.userId)).find((r) => r.id === id);
  if (!row) return fail("That video is not on the list.");
  const { error } = await d.sb.from("portfolio_videos").delete().eq("user_id", d.userId).eq("id", id);
  if (error) return fail(error.message);
  const old = (await d.store.list("videos")).filter((p) => p.startsWith(`videos/${row.youtube_video_id}-`));
  if (old.length) await d.store.remove(old);
  return { ok: true };
}

export async function setVideoFlag(d: Pick<VideoDeps, "sb" | "userId">, id: string, flag: "is_live" | "featured", value: boolean): Promise<Result> {
  const { error } = await d.sb.from("portfolio_videos").update({ [flag]: value }).eq("user_id", d.userId).eq("id", id);
  return error ? fail(error.message) : { ok: true };
}

/** Swaps the video with its neighbour. */
export async function moveVideo(d: Pick<VideoDeps, "sb" | "userId">, id: string, dir: "up" | "down"): Promise<Result> {
  const rows = await listVideos(d.sb, d.userId);
  const i = rows.findIndex((r) => r.id === id);
  if (i === -1) return fail("That video is not on the list.");
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= rows.length) return { ok: true };
  // give every row a clean 1..n position, with the two swapped
  const order = rows.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (let k = 0; k < order.length; k++) {
    const { error } = await d.sb.from("portfolio_videos").update({ position: k + 1 }).eq("user_id", d.userId).eq("id", order[k]);
    if (error) return fail(error.message);
  }
  return { ok: true };
}
