// Server only — YouTube Data API v3 with the API key (YOUTUBE_API_KEY) or, for the user's own channel, a
// Google access token (OAuth). Plain fetch, no SDK. Every call is counted in yt_quota (the quota day resets at
// midnight Pacific time; search.list has its own 100-a-day bucket, everything else uses the 10,000 units) and
// answers are cached in yt_api_cache. Works with the user's client (RLS) or the admin client (cron) because
// every query filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BASELINE_LAST_N, YT_QUOTA, parseChannelUrl } from "@/lib/youtube/constants";
import { localNow } from "@/lib/time";
import {
  applyFinder, buildCandidates, channelMedian, finderSearchParams, parseChannels, parseVideos, playlistVideoIds, prefilter, searchChannelIds,
  searchVideoIds, withFilterDefaults,
  type ApiChannelItem, type ApiList, type ApiPlaylistItem, type ApiSearchItem, type ApiVideoItem, type ChannelStat, type FinderResult, type VideoStat,
} from "@/lib/youtube/outliers";
import type { FinderFilters } from "@/lib/youtube/types";

const API = "https://www.googleapis.com/youtube/v3";
export const NO_KEY_MESSAGE = "Add YOUTUBE_API_KEY in Vercel — see ACTIVAR-YOUTUBE-API.md.";

export type YtCtx = { sb: SupabaseClient; userId: string };
export type CostKey = keyof typeof YT_QUOTA.cost;

export class YtError extends Error {
  constructor(public reason: string, message: string, public status = 0) {
    super(message);
  }
}

export const hasApiKey = () => !!process.env.YOUTUBE_API_KEY?.trim();

// ----- Quota ----------------------------------------------------------------------------------------
/** Today's quota day (YouTube resets at midnight Pacific time). */
export const quotaDay = () => localNow(YT_QUOTA.resetTimezone).date;

export type QuotaUse = { day: string; units: number; searchCalls: number; unitsLeft: number; searchLeft: number };

export async function quotaToday(ctx: YtCtx): Promise<QuotaUse> {
  const day = quotaDay();
  const { data } = await ctx.sb.from("yt_quota").select("units,search_calls").eq("user_id", ctx.userId).eq("day", day).maybeSingle();
  const units = (data?.units as number | undefined) ?? 0;
  const searchCalls = (data?.search_calls as number | undefined) ?? 0;
  return { day, units, searchCalls, unitsLeft: Math.max(0, YT_QUOTA.dailyUnits - units), searchLeft: Math.max(0, YT_QUOTA.searchCallsPerDay - searchCalls) };
}

/** Counts a call BEFORE making it (Google counts failed calls too). Throws when the day's quota is used up. */
export async function spendQuota(ctx: YtCtx, cost: CostKey, times = 1) {
  const q = await quotaToday(ctx);
  const isSearch = cost === "search";
  const units = isSearch ? 0 : YT_QUOTA.cost[cost] * times;
  if (isSearch && q.searchCalls + times > YT_QUOTA.searchCallsPerDay) throw new YtError("quota", `You used today's ${YT_QUOTA.searchCallsPerDay} searches. They come back after midnight Pacific time.`);
  if (!isSearch && q.units + units > YT_QUOTA.dailyUnits) throw new YtError("quota", "Today's YouTube API quota is used up. It comes back after midnight Pacific time.");
  await ctx.sb.from("yt_quota").upsert(
    { user_id: ctx.userId, day: q.day, units: q.units + units, search_calls: q.searchCalls + (isSearch ? times : 0) },
    { onConflict: "user_id,day" },
  );
}

// ----- Cache ----------------------------------------------------------------------------------------
export async function cacheGet<T>(ctx: YtCtx, key: string, opts: { allowStale?: boolean } = {}): Promise<{ data: T; fetchedAt: string; stale: boolean } | null> {
  const { data } = await ctx.sb.from("yt_api_cache").select("data,fetched_at,expires_at").eq("user_id", ctx.userId).eq("key", key).maybeSingle();
  if (!data) return null;
  const stale = !!data.expires_at && Date.parse(data.expires_at as string) < Date.now();
  if (stale && !opts.allowStale) return null;
  return { data: data.data as T, fetchedAt: data.fetched_at as string, stale };
}
export async function cacheSet(ctx: YtCtx, key: string, data: unknown, ttlMs: number | null) {
  await ctx.sb
    .from("yt_api_cache")
    .upsert({ user_id: ctx.userId, key, data, fetched_at: new Date().toISOString(), expires_at: ttlMs === null ? null : new Date(Date.now() + ttlMs).toISOString() }, { onConflict: "user_id,key" });
}
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ----- Raw calls ------------------------------------------------------------------------------------
type ApiErr = { error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] } };

export function friendlyApiError(status: number, body: ApiErr | null): YtError {
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const msg = body?.error?.message ?? "";
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(reason)) return new YtError("quota", "YouTube says the daily API quota is used up. Try again after midnight Pacific time.", status);
  if (/keyInvalid|badRequest/i.test(reason) && /key/i.test(msg)) return new YtError("key", "YouTube refused the API key. Check YOUTUBE_API_KEY (ACTIVAR-YOUTUBE-API.md).", status);
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + msg)) return new YtError("disabled", "The YouTube Data API is not enabled in your Google Cloud project (ACTIVAR-YOUTUBE-API.md, step 3).", status);
  if (/ipRefererBlocked|API_KEY_.*BLOCKED|referer/i.test(reason + msg)) return new YtError("key", "The API key is restricted in a way that blocks the server. Restrict it by API (YouTube Data API v3), not by website.", status);
  if (status === 401) return new YtError("auth", "Google sign-in expired. Reconnect Google in YouTube → Settings.", status);
  if (/forbidden|insufficientPermissions/i.test(reason) || status === 403) return new YtError("forbidden", `YouTube refused: ${msg || reason || "forbidden"}.`, status);
  if (status === 404 || /notFound|videoNotFound/i.test(reason)) return new YtError("not_found", "YouTube could not find that video/channel.", status);
  return new YtError("api", `YouTube API error ${status}${msg ? `: ${msg}` : ""}`, status);
}

/**
 * GET/POST/PUT to the Data API. With `token` it acts as the signed-in channel (OAuth); otherwise uses the key.
 * `cost` is counted in yt_quota first.
 */
export async function ytFetch<T>(
  ctx: YtCtx,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  opts: { cost: CostKey; times?: number; token?: string | null; method?: "GET" | "POST" | "PUT"; body?: unknown; base?: string; contentType?: string; rawBody?: BodyInit; timeoutMs?: number },
): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!opts.token && !key) throw new YtError("no_key", NO_KEY_MESSAGE);
  const url = new URL(`${opts.base ?? API}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  if (!opts.token && key) url.searchParams.set("key", key);
  await spendQuota(ctx, opts.cost, opts.times ?? 1);
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    if (opts.contentType) headers["content-type"] = opts.contentType;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), cache: "no-store" });
  } catch {
    throw new YtError("network", "Could not reach YouTube. Try again.");
  }
  const json = (await res.json().catch(() => null)) as (T & ApiErr) | null;
  if (!res.ok) throw friendlyApiError(res.status, json);
  return (json ?? ({} as T)) as T;
}

const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ----- Videos & channels ----------------------------------------------------------------------------
export async function videosStats(ctx: YtCtx, ids: string[], opts: { token?: string | null; parts?: string } = {}): Promise<VideoStat[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: VideoStat[] = [];
  for (const c of chunks(uniq, 50)) {
    const j = await ytFetch<ApiList<ApiVideoItem>>(ctx, "videos", { part: opts.parts ?? "snippet,contentDetails,statistics", id: c.join(","), maxResults: 50 }, { cost: "videosList", token: opts.token });
    out.push(...parseVideos(j));
  }
  return out;
}

/** Full videos.list items (for videos.update merging). */
export async function videoRaw(ctx: YtCtx, id: string, token: string, parts = "snippet,status,localizations,contentDetails"): Promise<ApiVideoItem & { localizations?: Record<string, { title: string; description: string }> } | null> {
  const j = await ytFetch<ApiList<ApiVideoItem & { localizations?: Record<string, { title: string; description: string }> }>>(ctx, "videos", { part: parts, id }, { cost: "videosList", token });
  return j.items?.[0] ?? null;
}

export async function channelsByIds(ctx: YtCtx, ids: string[]): Promise<ChannelStat[]> {
  const out: ChannelStat[] = [];
  for (const c of chunks([...new Set(ids.filter(Boolean))], 50)) {
    const j = await ytFetch<ApiList<ApiChannelItem>>(ctx, "channels", { part: "snippet,statistics,contentDetails", id: c.join(","), maxResults: 50 }, { cost: "channelsList" });
    out.push(...parseChannels(j));
  }
  return out;
}

/**
 * Any channel link / @handle / UC… id → the channel. @handle uses forHandle, /user/ forUsername (1 unit
 * each); /c/name has no direct lookup, so it costs one search (from the 100-a-day bucket).
 */
export async function resolveChannel(ctx: YtCtx, input: string): Promise<ChannelStat | null> {
  const raw = input.trim();
  const direct = /^UC[\w-]{22}$/.test(raw) ? { url: "", handle: null, channelId: raw } : parseChannelUrl(raw);
  if (!direct) return null;
  const cacheKey = `chan:${(direct.channelId ?? direct.handle ?? direct.url).toLowerCase()}`;
  const hit = await cacheGet<ChannelStat>(ctx, cacheKey);
  if (hit) return hit.data;
  let ch: ChannelStat | null = null;
  const part = "snippet,statistics,contentDetails";
  if (direct.channelId) ch = (await channelsByIds(ctx, [direct.channelId]))[0] ?? null;
  else if (direct.handle) ch = parseChannels(await ytFetch<ApiList<ApiChannelItem>>(ctx, "channels", { part, forHandle: direct.handle }, { cost: "channelsList" }))[0] ?? null;
  else {
    const m = /youtube\.com\/(c|user)\/([^/?#]+)/i.exec(direct.url);
    if (m && m[1].toLowerCase() === "user") ch = parseChannels(await ytFetch<ApiList<ApiChannelItem>>(ctx, "channels", { part, forUsername: decodeURIComponent(m[2]) }, { cost: "channelsList" }))[0] ?? null;
    if (!ch && m) {
      const ids = searchChannelIds(await ytFetch<ApiList<ApiSearchItem>>(ctx, "search", { part: "snippet", type: "channel", q: decodeURIComponent(m[2]), maxResults: 1 }, { cost: "search" }));
      if (ids[0]) ch = (await channelsByIds(ctx, [ids[0]]))[0] ?? null;
    }
  }
  if (ch) await cacheSet(ctx, cacheKey, ch, 7 * DAY);
  return ch;
}

/** Latest uploads of a channel with stats (2 units: playlistItems + videos). */
export async function channelUploads(ctx: YtCtx, ch: Pick<ChannelStat, "id" | "uploadsPlaylist">, max = 30, token?: string | null): Promise<VideoStat[]> {
  const pl = ch.uploadsPlaylist ?? (ch.id.startsWith("UC") ? `UU${ch.id.slice(2)}` : null);
  if (!pl) return [];
  const j = await ytFetch<ApiList<ApiPlaylistItem>>(ctx, "playlistItems", { part: "contentDetails", playlistId: pl, maxResults: Math.min(50, max) }, { cost: "playlistItemsList", token });
  const ids = playlistVideoIds(j);
  return ids.length ? videosStats(ctx, ids, { token }) : [];
}

export type ChannelBaseline = { channelId: string; title: string; subs: number | null; medianLong: number | null; medianShort: number | null; nLong: number; nShort: number; at: string; uploads?: VideoStat[] };

/** Usual views of a channel (long and Shorts separately), cached 7 days. Costs 2–3 units when not cached. */
export async function channelBaseline(ctx: YtCtx, ch: ChannelStat, opts: { keepUploads?: boolean; maxAgeMs?: number } = {}): Promise<ChannelBaseline> {
  const key = `chmed:${ch.id}`;
  const hit = await cacheGet<ChannelBaseline>(ctx, key);
  if (hit && (!opts.maxAgeMs || Date.now() - Date.parse(hit.fetchedAt) < opts.maxAgeMs) && (!opts.keepUploads || hit.data.uploads)) return hit.data;
  const uploads = await channelUploads(ctx, ch, 30);
  const now = new Date();
  const b: ChannelBaseline = {
    channelId: ch.id,
    title: ch.title,
    subs: ch.subs,
    medianLong: channelMedian(uploads, { kind: "long", now }),
    medianShort: channelMedian(uploads, { kind: "short", now }),
    nLong: uploads.filter((u) => !u.isShort).length,
    nShort: uploads.filter((u) => u.isShort).length,
    at: now.toISOString(),
    ...(opts.keepUploads ? { uploads } : {}),
  };
  await cacheSet(ctx, key, b, 7 * DAY);
  return b;
}

// ----- Outlier finder -------------------------------------------------------------------------------
export type FinderAnswer = FinderResult & { query: string; cached: boolean; at: string; channelsChecked: number };

/**
 * search.list (1 search) → videos.list (1 unit) → channels.list (1 unit) → for each channel that passes the
 * cheap filters, its median (2 units, cached 7 days; at most 15 new channels per search).
 */
export async function findOutliers(ctx: YtCtx, query: string, filters: Partial<FinderFilters> | null, opts: { viewGoal?: number | null; force?: boolean } = {}): Promise<FinderAnswer> {
  const f = withFilterDefaults(filters);
  const q = query.trim();
  if (q.length < 2) throw new YtError("input", "Write a topic to search.");
  const key = `find:${JSON.stringify([q.toLowerCase(), f.min_views, f.max_subs, f.min_outlier, f.min_age_days, f.max_results, f.shorts, f.published_after_days ?? null])}`.slice(0, 400);
  if (!opts.force) {
    const hit = await cacheGet<FinderAnswer>(ctx, key);
    if (hit) return { ...hit.data, cached: true };
  }
  const now = new Date();
  const ids = searchVideoIds(await ytFetch<ApiList<ApiSearchItem>>(ctx, "search", finderSearchParams(q, f, now), { cost: "search" }));
  const videos = await videosStats(ctx, ids);
  const channels = await channelsByIds(ctx, videos.map((v) => v.channelId ?? "").filter(Boolean));
  const subsMap = new Map<string, { subs: number | null; median: number | null }>();
  for (const c of channels) subsMap.set(c.id, { subs: c.subs, median: null });
  // Which channels deserve a median (some of their videos pass views/subs/age/Shorts)?
  const pre = buildCandidates(videos, subsMap).filter((c) => prefilter(c, f, now));
  const need = [...new Set(pre.map((c) => c.channelId!).filter(Boolean))];
  const byId = new Map(channels.map((c) => [c.id, c]));
  const longMap = new Map<string, { subs: number | null; median: number | null }>();
  const shortMap = new Map<string, { subs: number | null; median: number | null }>();
  for (const c of channels) {
    longMap.set(c.id, { subs: c.subs, median: null });
    shortMap.set(c.id, { subs: c.subs, median: null });
  }
  let fresh = 0;
  await Promise.all(
    need.map(async (id) => {
      const ch = byId.get(id);
      if (!ch) return;
      const cached = await cacheGet<ChannelBaseline>(ctx, `chmed:${id}`);
      if (!cached && fresh >= 15) return;
      if (!cached) fresh++;
      try {
        const b = cached?.data ?? (await channelBaseline(ctx, ch));
        longMap.get(id)!.median = b.medianLong;
        shortMap.get(id)!.median = b.medianShort;
      } catch {
        // one channel failing should not stop the search
      }
    }),
  );
  // Long videos are compared with the channel's long median, Shorts with its Shorts median.
  const cands = [...buildCandidates(videos.filter((v) => !v.isShort), longMap), ...buildCandidates(videos.filter((v) => v.isShort), shortMap)];
  const res = applyFinder(cands, f, { now, viewGoal: opts.viewGoal });
  const answer: FinderAnswer = { ...res, query: q, cached: false, at: now.toISOString(), channelsChecked: need.length };
  await cacheSet(ctx, key, answer, DAY);
  return answer;
}

// ----- Comments -------------------------------------------------------------------------------------
export type CommentItem = { id: string; text: string; author: string; likes: number; publishedAt: string; replies: number };
type ApiThread = { id?: string; snippet?: { totalReplyCount?: number; topLevelComment?: { id?: string; snippet?: { textOriginal?: string; textDisplay?: string; authorDisplayName?: string; likeCount?: number; publishedAt?: string } } } };

export function parseThreads(j: ApiList<ApiThread> | null): CommentItem[] {
  return (j?.items ?? []).flatMap((t) => {
    const c = t.snippet?.topLevelComment;
    const s = c?.snippet;
    if (!c?.id && !t.id) return [];
    return [{ id: (c?.id ?? t.id)!, text: (s?.textOriginal ?? s?.textDisplay ?? "").slice(0, 2000), author: s?.authorDisplayName ?? "", likes: s?.likeCount ?? 0, publishedAt: s?.publishedAt ?? "", replies: t.snippet?.totalReplyCount ?? 0 }];
  });
}

/** Top-level comments (newest by relevance) — 1 unit. */
export async function videoComments(ctx: YtCtx, ytId: string, opts: { token?: string | null; max?: number } = {}): Promise<CommentItem[]> {
  const j = await ytFetch<ApiList<ApiThread>>(ctx, "commentThreads", { part: "snippet", videoId: ytId, maxResults: Math.min(100, opts.max ?? 50), order: "relevance", textFormat: "plainText" }, { cost: "commentThreadsList", token: opts.token });
  return parseThreads(j);
}

// ----- Own channel (API key is enough: public numbers) ---------------------------------------------
/** Own channel id from yt_settings (resolving the link once and saving id/title/handle). */
export async function ownChannel(ctx: YtCtx): Promise<ChannelStat | null> {
  const { data } = await ctx.sb.from("yt_settings").select("channel_url,channel_id,channel_title,channel_handle").eq("user_id", ctx.userId).maybeSingle();
  if (!data?.channel_url && !data?.channel_id) return null;
  const ch = await resolveChannel(ctx, (data.channel_id as string | null) ?? (data.channel_url as string));
  if (ch && (ch.id !== data.channel_id || ch.title !== data.channel_title)) {
    await ctx.sb.from("yt_settings").update({ channel_id: ch.id, channel_title: ch.title, channel_handle: ch.handle ?? data.channel_handle }).eq("user_id", ctx.userId);
  }
  return ch;
}

export { BASELINE_LAST_N };
