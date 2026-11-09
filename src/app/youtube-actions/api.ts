"use server";
// YouTube add-on (Worker C) — actions that talk to the YouTube Data API or Google sign-in:
// outlier finder (Topic step), the user's channel baseline, watched channels + outlier inbox, quota and the
// Google connection. Writes go through the user's client (RLS "own rows"); yt_oauth only via the admin client.
import { revalidatePath } from "next/cache";
import { MIGRATION_FILE, videoHref } from "@/lib/youtube/constants";
import { isMissingTable, withSettingsDefaults, ytServer } from "@/lib/youtube/db";
import { ensureTopic } from "@/lib/youtube/server/topics";
import { referenceRow, withFilterDefaults, type OutlierCandidate } from "@/lib/youtube/outliers";
import { checkDueWatchChannels, addWatchChannel as addWatch, type WatchCheck } from "@/lib/youtube/server/watchlist";
import {
  channelBaseline, findOutliers, hasApiKey, NO_KEY_MESSAGE, ownChannel, quotaToday, resolveChannel, YtError,
  type ChannelBaseline, type FinderAnswer, type QuotaUse, type YtCtx,
} from "@/lib/youtube/server/yt-data";
import { disconnect, getAccessToken, oauthConfigured } from "@/lib/youtube/server/yt-oauth";
import type { FinderFilters, YtSettings, YtWatchOutlier } from "@/lib/youtube/types";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
type PgErr = { code?: string; message?: string } | null | undefined;
const dbFail = (e: PgErr, fallback = "Something went wrong. Try again.") => (isMissingTable(e) ? MISSING : e?.message || fallback);
const errText = (e: unknown) => (e instanceof YtError ? e.message : isMissingTable(e as PgErr) ? MISSING : e instanceof Error ? e.message : "Something went wrong. Try again.");

async function ctx(): Promise<YtCtx | null> {
  const { supabase, userId } = await ytServer();
  return userId ? { sb: supabase, userId } : null;
}
const SIGNED_OUT = { error: "Sign in again." };

async function settingsOf(c: YtCtx): Promise<YtSettings> {
  const { data } = await c.sb.from("yt_settings").select("*").eq("user_id", c.userId).maybeSingle();
  return withSettingsDefaults(c.userId, data as Partial<YtSettings> | null);
}

// ----- Outlier finder (Topic step) ------------------------------------------------------------------
export type FinderSetup = { apiKey: boolean; filters: FinderFilters; viewGoal: number | null; channelUrl: string | null; quota: QuotaUse | null };

/** What the finder needs before searching (no API call). */
export async function finderSetup(): Promise<FinderSetup & { error?: string }> {
  const c = await ctx();
  const s = c ? await settingsOf(c) : null;
  const quota = c ? await quotaToday(c).catch(() => null) : null;
  return { apiKey: hasApiKey(), filters: withFilterDefaults(s?.finder_filters), viewGoal: s?.view_goal ?? null, channelUrl: s?.channel_url ?? null, quota, ...(c ? {} : SIGNED_OUT) };
}

/** Search a topic (1 of the 100 daily searches unless cached for 24 h). */
export async function runFinder(query: string, filters?: Partial<FinderFilters> | null, force = false): Promise<{ answer?: FinderAnswer; error?: string; noKey?: boolean; quota?: QuotaUse | null }> {
  if (!hasApiKey()) return { error: NO_KEY_MESSAGE, noKey: true };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const s = await settingsOf(c);
    const answer = await findOutliers(c, query, { ...s.finder_filters, ...(filters ?? {}) }, { viewGoal: s.view_goal, force });
    return { answer, quota: await quotaToday(c).catch(() => null) };
  } catch (e) {
    return { error: errText(e), quota: await quotaToday(c).catch(() => null) };
  }
}

/** Saves the finder filters as the default (yt_settings.finder_filters). */
export async function saveFinderFilters(filters: Partial<FinderFilters>): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const f = withFilterDefaults(filters);
  const clean: FinderFilters = {
    min_views: Math.max(0, Math.round(Number(f.min_views) || 0)),
    max_subs: Math.max(1, Math.round(Number(f.max_subs) || 1)),
    min_outlier: Math.max(0, Number(f.min_outlier) || 0),
    min_age_days: Math.max(0, Math.round(Number(f.min_age_days) || 0)),
    max_results: Math.min(50, Math.max(1, Math.round(Number(f.max_results) || 25))),
    shorts: f.shorts === "include" || f.shorts === "only" ? f.shorts : "exclude",
    published_after_days: f.published_after_days ? Math.max(1, Math.round(Number(f.published_after_days))) : null,
  };
  const { error } = await c.sb.from("yt_settings").upsert({ user_id: c.userId, finder_filters: clean }, { onConflict: "user_id" });
  if (error) return { error: dbFail(error) };
  revalidatePath("/youtube/settings");
  return { ok: true };
}

/** The user's own channel and its usual views (from yt_settings.channel_url; cached 7 days). */
export async function myChannelBaseline(force = false): Promise<{ baseline?: Omit<ChannelBaseline, "uploads"> & { handle: string | null }; error?: string; noKey?: boolean; noChannel?: boolean }> {
  if (!hasApiKey()) return { error: NO_KEY_MESSAGE, noKey: true };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const ch = await ownChannel(c);
    if (!ch) return { noChannel: true, error: "Add your channel link in YouTube → Settings to compare with your usual views." };
    const b = await channelBaseline(c, ch, force ? { maxAgeMs: 1 } : {});
    const { uploads: _u, ...rest } = b;
    void _u;
    return { baseline: { ...rest, handle: ch.handle } };
  } catch (e) {
    return { error: errText(e) };
  }
}

function refreshVideo(videoId: string | null) {
  revalidatePath("/youtube", "layout");
  if (videoId) revalidatePath(videoHref(videoId), "layout");
}

/**
 * Insert or update a reference of a video. (The unique index on video_id+yt_id is partial, which PostgREST
 * upsert can't target, so: look, then update or insert.)
 */
async function putReference(c: YtCtx, row: ReturnType<typeof referenceRow>): Promise<PgErr> {
  if (row.video_id) {
    const { data: prev } = await c.sb.from("yt_references").select("id").eq("user_id", c.userId).eq("video_id", row.video_id).eq("yt_id", row.yt_id).maybeSingle();
    if (prev) {
      const { video_id: _v, yt_id: _y, source: _s, ...nums } = row;
      void _v, void _y, void _s;
      return (await c.sb.from("yt_references").update(nums).eq("id", prev.id)).error;
    }
  }
  return (await c.sb.from("yt_references").insert({ user_id: c.userId, ...row })).error;
}

/** Saves a finder pick as a reference of the video (source "finder"). Saving twice just updates the numbers. */
export async function saveFinderReference(videoId: string, cand: OutlierCandidate): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!cand?.id || !/^[\w-]{11}$/.test(cand.id)) return { error: "That is not a YouTube video." };
  const { data: v, error: ve } = await c.sb.from("yt_videos").select("id").eq("id", videoId).maybeSingle();
  if (ve || !v) return { error: ve ? dbFail(ve) : "Video not found." };
  const error = await putReference(c, referenceRow(cand, videoId, "finder"));
  if (error) return { error: dbFail(error) };
  refreshVideo(videoId);
  return { ok: true };
}

/** Removes a finder pick from the video's references. */
export async function unsaveFinderReference(videoId: string, ytId: string): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { error } = await c.sb.from("yt_references").delete().eq("user_id", c.userId).eq("video_id", videoId).eq("yt_id", ytId);
  if (error) return { error: dbFail(error) };
  refreshVideo(videoId);
  return { ok: true };
}

// ----- Watchlist ------------------------------------------------------------------------------------
export async function addWatchChannel(input: string): Promise<{ ok?: boolean; error?: string; info?: string }> {
  if (!hasApiKey()) return { error: NO_KEY_MESSAGE };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!input.trim()) return { error: "Paste a channel link or @handle." };
  try {
    const { row, isNew } = await addWatch(c, input);
    const [res] = await checkDueWatchChannels(c, { onlyId: row.id });
    revalidatePath("/youtube/watchlist");
    const found = res?.found ? ` ${res.found} outlier${res.found === 1 ? "" : "s"} found.` : "";
    return { ok: true, info: `${isNew ? "Added" : "Already watched —  updated"} ${row.title}.${found}${res?.error ? ` (check failed: ${res.error})` : ""}` };
  } catch (e) {
    return { error: errText(e) };
  }
}

export async function setWatchChannelActive(id: string, active: boolean): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { error } = await c.sb.from("yt_watch_channels").update({ active }).eq("user_id", c.userId).eq("id", id);
  if (error) return { error: dbFail(error) };
  revalidatePath("/youtube/watchlist");
  return { ok: true };
}

export async function removeWatchChannel(id: string): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  // Keep the inbox items the user saved or turned into ideas; drop the untouched ones.
  await c.sb.from("yt_watch_outliers").delete().eq("user_id", c.userId).eq("channel_row_id", id).in("status", ["new", "dismissed"]);
  const { error } = await c.sb.from("yt_watch_channels").delete().eq("user_id", c.userId).eq("id", id);
  if (error) return { error: dbFail(error) };
  revalidatePath("/youtube/watchlist");
  return { ok: true };
}

export async function saveWatchNote(id: string, notes: string): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { error } = await c.sb.from("yt_watch_channels").update({ notes: notes.trim().slice(0, 1000) || null }).eq("user_id", c.userId).eq("id", id);
  return error ? { error: dbFail(error) } : { ok: true };
}

/** "Check now": one channel (id) or every active channel (force). Costs ≈ 3 units per channel. */
export async function checkWatchNow(id?: string | null): Promise<{ ok?: boolean; error?: string; info?: string; results?: WatchCheck[] }> {
  if (!hasApiKey()) return { error: NO_KEY_MESSAGE };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const results = await checkDueWatchChannels(c, id ? { onlyId: id } : { force: true, deadline: Date.now() + 50_000 });
    revalidatePath("/youtube/watchlist");
    const found = results.reduce((n, r) => n + r.found, 0);
    const failed = results.filter((r) => r.error);
    return {
      ok: true,
      results,
      info: `${results.length} channel${results.length === 1 ? "" : "s"} checked · ${found} new outlier${found === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} failed (${failed[0].error})` : ""}.`,
    };
  } catch (e) {
    return { error: errText(e) };
  }
}

async function outlierOf(c: YtCtx, id: string) {
  const { data, error } = await c.sb.from("yt_watch_outliers").select("*").eq("user_id", c.userId).eq("id", id).maybeSingle();
  if (error || !data) return { error: error ? dbFail(error) : "Not found." } as const;
  const { data: ch } = data.channel_row_id
    ? await c.sb.from("yt_watch_channels").select("channel_id,title,subs").eq("id", data.channel_row_id).maybeSingle()
    : { data: null };
  return { o: data as YtWatchOutlier, ch: ch as { channel_id: string; title: string; subs: number | null } | null } as const;
}

function watchRef(o: YtWatchOutlier, ch: { channel_id: string; title: string; subs: number | null } | null, videoId: string | null) {
  return referenceRow(
    {
      id: o.yt_id,
      url: o.url ?? undefined,
      title: o.title,
      channelId: ch?.channel_id ?? null,
      channelTitle: ch?.title ?? null,
      channelSubs: ch?.subs ?? null,
      views: o.views,
      channelMedian: o.channel_median,
      outlierScore: o.outlier_score,
      publishedAt: o.published_at,
      thumbnail: o.thumbnail_url,
      durationS: null,
      isShort: (o.url ?? "").includes("/shorts/"),
    },
    videoId,
    "watchlist",
  );
}

/** Inbox → reference. videoId null = loose reference (shows up in the Lab / can be attached later). */
export async function saveWatchOutlier(id: string, videoId: string | null): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const r = await outlierOf(c, id);
  if ("error" in r) return { error: r.error };
  const error = await putReference(c, watchRef(r.o, r.ch, videoId));
  if (error) return { error: dbFail(error) };
  await c.sb.from("yt_watch_outliers").update({ status: "saved", video_id: videoId }).eq("user_id", c.userId).eq("id", id);
  revalidatePath("/youtube/watchlist");
  refreshVideo(videoId);
  return { ok: true };
}

/** Inbox → new idea in the bank (source "watchlist"), with the outlier as its first reference. */
export async function watchOutlierToIdea(id: string): Promise<{ ok?: boolean; error?: string; videoId?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const r = await outlierOf(c, id);
  if ("error" in r) return { error: r.error };
  const tp = await ensureTopic(c.sb, c.userId, r.o.title);
  const { data: v, error } = await c.sb
    .from("yt_videos")
    .insert({ user_id: c.userId, idea_name: r.o.title.slice(0, 200), topic: r.o.title.slice(0, 200), topic_id: "error" in tp ? null : tp.id, stage: "bank", source: "watchlist", source_quote: r.o.url })
    .select("id")
    .single();
  if (error || !v) return { error: dbFail(error, "Could not create the idea.") };
  await putReference(c, watchRef(r.o, r.ch, v.id as string));
  await c.sb.from("yt_watch_outliers").update({ status: "idea", video_id: v.id }).eq("user_id", c.userId).eq("id", id);
  revalidatePath("/youtube/watchlist");
  refreshVideo(v.id as string);
  return { ok: true, videoId: v.id as string };
}

export async function setWatchOutlierStatus(id: string, status: "new" | "dismissed"): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { error } = await c.sb.from("yt_watch_outliers").update({ status }).eq("user_id", c.userId).eq("id", id);
  if (error) return { error: dbFail(error) };
  revalidatePath("/youtube/watchlist");
  return { ok: true };
}

/** Videos the user can attach a reference to (not archived/published), for the inbox's "Save to…" menu. */
export async function referenceTargets(): Promise<{ items: { id: string; label: string }[] }> {
  const c = await ctx();
  if (!c) return { items: [] };
  const { data } = await c.sb.from("yt_videos").select("id,code,idea_name,stage").eq("user_id", c.userId).not("stage", "in", "(archived,published)").order("stage_changed_at", { ascending: false }).limit(60);
  return { items: (data ?? []).map((v) => ({ id: v.id as string, label: `${v.code ? `${v.code} · ` : ""}${v.idea_name as string}` })) };
}

// ----- Channel lookup (settings helper) -------------------------------------------------------------
/** Resolves the channel link in settings and stores id/title/handle (1 unit, cached 7 days). */
export async function resolveMyChannel(): Promise<{ ok?: boolean; error?: string; title?: string }> {
  if (!hasApiKey()) return { error: NO_KEY_MESSAGE };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const ch = await ownChannel(c);
    if (!ch) return { error: "Add your channel link first (youtube.com/@name)." };
    revalidatePath("/youtube", "layout");
    return { ok: true, title: ch.title };
  } catch (e) {
    return { error: errText(e) };
  }
}

/** Test any channel input without saving (used by the watchlist form preview). */
export async function lookupChannel(input: string): Promise<{ title?: string; subs?: number | null; handle?: string | null; error?: string }> {
  if (!hasApiKey()) return { error: NO_KEY_MESSAGE };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const ch = await resolveChannel(c, input);
    return ch ? { title: ch.title, subs: ch.subs, handle: ch.handle } : { error: "Channel not found." };
  } catch (e) {
    return { error: errText(e) };
  }
}

// ----- Quota and Google connection ------------------------------------------------------------------
export async function quotaStatus(): Promise<{ quota: QuotaUse | null }> {
  const c = await ctx();
  return { quota: c ? await quotaToday(c).catch(() => null) : null };
}

/** Tests the connection now (refreshes the access token). */
export async function testGoogle(): Promise<{ ok?: boolean; error?: string; reconnect?: boolean }> {
  if (!oauthConfigured()) return { error: "Google sign-in is not set up yet (ACTIVAR-GOOGLE-OAUTH.md)." };
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const r = await getAccessToken(c.userId);
    revalidatePath("/youtube/settings");
    return r.token !== null ? { ok: true } : { error: r.error, reconnect: r.reconnect };
  } catch (e) {
    return { error: errText(e) };
  }
}

export async function disconnectGoogle(): Promise<{ ok?: boolean; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    await disconnect(c.userId);
    revalidatePath("/youtube", "layout");
    return { ok: true };
  } catch (e) {
    return { error: errText(e) };
  }
}
