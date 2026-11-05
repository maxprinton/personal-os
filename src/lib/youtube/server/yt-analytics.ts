// Server only — YouTube Analytics API v2 (needs Google sign-in with yt-analytics.readonly).
// Private numbers of the user's own videos: impressions, CTR, watch time, average view %, subscribers gained,
// retention curve. Data arrives 1–3 days late, so the 48 h check-in uses public views and CTR/retention start
// at 7 days. Separate quota from the Data API (not counted in yt_quota).
import type { RetentionPoint } from "@/lib/youtube/baseline";
import type { VideoMetrics } from "@/lib/youtube/types";
import { YtError, friendlyApiError } from "@/lib/youtube/server/yt-data";

const API = "https://youtubeanalytics.googleapis.com/v2/reports";
export const ANALYTICS_DELAY_NOTE = "YouTube Analytics numbers arrive 1–3 days late.";

type Report = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };

/** Report → one object per row, keyed by column name. */
export function reportRows(r: Report | null | undefined): Record<string, number | string>[] {
  const cols = (r?.columnHeaders ?? []).map((c) => c.name);
  return (r?.rows ?? []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

async function report(token: string, params: Record<string, string>): Promise<Report> {
  const u = new URL(API);
  u.searchParams.set("ids", "channel==MINE");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(u, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new YtError("network", "Could not reach YouTube Analytics.");
  }
  const j = (await res.json().catch(() => null)) as (Report & { error?: { message?: string; errors?: { reason?: string }[] } }) | null;
  if (!res.ok) throw friendlyApiError(res.status, j);
  return j ?? {};
}

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Totals of one video between two dates (YYYY-MM-DD, inclusive). CTR in % (e.g. 5.4). */
export async function videoTotals(token: string, ytId: string, startDate: string, endDate: string): Promise<VideoMetrics> {
  const base = reportRows(
    await report(token, {
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments",
      filters: `video==${ytId}`,
    }),
  )[0];
  const m: VideoMetrics = { at: new Date().toISOString() };
  if (base) {
    m.views = n(base.views);
    m.avg_view_duration_s = n(base.averageViewDuration);
    m.avg_view_pct = n(base.averageViewPercentage);
    m.subs_gained = n(base.subscribersGained);
    m.likes = n(base.likes);
    m.comments = n(base.comments);
  }
  // Impressions + CTR are separate metrics; some channels/dates don't support them → skip quietly.
  try {
    const imp = reportRows(await report(token, { startDate, endDate, metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate", filters: `video==${ytId}` }))[0];
    if (imp) {
      m.impressions = n(imp.videoThumbnailImpressions);
      const ctr = n(imp.videoThumbnailImpressionsClickRate);
      // The API answers a percentage (5.4) on most accounts, a ratio (0.054) on some: normalize to %.
      if (ctr !== undefined) m.ctr = ctr <= 1 && (m.impressions ?? 0) > 0 ? Math.round(ctr * 1000) / 10 : Math.round(ctr * 10) / 10;
    }
  } catch {
    // no impressions for this video/range
  }
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as VideoMetrics;
}

/** Retention curve: t = 0..1 of the video, pct = audienceWatchRatio (1 = everyone still watching). */
export async function retentionCurve(token: string, ytId: string, startDate: string, endDate: string): Promise<RetentionPoint[]> {
  const rows = reportRows(await report(token, { startDate, endDate, dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio", filters: `video==${ytId}`, sort: "elapsedVideoTimeRatio" }));
  return rows.map((r) => ({ t: n(r.elapsedVideoTimeRatio) ?? 0, pct: n(r.audienceWatchRatio) ?? 0 })).filter((p) => p.t > 0);
}

/** Views per day (for equal before/after windows and for seeding the channel baseline). */
export async function dailyViews(token: string, ytId: string, startDate: string, endDate: string): Promise<{ day: string; views: number; impressions?: number; ctr?: number }[]> {
  const rows = reportRows(await report(token, { startDate, endDate, dimensions: "day", metrics: "views", filters: `video==${ytId}`, sort: "day" }));
  return rows.map((r) => ({ day: String(r.day), views: n(r.views) ?? 0 }));
}

/** Views of each video in its first N days (day granularity). Used to seed "the usual" for old videos. */
export async function firstDaysViews(token: string, ytId: string, publishedAt: string, days: number): Promise<number | null> {
  const start = publishedAt.slice(0, 10);
  const endT = Date.parse(`${start}T00:00:00Z`) + (days - 1) * 86_400_000;
  if (endT > Date.now() - 2 * 86_400_000) return null; // not complete yet (Analytics delay)
  const end = new Date(endT).toISOString().slice(0, 10);
  const r = reportRows(await report(token, { startDate: start, endDate: end, metrics: "views", filters: `video==${ytId}` }))[0];
  return r ? n(r.views) ?? null : 0;
}

export const isoDay = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);
