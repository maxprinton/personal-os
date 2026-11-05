// Server only — watched channels (/youtube/watchlist): add a channel, and the weekly check that finds new
// outliers among its latest uploads (≥ 3× its usual views) and drops them in the yt_watch_outliers inbox.
// Works with the user's client (page actions) or the admin client (cron, round 3): every query filters by user_id.
import { WATCH_CHECK_DAYS } from "@/lib/youtube/constants";
import { watchChannelDue, watchOutlierRows } from "@/lib/youtube/outliers";
import { channelBaseline, channelsByIds, resolveChannel, YtError, type YtCtx } from "@/lib/youtube/server/yt-data";
import type { YtWatchChannel } from "@/lib/youtube/types";

/** Resolves a link/@handle and adds (or re-activates) the channel. Costs 1 unit (+2 for its median). */
export async function addWatchChannel(ctx: YtCtx, input: string): Promise<{ row: YtWatchChannel; isNew: boolean }> {
  const ch = await resolveChannel(ctx, input);
  if (!ch) throw new YtError("not_found", "Could not find that channel. Paste its link (youtube.com/@name) or @handle.");
  const { data: prev } = await ctx.sb.from("yt_watch_channels").select("id").eq("user_id", ctx.userId).eq("channel_id", ch.id).maybeSingle();
  const row = {
    user_id: ctx.userId,
    channel_id: ch.id,
    handle: ch.handle,
    title: ch.title || ch.handle || ch.id,
    url: ch.handle ? `https://www.youtube.com/${ch.handle}` : `https://www.youtube.com/channel/${ch.id}`,
    thumbnail_url: ch.thumbnail,
    subs: ch.subs,
    active: true,
  };
  const { data, error } = await ctx.sb.from("yt_watch_channels").upsert(row, { onConflict: "user_id,channel_id" }).select("*").single();
  if (error || !data) throw new YtError("db", error?.message ?? "Could not save the channel.");
  return { row: data as YtWatchChannel, isNew: !prev };
}

export type WatchCheck = { channelRowId: string; title: string; found: number; error?: string };

/**
 * Checks one watched channel: fresh stats + latest 30 uploads (≈ 3 units), its usual views (long and Shorts
 * apart), and inserts the new outliers. Outliers already in the inbox (any status) are never added twice.
 */
export async function checkWatchChannel(ctx: YtCtx, row: YtWatchChannel, now = new Date()): Promise<WatchCheck> {
  try {
    const ch = (await channelsByIds(ctx, [row.channel_id]))[0];
    if (!ch) throw new YtError("not_found", "YouTube could not find this channel anymore.");
    const base = await channelBaseline(ctx, ch, { keepUploads: true, maxAgeMs: 12 * 3600_000 });
    const uploads = base.uploads ?? [];
    const { data: known } = await ctx.sb.from("yt_watch_outliers").select("yt_id").eq("user_id", ctx.userId).in("yt_id", uploads.map((u) => u.id).concat("-"));
    const rows = watchOutlierRows(uploads, { long: base.medianLong, short: base.medianShort }, {
      since: row.last_checked_at,
      now,
      channelRowId: row.id,
      userId: ctx.userId,
      known: new Set((known ?? []).map((k) => k.yt_id as string)),
    });
    if (rows.length) {
      const { error } = await ctx.sb.from("yt_watch_outliers").upsert(rows, { onConflict: "user_id,yt_id", ignoreDuplicates: true });
      if (error) throw new YtError("db", error.message);
    }
    const lastUpload = uploads.map((u) => u.publishedAt).filter((x): x is string => !!x).sort().pop() ?? row.last_upload_at;
    await ctx.sb
      .from("yt_watch_channels")
      .update({ title: ch.title || row.title, handle: ch.handle ?? row.handle, thumbnail_url: ch.thumbnail ?? row.thumbnail_url, subs: ch.subs, median_views: base.medianLong === null ? null : Math.round(base.medianLong), last_checked_at: now.toISOString(), last_upload_at: lastUpload })
      .eq("user_id", ctx.userId)
      .eq("id", row.id);
    return { channelRowId: row.id, title: ch.title || row.title, found: rows.length };
  } catch (e) {
    return { channelRowId: row.id, title: row.title, found: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The weekly check (also used by the cron in round 3): every active channel not checked in the last
 * WATCH_CHECK_DAYS days (or all of them with `force`). Stops early when `deadline` (ms timestamp) passes.
 */
export async function checkDueWatchChannels(ctx: YtCtx, opts: { force?: boolean; onlyId?: string; deadline?: number; now?: Date } = {}): Promise<WatchCheck[]> {
  const now = opts.now ?? new Date();
  let q = ctx.sb.from("yt_watch_channels").select("*").eq("user_id", ctx.userId).eq("active", true);
  if (opts.onlyId) q = q.eq("id", opts.onlyId);
  const { data, error } = await q.order("last_checked_at", { ascending: true, nullsFirst: true });
  if (error) throw new YtError("db", error.message);
  const due = ((data ?? []) as YtWatchChannel[]).filter((r) => opts.force || opts.onlyId || watchChannelDue(r.last_checked_at, now, WATCH_CHECK_DAYS));
  const out: WatchCheck[] = [];
  for (const r of due) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const res = await checkWatchChannel(ctx, r, now);
    out.push(res);
    if (res.error && /quota/i.test(res.error)) break;
  }
  return out;
}
