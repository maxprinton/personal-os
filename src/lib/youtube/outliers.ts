// YouTube add-on (Worker C) — pure logic of the outlier finder and the watchlist.
// Parses YouTube Data API v3 JSON (search.list, videos.list, channels.list, playlistItems.list) into small
// objects, computes channel medians and outlier scores (views ÷ the channel's usual views) and applies the
// finder filters. No network here: the server code (src/lib/youtube/server/yt-data.ts) fetches, this decides.
import { FINDER_DEFAULTS, WATCH_OUTLIER_MIN, YT_LIMITS } from "@/lib/youtube/constants";
import type { FinderFilters } from "@/lib/youtube/types";

// ----- API shapes (only the fields we read) ---------------------------------------------------------
type Thumbs = Partial<Record<"default" | "medium" | "high" | "standard" | "maxres", { url?: string; width?: number; height?: number }>>;
export type ApiSearchItem = { id?: { kind?: string; videoId?: string; channelId?: string }; snippet?: { publishedAt?: string; channelId?: string; title?: string; channelTitle?: string; thumbnails?: Thumbs; description?: string } };
export type ApiVideoItem = {
  id?: string;
  snippet?: { publishedAt?: string; channelId?: string; title?: string; channelTitle?: string; thumbnails?: Thumbs; tags?: string[]; categoryId?: string; description?: string; liveBroadcastContent?: string };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: string; publishAt?: string; uploadStatus?: string };
};
export type ApiChannelItem = {
  id?: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: Thumbs; publishedAt?: string };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string; viewCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};
export type ApiPlaylistItem = { snippet?: { publishedAt?: string; title?: string; resourceId?: { videoId?: string } }; contentDetails?: { videoId?: string; videoPublishedAt?: string } };
export type ApiList<T> = { items?: T[]; nextPageToken?: string; pageInfo?: { totalResults?: number } };

// ----- Our small objects ----------------------------------------------------------------------------
export type VideoStat = {
  id: string;
  title: string;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  thumbnail: string | null;
  durationS: number | null;
  isShort: boolean;
  views: number | null;
  likes: number | null;
  comments: number | null;
};
export type ChannelStat = {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  subs: number | null;
  /** hidden subscriber count → null subs */
  hiddenSubs: boolean;
  videoCount: number | null;
  uploadsPlaylist: string | null;
};
export type OutlierCandidate = VideoStat & {
  channelSubs: number | null;
  channelMedian: number | null;
  outlierScore: number | null;
  url: string;
};

const num = (s: string | number | undefined | null) => {
  if (s === undefined || s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "PT1H2M3S" → 3723 · "P1DT2H" → 93600 · bad → null */
export function parseIsoDuration(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso.trim());
  if (!m || iso === "P" || iso === "PT") return null;
  const [, d, h, mi, s] = m;
  return Math.round(Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0));
}

/** Shorts are vertical videos up to 3 minutes; the API has no flag, so duration decides (≤ 180 s). */
export function isShortDuration(durationS: number | null) {
  return durationS !== null && durationS > 0 && durationS <= YT_LIMITS.shortMaxSeconds;
}

export function bestThumb(t: Thumbs | undefined) {
  return t?.high?.url ?? t?.medium?.url ?? t?.standard?.url ?? t?.default?.url ?? t?.maxres?.url ?? null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const shortUrl = (id: string) => `https://youtu.be/${id}`;

/** videos.list items → VideoStat (items without id are skipped). */
export function parseVideos(json: ApiList<ApiVideoItem> | null | undefined): VideoStat[] {
  return (json?.items ?? []).flatMap((v) => {
    if (!v.id) return [];
    const durationS = parseIsoDuration(v.contentDetails?.duration);
    return [
      {
        id: v.id,
        title: v.snippet?.title ?? "",
        channelId: v.snippet?.channelId ?? null,
        channelTitle: v.snippet?.channelTitle ?? null,
        publishedAt: v.snippet?.publishedAt ?? null,
        thumbnail: bestThumb(v.snippet?.thumbnails),
        durationS,
        isShort: isShortDuration(durationS),
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
      },
    ];
  });
}

export function parseChannels(json: ApiList<ApiChannelItem> | null | undefined): ChannelStat[] {
  return (json?.items ?? []).flatMap((c) => {
    if (!c.id) return [];
    const hidden = !!c.statistics?.hiddenSubscriberCount;
    const handle = c.snippet?.customUrl ? (c.snippet.customUrl.startsWith("@") ? c.snippet.customUrl : `@${c.snippet.customUrl}`) : null;
    return [
      {
        id: c.id,
        title: c.snippet?.title ?? "",
        handle,
        thumbnail: bestThumb(c.snippet?.thumbnails),
        subs: hidden ? null : num(c.statistics?.subscriberCount),
        hiddenSubs: hidden,
        videoCount: num(c.statistics?.videoCount),
        uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads ?? (c.id.startsWith("UC") ? `UU${c.id.slice(2)}` : null),
      },
    ];
  });
}

/** search.list → video ids (in order, no repeats, only videos). */
export function searchVideoIds(json: ApiList<ApiSearchItem> | null | undefined): string[] {
  const out: string[] = [];
  for (const it of json?.items ?? []) {
    const id = it.id?.videoId;
    if (id && (it.id?.kind ?? "youtube#video") === "youtube#video" && !out.includes(id)) out.push(id);
  }
  return out;
}

/** search.list type=channel → channel ids. */
export function searchChannelIds(json: ApiList<ApiSearchItem> | null | undefined): string[] {
  return [...new Set((json?.items ?? []).map((i) => i.id?.channelId ?? i.snippet?.channelId).filter((x): x is string => !!x))];
}

export function playlistVideoIds(json: ApiList<ApiPlaylistItem> | null | undefined): string[] {
  return [...new Set((json?.items ?? []).map((i) => i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId).filter((x): x is string => !!x))];
}

/** Median of the numbers (null when empty). */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function ageDays(publishedAt: string | null, now: Date) {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : null;
}

/**
 * The channel's usual views: median of its recent uploads of the SAME kind (long vs Shorts), leaving out
 * videos younger than `minAgeDays` (they are still growing) — but if that leaves fewer than 3, all are used.
 */
export function channelMedian(uploads: VideoStat[], opts: { kind: "long" | "short"; now: Date; minAgeDays?: number; lastN?: number }): number | null {
  const same = uploads.filter((u) => (opts.kind === "short" ? u.isShort : !u.isShort) && u.views !== null);
  const sorted = [...same].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
  const mature = sorted.filter((u) => (ageDays(u.publishedAt, opts.now) ?? 0) >= (opts.minAgeDays ?? 7));
  const pool = (mature.length >= 3 ? mature : sorted).slice(0, opts.lastN ?? 30);
  return median(pool.map((u) => u.views));
}

/** views ÷ median, rounded to 0.1 (null when unknown or the median is 0). */
export function outlierScore(views: number | null, med: number | null): number | null {
  if (views === null || med === null || med <= 0) return null;
  return Math.round((views / med) * 10) / 10;
}

export function withFilterDefaults(f: Partial<FinderFilters> | null | undefined): FinderFilters {
  return { ...FINDER_DEFAULTS, shorts: "exclude", ...(f ?? {}) };
}

export type FilterReason = "views" | "subs" | "outlier" | "age" | "shorts" | "unknown";

/** Why a candidate is left out (null = it passes). Unknown subs (hidden) pass the subs rule. */
export function rejectReason(c: OutlierCandidate, f: FinderFilters, now: Date): FilterReason | null {
  const shorts = f.shorts ?? "exclude";
  if (shorts === "exclude" && c.isShort) return "shorts";
  if (shorts === "only" && !c.isShort) return "shorts";
  if (c.views === null) return "unknown";
  if (c.views < f.min_views) return "views";
  if (c.channelSubs !== null && c.channelSubs >= f.max_subs) return "subs";
  const age = ageDays(c.publishedAt, now);
  if (age === null || age < f.min_age_days) return "age";
  if (f.published_after_days && age > f.published_after_days) return "age";
  if (c.outlierScore === null || c.outlierScore < f.min_outlier) return "outlier";
  return null;
}

/** Cheap pre-filter before spending quota on channel medians: views, subs, age, Shorts. */
export function prefilter(c: OutlierCandidate, f: FinderFilters, now: Date) {
  const r = rejectReason({ ...c, outlierScore: Number.POSITIVE_INFINITY }, f, now);
  return r === null;
}

/** Joins videos with their channel (subs + median) into candidates. */
export function buildCandidates(videos: VideoStat[], channels: Map<string, { subs: number | null; median: number | null }>): OutlierCandidate[] {
  return videos.map((v) => {
    const ch = v.channelId ? channels.get(v.channelId) : undefined;
    const med = ch?.median ?? null;
    return { ...v, channelSubs: ch?.subs ?? null, channelMedian: med, outlierScore: outlierScore(v.views, med), url: v.isShort ? `https://www.youtube.com/shorts/${v.id}` : watchUrl(v.id) };
  });
}

export type FinderResult = {
  outliers: OutlierCandidate[];
  /** how many of the topic's videos passed each rule / were left out by it */
  rejected: Partial<Record<FilterReason, number>>;
  /** videos of the topic at or above the channel's view goal (null when no goal) */
  aboveGoal: number | null;
  checked: number;
};

/** Applies the filters, sorts by outlier score (then views) and cuts to max_results. */
export function applyFinder(cands: OutlierCandidate[], filters: Partial<FinderFilters> | null | undefined, opts: { now: Date; viewGoal?: number | null }): FinderResult {
  const f = withFilterDefaults(filters);
  const rejected: Partial<Record<FilterReason, number>> = {};
  const outliers: OutlierCandidate[] = [];
  for (const c of cands) {
    const r = rejectReason(c, f, opts.now);
    if (r) rejected[r] = (rejected[r] ?? 0) + 1;
    else outliers.push(c);
  }
  outliers.sort((a, b) => (b.outlierScore ?? 0) - (a.outlierScore ?? 0) || (b.views ?? 0) - (a.views ?? 0));
  const goal = opts.viewGoal ?? null;
  return {
    outliers: outliers.slice(0, f.max_results),
    rejected,
    aboveGoal: goal && goal > 0 ? cands.filter((c) => (c.views ?? 0) >= goal).length : null,
    checked: cands.length,
  };
}

/** search.list parameters for the finder (publishedBefore = older than min_age_days). */
export function finderSearchParams(query: string, filters: Partial<FinderFilters> | null | undefined, now: Date): Record<string, string> {
  const f = withFilterDefaults(filters);
  const before = new Date(now.getTime() - f.min_age_days * 86_400_000);
  const p: Record<string, string> = {
    part: "snippet",
    type: "video",
    q: query.trim().slice(0, 200),
    maxResults: "50",
    order: "relevance",
    publishedBefore: before.toISOString().replace(/\.\d{3}Z$/, "Z"),
    safeSearch: "none",
  };
  if (f.published_after_days) p.publishedAfter = new Date(now.getTime() - f.published_after_days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  if (f.shorts === "only") p.videoDuration = "short";
  return p;
}

/** Watchlist: uploads of a watched channel that are outliers (≥ 3× its median) and newer than `since`. */
export function watchOutliers(uploads: VideoStat[], med: number | null, opts: { since: string | null; now: Date; min?: number }): (VideoStat & { outlierScore: number })[] {
  const min = opts.min ?? WATCH_OUTLIER_MIN;
  const since = opts.since ? Date.parse(opts.since) : opts.now.getTime() - 30 * 86_400_000;
  return uploads
    .filter((u) => Date.parse(u.publishedAt ?? "") >= since - 14 * 86_400_000) // late bloomers: two weeks before the last check too
    .map((u) => ({ ...u, outlierScore: outlierScore(u.views, med) ?? 0 }))
    .filter((u) => u.outlierScore >= min)
    .sort((a, b) => b.outlierScore - a.outlierScore);
}

/** 1234 → "1.2K", 2_500_000 → "2.5M". */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const f = (x: number, s: string) => `${(Math.round(x * 10) / 10).toString().replace(/\.0$/, "")}${s}`;
  // 999,950 rounds to "1M", not "1000K"
  if (a >= 999_950_000) return f(n / 1e9, "B");
  if (a >= 999_950) return f(n / 1e6, "M");
  if (a >= 999.5) return f(n / 1e3, "K");
  return String(Math.round(n));
}

/** Seconds → "m:ss" or "h:mm:ss". */
export function formatDuration(s: number | null | undefined) {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A video id from a link or the bare id (watch?v=, youtu.be/, /shorts/, /live/, /embed/). */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) return /^[\w-]{11}$/.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = /^\/(?:shorts|live|embed|v)\/([\w-]{11})/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ----- Rows for the database (pure, so they are tested) ---------------------------------------------
/** A finder/watchlist pick → the yt_references row (video_id null = loose reference). */
export function referenceRow(c: Pick<OutlierCandidate, "id" | "title" | "channelId" | "channelTitle" | "channelSubs" | "views" | "channelMedian" | "outlierScore" | "publishedAt" | "thumbnail" | "durationS" | "isShort"> & { url?: string }, videoId: string | null, source: "finder" | "watchlist" | "manual") {
  return {
    video_id: videoId,
    yt_id: c.id,
    url: c.url ?? (c.isShort ? `https://www.youtube.com/shorts/${c.id}` : watchUrl(c.id)),
    title: (c.title || c.id).slice(0, 300),
    channel_id: c.channelId,
    channel_title: c.channelTitle,
    channel_subs: c.channelSubs,
    views: c.views,
    channel_median: c.channelMedian === null ? null : Math.round(c.channelMedian),
    outlier_score: c.outlierScore,
    published_at: c.publishedAt,
    thumbnail_url: c.thumbnail ?? `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
    duration_s: c.durationS,
    is_short: c.isShort,
    source,
  };
}

/** A watched channel is checked again after `days` (never checked = due). */
export function watchChannelDue(lastCheckedAt: string | null | undefined, now: Date, days: number) {
  if (!lastCheckedAt) return true;
  const t = Date.parse(lastCheckedAt);
  return !Number.isFinite(t) || now.getTime() - t >= days * 86_400_000 - 30 * 60_000; // 30 min slack for the 5-min cron
}

/** Watchlist uploads → yt_watch_outliers rows (status "new"). Long and Shorts are compared with their own median. */
export function watchOutlierRows(
  uploads: VideoStat[],
  medians: { long: number | null; short: number | null },
  opts: { since: string | null; now: Date; channelRowId: string; userId: string; known?: Set<string>; min?: number },
) {
  const pick = (kind: "long" | "short") =>
    watchOutliers(uploads.filter((u) => (kind === "short" ? u.isShort : !u.isShort)), kind === "short" ? medians.short : medians.long, opts).map((u) => ({
      user_id: opts.userId,
      channel_row_id: opts.channelRowId,
      yt_id: u.id,
      title: (u.title || u.id).slice(0, 300),
      url: u.isShort ? `https://www.youtube.com/shorts/${u.id}` : watchUrl(u.id),
      thumbnail_url: u.thumbnail,
      views: u.views,
      channel_median: (kind === "short" ? medians.short : medians.long) === null ? null : Math.round((kind === "short" ? medians.short : medians.long)!),
      outlier_score: u.outlierScore,
      published_at: u.publishedAt,
      status: "new" as const,
    }));
  return [...pick("long"), ...pick("short")].filter((r) => !opts.known?.has(r.yt_id)).sort((a, b) => (b.outlier_score ?? 0) - (a.outlier_score ?? 0));
}
