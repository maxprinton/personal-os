// Server only — writes to the user's own YouTube video with the Google access token (OAuth):
// videos.update (snippet/status/localizations), thumbnails.set, playlistItems.insert, captions.insert/update,
// and the user's playlists. Every call is counted in yt_quota through ytFetch. Never import from the browser.
import type { SupabaseClient } from "@supabase/supabase-js";
import { YT_LIMITS } from "@/lib/youtube/constants";
import { buildVideoUpdate, captionMultipart } from "@/lib/youtube/publish-rules";
import type { Localization, PublishDefaults, PublishFields } from "@/lib/youtube/types";
import { videoRaw, ytFetch, YtError, type YtCtx } from "@/lib/youtube/server/yt-data";

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

export type PushStep = { at: string; what: string; ok: boolean; error?: string };
const step = (what: string, ok: boolean, error?: string): PushStep => ({ at: new Date().toISOString(), what, ok, ...(error ? { error } : {}) });
const errMsg = (e: unknown) => (e instanceof YtError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

// ----- Thumbnail bytes ---------------------------------------------------------------------------------
export type ThumbBytes = { data: ArrayBuffer; mime: string; bytes: number };

/** Reads the primary pair's thumbnail: a web link (http…) or a Personal OS file (/api/files/<user>/<path>). */
export async function loadThumbnail(sb: SupabaseClient, userId: string, url: string | null | undefined): Promise<ThumbBytes | { error: string }> {
  if (!url) return { error: "The primary pair has no thumbnail image." };
  try {
    const m = /^\/api\/files\/(.+)$/.exec(url.split("?")[0]);
    if (m) {
      const key = m[1].split("/").map((p) => decodeURIComponent(p)).join("/");
      if (!key.startsWith(`${userId}/`) || key.includes("..")) return { error: "That thumbnail file is not yours." };
      const { data, error } = await sb.storage.from("note-files").download(key);
      if (error || !data) return { error: "Could not read the thumbnail file." };
      const buf = await data.arrayBuffer();
      return { data: buf, mime: data.type || mimeOf(key), bytes: buf.byteLength };
    }
    if (!/^https?:\/\//i.test(url)) return { error: "The thumbnail is not a link YouTube can use (upload the image in Package)." };
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return { error: `Could not download the thumbnail (${res.status}).` };
    const buf = await res.arrayBuffer();
    const mime = (res.headers.get("content-type") ?? "").split(";")[0] || mimeOf(url);
    return { data: buf, mime, bytes: buf.byteLength };
  } catch {
    return { error: "Could not download the thumbnail." };
  }
}
function mimeOf(name: string) {
  const n = name.toLowerCase();
  if (/\.png($|\?)/.test(n)) return "image/png";
  if (/\.webp($|\?)/.test(n)) return "image/webp";
  if (/\.gif($|\?)/.test(n)) return "image/gif";
  return "image/jpeg";
}
/** YouTube takes JPG, PNG, GIF and BMP for custom thumbnails (WebP is refused). */
export const THUMB_MIMES = ["image/jpeg", "image/png", "image/gif", "image/bmp"];

export const SHARP_MISSING = "Could not convert the thumbnail to JPG on the server (the image tool “sharp” is not available). Download the thumbnail, save it as JPG (1280×720, under 2 MB) and upload it in YouTube Studio.";

/**
 * thumbnails.set does not take WebP (Package stores WebP) and refuses files over 2 MB. Anything that is not
 * already a small JPG/PNG is converted here to JPEG 1280×720 (cover-cropped), lowering quality until it fits.
 * sharp is loaded only when needed (like src/lib/cover-fit.ts).
 */
export async function thumbForYoutube(t: ThumbBytes): Promise<ThumbBytes | { error: string }> {
  if ((t.mime === "image/jpeg" || t.mime === "image/png") && t.bytes <= YT_LIMITS.thumbnailMaxBytes) return t;
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return { error: SHARP_MISSING };
  }
  try {
    for (const quality of [88, 80, 70, 60, 50]) {
      const out = await sharp(Buffer.from(t.data)).rotate().resize(1280, 720, { fit: "cover", position: "attention" }).flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.byteLength <= YT_LIMITS.thumbnailMaxBytes) {
        const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
        return { data: ab, mime: "image/jpeg", bytes: out.byteLength };
      }
    }
    return { error: "The thumbnail is still over 2 MB after converting to JPG. Use a simpler image." };
  } catch {
    return { error: "Could not read the thumbnail image to convert it to JPG. Try uploading it again in Package." };
  }
}

// ----- Push the package ----------------------------------------------------------------------------------
export type PushInput = {
  ytId: string;
  fields: PublishFields;
  localizations: Record<string, Localization>;
  defaults?: PublishDefaults;
  thumbnail?: ThumbBytes | null;
  playlists: string[];
  /** what to send (default: everything) */
  parts?: { metadata?: boolean; thumbnail?: boolean; playlists?: boolean };
};

/**
 * Sends the package to the uploaded video. Each part is tried on its own and logged (one failing part does
 * not stop the others). Returns the log; `ok` = no part failed.
 */
export async function pushPackage(ctx: YtCtx, token: string, p: PushInput): Promise<{ ok: boolean; log: PushStep[]; privacy?: string | null; publishAt?: string | null; title?: string | null }> {
  const want = { metadata: true, thumbnail: true, playlists: true, ...(p.parts ?? {}) };
  const log: PushStep[] = [];
  let privacy: string | null = null;
  let publishAt: string | null = null;
  let title: string | null = null;

  if (want.metadata) {
    try {
      const current = await videoRaw(ctx, p.ytId, token, "snippet,status,localizations");
      if (!current) throw new YtError("not_found", "YouTube could not find that video on your channel. Check the link.");
      const { parts, body } = buildVideoUpdate(current as unknown as Parameters<typeof buildVideoUpdate>[0], p.fields, p.localizations, p.defaults ?? {});
      const out = await ytFetch<{ status?: { privacyStatus?: string; publishAt?: string }; snippet?: { title?: string } }>(
        ctx,
        "videos",
        { part: parts },
        { cost: "videosUpdate", token, method: "PUT", body },
      );
      privacy = out.status?.privacyStatus ?? null;
      publishAt = out.status?.publishAt ?? null;
      title = out.snippet?.title ?? null;
      log.push(step("Title, description, tags, category, languages, translations, privacy & schedule", true));
    } catch (e) {
      log.push(step("Title, description, tags, category, languages, translations, privacy & schedule", false, errMsg(e)));
    }
  }

  if (want.thumbnail) {
    let t = p.thumbnail ?? null;
    let convErr: string | null = null;
    if (t) {
      const c = await thumbForYoutube(t);
      if ("error" in c) convErr = c.error;
      else t = c;
    }
    if (convErr) log.push(step("Thumbnail", false, convErr));
    else if (!t) log.push(step("Thumbnail", false, "No thumbnail image to send."));
    else if (t.bytes > YT_LIMITS.thumbnailMaxBytes) log.push(step("Thumbnail", false, "The thumbnail is bigger than 2 MB."));
    else if (!THUMB_MIMES.includes(t.mime)) log.push(step("Thumbnail", false, `YouTube does not take ${t.mime} thumbnails: use JPG or PNG.`));
    else {
      try {
        await ytFetch(ctx, "thumbnails/set", { videoId: p.ytId }, { cost: "thumbnailsSet", token, method: "POST", base: UPLOAD, rawBody: t.data, contentType: t.mime, timeoutMs: 30_000 });
        log.push(step("Thumbnail", true));
      } catch (e) {
        const m = errMsg(e);
        log.push(step("Thumbnail", false, /forbidden/i.test(m) ? `${m} (Custom thumbnails need a verified phone on the channel: youtube.com/verify.)` : m));
      }
    }
  }

  if (want.playlists) {
    for (const pl of p.playlists) {
      try {
        const has = await ytFetch<{ items?: unknown[] }>(ctx, "playlistItems", { part: "id", playlistId: pl, videoId: p.ytId, maxResults: 1 }, { cost: "playlistItemsList", token });
        if (has.items?.length) {
          log.push(step(`Playlist ${pl} (already in it)`, true));
          continue;
        }
        await ytFetch(ctx, "playlistItems", { part: "snippet" }, { cost: "playlistItemsInsert", token, method: "POST", body: { snippet: { playlistId: pl, resourceId: { kind: "youtube#video", videoId: p.ytId } } } });
        log.push(step(`Playlist ${pl}`, true));
      } catch (e) {
        log.push(step(`Playlist ${pl}`, false, errMsg(e)));
      }
    }
  }
  return { ok: log.every((l) => l.ok), log, privacy, publishAt, title };
}

// ----- Captions ------------------------------------------------------------------------------------------
/**
 * Uploads a caption track as plain text; YouTube times it against the audio (sync=true). With trackId it
 * replaces that track (captions.update) instead of adding a new one.
 */
export async function pushCaption(ctx: YtCtx, token: string, o: { ytId: string; language: string; name: string; text: string; trackId?: string | null }): Promise<{ trackId: string | null }> {
  const boundary = `pos${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  if (o.trackId) {
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ id: o.trackId, snippet: { isDraft: false } }),
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      o.text,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    try {
      const j = await ytFetch<{ id?: string }>(ctx, "captions", { part: "snippet", uploadType: "multipart", sync: true }, {
        cost: "captionsInsert", token, method: "PUT", base: UPLOAD, rawBody: body, contentType: `multipart/related; boundary=${boundary}`, timeoutMs: 60_000,
      });
      return { trackId: j.id ?? o.trackId };
    } catch (e) {
      // The track was deleted in Studio → add a new one below.
      if (!(e instanceof YtError && e.reason === "not_found")) throw e;
    }
  }
  const body = captionMultipart({ videoId: o.ytId, language: o.language, name: o.name, text: o.text, boundary });
  const j = await ytFetch<{ id?: string }>(ctx, "captions", { part: "snippet", uploadType: "multipart", sync: true }, {
    cost: "captionsInsert", token, method: "POST", base: UPLOAD, rawBody: body, contentType: `multipart/related; boundary=${boundary}`, timeoutMs: 60_000,
  });
  return { trackId: j.id ?? null };
}

// ----- Playlists & the uploaded video ---------------------------------------------------------------------
export type MyPlaylist = { id: string; title: string; count: number | null; privacy: string | null };

/** The signed-in channel's playlists (1 unit). */
export async function myPlaylists(ctx: YtCtx, token: string): Promise<MyPlaylist[]> {
  type Item = { id?: string; snippet?: { title?: string }; contentDetails?: { itemCount?: number }; status?: { privacyStatus?: string } };
  const j = await ytFetch<{ items?: Item[] }>(ctx, "playlists", { part: "snippet,contentDetails,status", mine: true, maxResults: 50 }, { cost: "playlistItemsList", token });
  return (j.items ?? []).filter((i) => i.id).map((i) => ({ id: i.id!, title: i.snippet?.title ?? i.id!, count: i.contentDetails?.itemCount ?? null, privacy: i.status?.privacyStatus ?? null }));
}

export type UploadedInfo = { title: string | null; privacy: string | null; publishAt: string | null; publishedAt: string | null; durationS: number | null; channelId: string | null };

/** Looks at the video the user uploaded (checks it is on their channel; reads duration and status). */
export async function uploadedInfo(ctx: YtCtx, token: string | null, ytId: string): Promise<UploadedInfo | null> {
  type Item = { snippet?: { title?: string; publishedAt?: string; channelId?: string }; status?: { privacyStatus?: string; publishAt?: string }; contentDetails?: { duration?: string } };
  const j = await ytFetch<{ items?: Item[] }>(ctx, "videos", { part: token ? "snippet,status,contentDetails" : "snippet,contentDetails", id: ytId }, { cost: "videosList", token });
  const it = j.items?.[0];
  if (!it) return null;
  const { parseIsoDuration } = await import("@/lib/youtube/outliers");
  return {
    title: it.snippet?.title ?? null,
    privacy: it.status?.privacyStatus ?? null,
    publishAt: it.status?.publishAt ?? null,
    publishedAt: it.snippet?.publishedAt ?? null,
    durationS: it.contentDetails?.duration ? parseIsoDuration(it.contentDetails.duration) : null,
    channelId: it.snippet?.channelId ?? null,
  };
}
