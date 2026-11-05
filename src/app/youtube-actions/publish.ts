"use server";
// YouTube add-on (Worker C) — Publish step: save the package, ✨ translations, link the uploaded video,
// "Push to YouTube" (videos.update + thumbnails.set + playlistItems.insert), the user's playlists,
// mark as published (creates the 48h/7d/30d/90d check-ins) and captions from the final script (EN + ✨ ES,
// review, captions.insert). Writes go through the user's client (RLS "own rows"); tokens only on the server.
import { revalidatePath } from "next/cache";
import { aiChat } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { localNow } from "@/lib/time";
import { AI_PROMPT_MAX, MIGRATION_FILE, YT_LIMITS, videoHref } from "@/lib/youtube/constants";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { checkinsFor } from "@/lib/youtube/baseline";
import { chaptersForVideo } from "@/lib/youtube/chapters";
import { parseVideoId } from "@/lib/youtube/outliers";
import { stripSources } from "@/lib/youtube/outline";
import {
  captionTextFromSections, captionWarnings, checkPublish, chunkText, parsePlaylistId, parseTags, publishedProblems, requiredLangs,
} from "@/lib/youtube/publish-rules";
import { loadPublishData } from "@/lib/youtube/server/publish-data";
import { hasApiKey, YtError, type YtCtx } from "@/lib/youtube/server/yt-data";
import { getAccessToken } from "@/lib/youtube/server/yt-oauth";
import { loadThumbnail, myPlaylists, pushCaption, pushPackage, uploadedInfo, type MyPlaylist, type PushStep } from "@/lib/youtube/server/yt-publish";
import type { CaptionTrack, Chapter, Localization, PrivacyStatus, PublishFields, YtPublish, YtVideo } from "@/lib/youtube/types";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
type PgErr = { code?: string; message?: string } | null | undefined;
const dbFail = (e: PgErr) => (isMissingTable(e) ? MISSING : e?.message || "Something went wrong. Try again.");
const errText = (e: unknown) => (e instanceof YtError ? e.message : e instanceof Error ? e.message : "Something went wrong. Try again.");
const SIGNED_OUT = { error: "Sign in again." };

async function ctx(): Promise<YtCtx | null> {
  const { supabase, userId } = await ytServer();
  return userId ? { sb: supabase, userId } : null;
}
async function videoOf(c: YtCtx, id: string): Promise<YtVideo | null> {
  const { data } = await c.sb.from("yt_videos").select("*").eq("id", id).maybeSingle();
  return (data as YtVideo | null) ?? null;
}
async function publishRow(c: YtCtx, videoId: string): Promise<YtPublish | null> {
  const { data } = await c.sb.from("yt_publish").select("*").eq("video_id", videoId).maybeSingle();
  return (data as YtPublish | null) ?? null;
}
const refresh = (videoId: string) => {
  revalidatePath(videoHref(videoId, "publish"));
  revalidatePath("/youtube");
};

// ----- Save -------------------------------------------------------------------------------------------
export type PublishPatch = {
  fields?: PublishFields;
  localizations?: Record<string, Localization>;
  chapters?: Chapter[];
  playlists?: string[];
  pinned_comment?: string | null;
  checklist?: Record<string, boolean>;
  post_plan?: Record<string, unknown>;
};

const PRIVACY: PrivacyStatus[] = ["private", "unlisted", "public"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

function cleanFields(f: PublishFields): PublishFields {
  const out: PublishFields = {};
  if (f.title !== undefined) out.title = str(f.title, 200) ?? "";
  if (f.description !== undefined) out.description = str(f.description, 10_000) ?? "";
  if (f.tags !== undefined) out.tags = parseTags(f.tags ?? []).slice(0, 100);
  if (f.category_id !== undefined) out.category_id = /^\d{1,3}$/.test(f.category_id ?? "") ? f.category_id : undefined;
  if (f.default_language !== undefined) out.default_language = str(f.default_language, 10);
  if (f.default_audio_language !== undefined) out.default_audio_language = str(f.default_audio_language, 10);
  if (f.privacy !== undefined) out.privacy = PRIVACY.includes(f.privacy as PrivacyStatus) ? f.privacy : "private";
  if (f.publish_at !== undefined) out.publish_at = f.publish_at && Number.isFinite(Date.parse(f.publish_at)) ? new Date(f.publish_at).toISOString() : null;
  for (const k of ["made_for_kids", "embeddable", "public_stats", "synthetic_media"] as const) if (f[k] !== undefined) out[k] = !!f[k];
  if (f.license !== undefined) out.license = f.license === "creativeCommon" ? "creativeCommon" : "youtube";
  return out;
}

/** Saves the publish package (one row per video). Only the keys sent are changed. */
export async function savePublish(videoId: string, patch: PublishPatch): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const cur = await publishRow(c, videoId);
  const row: Record<string, unknown> = { video_id: videoId };
  if (patch.fields) {
    const fields = { ...(cur?.fields ?? {}), ...cleanFields(patch.fields) };
    row.fields = fields;
    row.scheduled_at = fields.publish_at ?? null;
  }
  if (patch.localizations) {
    const loc: Record<string, Localization> = {};
    for (const [k, v] of Object.entries(patch.localizations)) {
      if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k)) continue;
      loc[k] = { title: str(v?.title, 200) ?? "", description: str(v?.description, 10_000) ?? "" };
    }
    row.localizations = loc;
  }
  if (patch.chapters) row.chapters = patch.chapters.filter((ch) => Number.isFinite(ch.start_s) && ch.title?.trim()).map((ch) => ({ start_s: Math.max(0, Math.floor(ch.start_s)), title: ch.title.trim().slice(0, 100) })).slice(0, 100);
  if (patch.playlists) row.playlists = [...new Set(patch.playlists.map((p) => parsePlaylistId(p)).filter((p): p is string => !!p))].slice(0, 20);
  if (patch.pinned_comment !== undefined) row.pinned_comment = str(patch.pinned_comment, 10_000) ?? null;
  if (patch.checklist) row.checklist = { ...(cur?.checklist ?? {}), ...Object.fromEntries(Object.entries(patch.checklist).map(([k, v]) => [k.slice(0, 40), !!v])) };
  if (patch.post_plan) row.post_plan = { ...(cur?.post_plan ?? {}), ...patch.post_plan };
  const { error } = await c.sb.from("yt_publish").upsert(row, { onConflict: "video_id" });
  if (error) return { error: dbFail(error) };
  if (patch.fields) await c.sb.from("yt_videos").update({ scheduled_at: (row.fields as PublishFields).publish_at ?? null }).eq("id", videoId);
  refresh(videoId);
  return { ok: true };
}

// ----- ✨ Translations -----------------------------------------------------------------------------------
const LANG_NAME: Record<string, string> = { en: "English", es: "Spanish (Latin American, neutral)" };

/** ✨ Draft of the title + description in another language (the user edits before saving). */
export async function aiTranslatePackage(videoId: string, lang: string, src: { title: string; description: string; from: string }): Promise<{ title?: string; description?: string; error?: string; usage?: string | null }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const to = LANG_NAME[lang] ?? lang;
  const from = LANG_NAME[src.from] ?? src.from;
  if (!src.title.trim()) return { error: "Write the title first." };
  const system = `You translate YouTube titles and descriptions from ${from} to ${to}. Keep it natural for YouTube viewers, keep the same hook and meaning, keep the title under ${YT_LIMITS.titleMax} characters (shorter is better, ~60). Keep every line that starts with a time stamp (0:00, 1:23…) with the SAME time stamp, translate only the chapter name. Keep links, emojis and @handles exactly. Answer ONLY JSON: {"title": string, "description": string}`;
  const prompt = `TITLE:\n${src.title}\n\nDESCRIPTION:\n${src.description}`.slice(0, AI_PROMPT_MAX - 1500);
  let usage: string | null = null;
  const out = await withAiUsage(
    "youtube-translate",
    async () => {
      const o = await aiChat(system, [{ text: prompt }], { kind: "write", json: true, temperature: 0.3, maxTokens: 3000, timeoutMs: 45_000 });
      const { getSettings } = await import("@/lib/agenda");
      const { timezone } = await getSettings(c.sb);
      usage = await scopeUsageLine(c.sb, c.userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb: c.sb, userId: c.userId },
  );
  if (!("text" in out)) return { error: out.error, usage };
  try {
    const j = JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1)) as { title?: unknown; description?: unknown };
    const title = String(j.title ?? "").trim().slice(0, YT_LIMITS.titleMax);
    const description = String(j.description ?? "").trim().slice(0, YT_LIMITS.descriptionMax);
    if (!title) return { error: "The AI answered without a title. Try again.", usage };
    return { title, description, usage };
  } catch {
    return { error: "The AI answered in a strange way. Try again.", usage };
  }
}

// ----- Link the uploaded video -------------------------------------------------------------------------
export type LinkAnswer = { ok?: boolean; error?: string; ytId?: string; info?: { title: string | null; privacy: string | null; durationS: number | null; checked: boolean; otherChannel?: boolean } };

/** Saves the YouTube id (from a link or the bare id) after the user uploads in Studio. Checks it when possible. */
export async function linkYoutubeVideo(videoId: string, input: string): Promise<LinkAnswer> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const ytId = parseVideoId(input);
  if (!ytId) return { error: "That is not a YouTube video link or id (11 characters, like dQw4w9WgXcQ)." };
  const { data: dup } = await c.sb.from("yt_videos").select("id,code").eq("youtube_video_id", ytId).neq("id", videoId).limit(1);
  if (dup?.length) return { error: `That YouTube video is already linked to ${(dup[0] as { code: string | null }).code ?? "another video"}.` };
  let info: LinkAnswer["info"] = { title: null, privacy: null, durationS: null, checked: false };
  const tok = await getAccessToken(c.userId).catch(() => null);
  const token = tok && tok.token ? tok.token : null;
  if (token || hasApiKey()) {
    try {
      const u = await uploadedInfo(c, token, ytId);
      if (!u) return { error: "YouTube could not find that video. If it is still processing or private, connect Google (Settings) and try again." };
      const ownId = tok && tok.token ? tok.channelId : null;
      info = { title: u.title, privacy: u.privacy, durationS: u.durationS, checked: true, otherChannel: !!(ownId && u.channelId && ownId !== u.channelId) };
      if (info.otherChannel) return { error: "That video is on another channel. Paste the link of the video you uploaded." };
    } catch (e) {
      if (!(e instanceof YtError && (e.reason === "quota" || e.reason === "network"))) info = { ...info, checked: false };
    }
  }
  const cur = await publishRow(c, videoId);
  const plan = { ...(cur?.post_plan ?? {}), uploaded: { duration_s: info.durationS, privacy: info.privacy, title: info.title, checked_at: info.checked ? new Date().toISOString() : null } };
  const { error } = await c.sb.from("yt_publish").upsert({ video_id: videoId, youtube_video_id: ytId, post_plan: plan }, { onConflict: "video_id" });
  if (error) return { error: dbFail(error) };
  const { error: e2 } = await c.sb.from("yt_videos").update({ youtube_video_id: ytId }).eq("id", videoId);
  if (e2) return { error: dbFail(e2) };
  refresh(videoId);
  return { ok: true, ytId, info };
}

export async function unlinkYoutubeVideo(videoId: string): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (v?.stage === "published") return { error: "It is marked as published. Undo that first." };
  await c.sb.from("yt_publish").update({ youtube_video_id: null }).eq("video_id", videoId);
  const { error } = await c.sb.from("yt_videos").update({ youtube_video_id: null }).eq("id", videoId);
  if (error) return { error: dbFail(error) };
  refresh(videoId);
  return { ok: true };
}

// ----- Push to YouTube ------------------------------------------------------------------------------------
export type PushParts = { metadata: boolean; thumbnail: boolean; playlists: boolean };

/** Sends the saved package to the linked video. Blocked by the hard checks (intro gate, YouTube limits). */
export async function pushToYoutube(videoId: string, parts: PushParts): Promise<{ ok?: boolean; error?: string; log?: PushStep[]; blockers?: string[]; reconnect?: boolean }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  const d = await loadPublishData(c.sb, c.userId, v);
  const p = d.publish;
  const ytId = p?.youtube_video_id ?? v.youtube_video_id;
  if (!ytId) return { error: "Link the YouTube video first (step 1)." };
  const fields = p?.fields ?? {};
  const uploaded = (p?.post_plan?.uploaded ?? null) as { duration_s?: number | null } | null;
  const check = checkPublish({
    kind: v.kind,
    fields,
    localizations: p?.localizations ?? {},
    requiredLangs: requiredLangs(fields.default_language),
    chapters: p?.chapters ?? [],
    durationS: uploaded?.duration_s ?? d.cutSeconds,
    introStatus: d.introStatus,
    thumbnail: { present: !!d.primary?.thumb },
    now: new Date(),
  });
  if (parts.metadata && check.errors.length) return { error: "Fix these first:", blockers: check.errors };
  const tok = await getAccessToken(c.userId);
  if (tok.token === null) return { error: tok.error, reconnect: tok.reconnect };
  let thumbnail = null;
  if (parts.thumbnail && v.kind === "long") {
    const t = await loadThumbnail(c.sb, c.userId, d.primary?.thumb);
    if ("error" in t) return { error: t.error };
    thumbnail = t;
  }
  try {
    const r = await pushPackage(c, tok.token, {
      ytId,
      fields,
      localizations: p?.localizations ?? {},
      defaults: d.settings.publish_defaults,
      thumbnail,
      playlists: parts.playlists ? p?.playlists ?? [] : [],
      parts: { metadata: parts.metadata, thumbnail: parts.thumbnail && v.kind === "long", playlists: parts.playlists },
    });
    const log = [...(p?.push_log ?? []), ...r.log].slice(-40);
    await c.sb.from("yt_publish").update({ push_log: log, ...(r.ok ? { pushed_at: new Date().toISOString() } : {}) }).eq("video_id", videoId);
    if (r.ok && v.stage !== "published" && v.stage !== "publish") await c.sb.from("yt_videos").update({ stage: "publish" }).eq("id", videoId);
    refresh(videoId);
    return { ok: r.ok, log: r.log, error: r.ok ? undefined : "Some parts did not go through — see the list." };
  } catch (e) {
    return { error: errText(e) };
  }
}

/** The channel's playlists (needs Google connected; 1 unit). */
export async function loadMyPlaylists(): Promise<{ playlists?: MyPlaylist[]; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const tok = await getAccessToken(c.userId);
  if (tok.token === null) return { error: tok.error };
  try {
    return { playlists: await myPlaylists(c, tok.token) };
  } catch (e) {
    return { error: errText(e) };
  }
}

// ----- Published + check-ins -----------------------------------------------------------------------------
/** Marks the video as published (stage Published) and creates the 48h / 7d / 30d / 90d check-ins. */
export async function markPublished(videoId: string, publishedAtIso: string | null): Promise<{ ok?: boolean; error?: string; checkins?: number }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  const p = await publishRow(c, videoId);
  const ytId = p?.youtube_video_id ?? v.youtube_video_id;
  const at = publishedAtIso ?? p?.fields?.publish_at ?? new Date().toISOString();
  const problems = publishedProblems({ ytId, publishedAt: at, now: new Date() });
  if (problems.length) return { error: problems.join(" ") };
  const published = new Date(at).toISOString();
  const { error } = await c.sb.from("yt_videos").update({ stage: "published", published_at: published, youtube_video_id: ytId }).eq("id", videoId);
  if (error) return { error: dbFail(error) };
  const rows = checkinsFor(published).map((k) => ({ video_id: videoId, kind: k.kind, due_at: k.due_at }));
  // Re-marking with another date moves the check-ins that are not done yet.
  const { data: old } = await c.sb.from("yt_checkins").select("kind,done_at").eq("video_id", videoId);
  const done = new Set(((old ?? []) as { kind: string; done_at: string | null }[]).filter((o) => o.done_at).map((o) => o.kind));
  const todo = rows.filter((r) => !done.has(r.kind));
  if (todo.length) {
    const { error: e2 } = await c.sb.from("yt_checkins").upsert(todo, { onConflict: "video_id,kind" });
    if (e2) return { error: dbFail(e2) };
  }
  refresh(videoId);
  revalidatePath(videoHref(videoId, "follow-up"));
  return { ok: true, checkins: todo.length };
}

/** Undo "published" (wrong click): back to Publish; check-ins not done yet are removed. */
export async function unmarkPublished(videoId: string): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { error } = await c.sb.from("yt_videos").update({ stage: "publish", published_at: null }).eq("id", videoId);
  if (error) return { error: dbFail(error) };
  await c.sb.from("yt_checkins").delete().eq("video_id", videoId).is("done_at", null);
  refresh(videoId);
  return { ok: true };
}

// ----- Captions from the final script ---------------------------------------------------------------------
async function captionsOf(c: YtCtx, videoId: string): Promise<Record<string, CaptionTrack>> {
  return (await publishRow(c, videoId))?.captions ?? {};
}
async function saveCaptionsMap(c: YtCtx, videoId: string, captions: Record<string, CaptionTrack>, extra: Record<string, unknown> = {}) {
  return c.sb.from("yt_publish").upsert({ video_id: videoId, captions, ...extra }, { onConflict: "video_id" });
}

/** EN caption text built from the script sections (no sources, no cues). Replaces the EN draft (not reviewed). */
export async function buildCaptionsFromScript(videoId: string): Promise<{ text?: string; warnings?: string[]; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  const d = await loadPublishData(c.sb, c.userId, v);
  const text = captionTextFromSections(d.sections, stripSources);
  if (!text) return { error: "The script is empty. Write it in the Script tab first." };
  const caps = await captionsOf(c, videoId);
  caps.en = { text, reviewed: false, pushed_at: caps.en?.pushed_at ?? null, track_id: caps.en?.track_id ?? null };
  const { error } = await saveCaptionsMap(c, videoId, caps);
  if (error) return { error: dbFail(error) };
  refresh(videoId);
  const uploaded = ((await publishRow(c, videoId))?.post_plan?.uploaded ?? null) as { duration_s?: number | null } | null;
  return { text, warnings: captionWarnings({ text, wpm: d.settings.words_per_min, cutSeconds: uploaded?.duration_s ?? d.cutSeconds }) };
}

/** Saves an edited caption text; `reviewed` = the user read it (required before sending). */
export async function saveCaption(videoId: string, lang: string, text: string, reviewed: boolean): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!/^[a-z]{2}$/.test(lang)) return { error: "Unknown language." };
  const caps = await captionsOf(c, videoId);
  caps[lang] = { ...(caps[lang] ?? { pushed_at: null, track_id: null }), text: text.slice(0, 200_000), reviewed: !!reviewed && !!text.trim() };
  const { error } = await saveCaptionsMap(c, videoId, caps);
  if (error) return { error: dbFail(error) };
  refresh(videoId);
  return { ok: true };
}

/** ✨ ES (or EN) caption text translated from the other language, in chunks the free AI can take. */
export async function aiTranslateCaptions(videoId: string, to: "es" | "en"): Promise<{ text?: string; error?: string; usage?: string | null }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const from = to === "es" ? "en" : "es";
  const caps = await captionsOf(c, videoId);
  const src = caps[from]?.text?.trim();
  if (!src) return { error: `Make the ${from.toUpperCase()} captions first.` };
  const chunks = chunkText(src, 5000);
  if (chunks.length > 8) return { error: "The script is too long for the free AI in one go. Translate it in Studio, or shorten it." };
  const system = `Translate these video captions from ${LANG_NAME[from]} to ${LANG_NAME[to]}. Spoken, natural style. Keep the same paragraphs and line breaks, one output line per input line. Do not add anything. Answer only with the translated text.`;
  const parts: string[] = [];
  let usage: string | null = null;
  const err = await withAiUsage(
    "youtube-captions",
    async () => {
      for (const ch of chunks) {
        const o = await aiChat(system, [{ text: ch }], { kind: "write", temperature: 0.2, maxTokens: 4000, timeoutMs: 45_000 });
        if (!("text" in o)) return o.error;
        parts.push(o.text.trim());
      }
      const { getSettings } = await import("@/lib/agenda");
      const { timezone } = await getSettings(c.sb);
      usage = await scopeUsageLine(c.sb, c.userId, timezone, localNow(timezone).date).catch(() => null);
      return null;
    },
    { sb: c.sb, userId: c.userId },
  );
  if (err) return { error: err, usage };
  const text = parts.join("\n\n");
  caps[to] = { ...(caps[to] ?? { pushed_at: null, track_id: null }), text, reviewed: false };
  const { error } = await saveCaptionsMap(c, videoId, caps);
  if (error) return { error: dbFail(error), usage };
  refresh(videoId);
  return { text, usage };
}

/** Sends one reviewed caption track to the linked video (captions.insert, or update of our earlier track). */
export async function pushCaptions(videoId: string, lang: string): Promise<{ ok?: boolean; error?: string; reconnect?: boolean }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const p = await publishRow(c, videoId);
  const ytId = p?.youtube_video_id;
  if (!ytId) return { error: "Link the YouTube video first." };
  const caps = p?.captions ?? {};
  const t = caps[lang];
  if (!t?.text?.trim()) return { error: "No caption text for that language yet." };
  if (!t.reviewed) return { error: "Read the captions and tick “I reviewed them” first." };
  const tok = await getAccessToken(c.userId);
  if (tok.token === null) return { error: tok.error, reconnect: tok.reconnect };
  try {
    const name = lang === "es" ? "Español (guion)" : "English (script)";
    const r = await pushCaption(c, tok.token, { ytId, language: lang, name, text: t.text, trackId: t.track_id });
    const now = new Date().toISOString();
    caps[lang] = { ...t, pushed_at: now, track_id: r.trackId };
    const log = [...(p?.push_log ?? []), { at: now, what: `Captions ${lang.toUpperCase()}`, ok: true }].slice(-40);
    await saveCaptionsMap(c, videoId, caps, { captions_pushed: true, captions_pushed_at: now, push_log: log });
    refresh(videoId);
    return { ok: true };
  } catch (e) {
    const log = [...(p?.push_log ?? []), { at: new Date().toISOString(), what: `Captions ${lang.toUpperCase()}`, ok: false, error: errText(e) }].slice(-40);
    await c.sb.from("yt_publish").update({ push_log: log }).eq("video_id", videoId);
    return { error: errText(e) };
  }
}

/** Chapters again from the sections (real start times from Edit, otherwise estimated from the words). */
export async function chaptersFromScript(videoId: string): Promise<{ chapters?: Chapter[]; estimated?: boolean; problems?: string[]; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  const d = await loadPublishData(c.sb, c.userId, v);
  if (!d.sections.length) return { error: "There is no outline yet." };
  const uploaded = (d.publish?.post_plan?.uploaded ?? null) as { duration_s?: number | null } | null;
  const r = chaptersForVideo(d.sections, { wpm: d.settings.words_per_min, durationS: uploaded?.duration_s ?? d.cutSeconds });
  return { chapters: r.chapters, estimated: r.estimated, problems: r.check.problems };
}
