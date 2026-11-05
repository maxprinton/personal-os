"use server";
// YouTube add-on (Worker C, round 3) — after publishing: check-ins (read numbers now), A/B (Test & compare
// logged by hand, before/after swaps by API or by hand), comments to answer (→ new ideas), ✨ post-mortem
// (→ note "Post-mortem"), weekly review on demand, calibration data for the idea score.
import { revalidatePath } from "next/cache";
import { withAiUsage } from "@/lib/ai-usage";
import { MIGRATION_FILE, videoHref } from "@/lib/youtube/constants";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { activeTestCompare, openSwap, swapDays } from "@/lib/youtube/abtest";
import { commentIdeaName } from "@/lib/youtube/baseline";
import {
  draftPostmortem, getCalibrationData, measureSwap, pairInfos, readCheckin, refreshStats, runWeekly, savePostmortemNote, todayFor,
} from "@/lib/youtube/server/results";
import { buildTitleSwap } from "@/lib/youtube/publish-rules";
import { hasApiKey, videoComments, videoRaw, ytFetch, YtError, type YtCtx } from "@/lib/youtube/server/yt-data";
import { getAccessToken, oauthConfigured } from "@/lib/youtube/server/yt-oauth";
import { loadThumbnail, pushPackage } from "@/lib/youtube/server/yt-publish";
import type { PublishFields, TestVerdict, YtCheckin, YtTest, YtVideo } from "@/lib/youtube/types";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
type PgErr = { code?: string; message?: string } | null | undefined;
const dbFail = (e: PgErr) => (isMissingTable(e) ? MISSING : e?.message || "Something went wrong. Try again.");
const errText = (e: unknown) => (e instanceof YtError ? e.message : e instanceof Error ? e.message : "Something went wrong. Try again.");
const SIGNED_OUT = { error: "Sign in again." };
type R = { ok?: boolean; error?: string; info?: string };

async function ctx(): Promise<YtCtx | null> {
  const { supabase, userId } = await ytServer();
  return userId ? { sb: supabase, userId } : null;
}
async function videoOf(c: YtCtx, id: string): Promise<YtVideo | null> {
  const { data } = await c.sb.from("yt_videos").select("*").eq("user_id", c.userId).eq("id", id).maybeSingle();
  return (data as YtVideo | null) ?? null;
}
/** Google token if connected (null otherwise, never an error: public numbers still work with the key). */
async function tokenOrNull(userId: string): Promise<string | null> {
  if (!oauthConfigured()) return null;
  const t = await getAccessToken(userId).catch(() => null);
  return t && t.token ? t.token : null;
}
const refresh = (videoId: string) => {
  revalidatePath(videoHref(videoId, "follow-up"));
  revalidatePath("/youtube/learning");
};

// ----- Check-ins --------------------------------------------------------------------------------------
/** Reads a check-in now (also re-reads a done one to update the numbers). */
export async function checkNow(checkinId: string): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data, error } = await c.sb.from("yt_checkins").select("*").eq("user_id", c.userId).eq("id", checkinId).maybeSingle();
  if (error || !data) return { error: error ? dbFail(error) : "Check-in not found." };
  const ck = data as YtCheckin;
  if (Date.parse(ck.due_at) > Date.now() && !ck.done_at) return { error: "This check-in is not due yet." };
  const v = await videoOf(c, ck.video_id);
  if (!v) return { error: "Video not found." };
  try {
    const r = await readCheckin(c, ck, v, { token: await tokenOrNull(c.userId) });
    refresh(v.id);
    return { ok: true, info: [r.line || "Saved.", ...r.notes].join(" ") };
  } catch (e) {
    return { error: errText(e) };
  }
}

export async function refreshStatsNow(videoId: string): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  try {
    const n = await refreshStats(c, { token: await tokenOrNull(c.userId), force: true });
    refresh(videoId);
    return { ok: true, info: n ? `Updated ${n} video${n === 1 ? "" : "s"}.` : "Nothing to update." };
  } catch (e) {
    return { error: errText(e) };
  }
}

// ----- A/B: Test & compare (YouTube's verdict, logged by hand) -----------------------------------------
async function testsOf(c: YtCtx, videoId: string) {
  const { data } = await c.sb.from("yt_tests").select("*").eq("user_id", c.userId).eq("video_id", videoId);
  return (data ?? []) as YtTest[];
}

export async function startTestCompare(videoId: string, pairIds: string[]): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  if (v.kind === "short") return { error: "Shorts can't use Test & compare." };
  const ids = [...new Set(pairIds)].slice(0, 3);
  if (ids.length < 2) return { error: "Pick 2 or 3 pairs (the ones you added in Studio)." };
  const tests = await testsOf(c, videoId);
  if (activeTestCompare(tests)) return { error: "A Test & compare is already logged as running." };
  if (openSwap(tests)) return { error: "A swap is being measured — finish it first." };
  const { error } = await c.sb.from("yt_tests").insert({ user_id: c.userId, video_id: videoId, kind: "test_compare", pair_ids: ids, started_at: new Date().toISOString() });
  if (error) return { error: dbFail(error) };
  refresh(videoId);
  return { ok: true, info: "Logged. Don’t change the title or thumbnail until Studio shows the result (1–2 weeks)." };
}

export async function logTestCompare(testId: string, verdict: TestVerdict, winnerPairId: string | null, notes: string): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data } = await c.sb.from("yt_tests").select("*").eq("user_id", c.userId).eq("id", testId).maybeSingle();
  const t = data as YtTest | null;
  if (!t) return { error: "Test not found." };
  if (verdict === "winner" && (!winnerPairId || !t.pair_ids.includes(winnerPairId))) return { error: "Choose which pair won." };
  const { error } = await c.sb
    .from("yt_tests")
    .update({ verdict, winner_pair_id: verdict === "winner" ? winnerPairId : null, ended_at: new Date().toISOString(), notes: notes.trim().slice(0, 2000) || null })
    .eq("id", testId);
  if (error) return { error: dbFail(error) };
  // YouTube keeps the winner on the video → make it the primary pair here too.
  if (verdict === "winner" && winnerPairId) await setPrimary(c, t.video_id, winnerPairId);
  refresh(t.video_id);
  return { ok: true };
}

async function setPrimary(c: YtCtx, videoId: string, pairId: string) {
  const now = new Date().toISOString();
  await c.sb.from("yt_pairs").update({ is_primary: false, active_to: now }).eq("user_id", c.userId).eq("video_id", videoId).eq("is_primary", true).neq("id", pairId);
  await c.sb.from("yt_pairs").update({ is_primary: true, active_from: now, active_to: null }).eq("user_id", c.userId).eq("id", pairId);
}

export async function deleteTest(testId: string): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data } = await c.sb.from("yt_tests").select("video_id").eq("user_id", c.userId).eq("id", testId).maybeSingle();
  const { error } = await c.sb.from("yt_tests").delete().eq("user_id", c.userId).eq("id", testId);
  if (error) return { error: dbFail(error) };
  if (data?.video_id) refresh(data.video_id as string);
  return { ok: true };
}

// ----- A/B: before/after swap ---------------------------------------------------------------------------
/**
 * Swaps to another pair. mode "api": videos.update (title) + thumbnails.set (JPG) with Google; "manual": you
 * change it in Studio and the app only records the time. Never while a Test & compare is running.
 */
export async function startSwap(videoId: string, toPairId: string, mode: "api" | "manual"): Promise<R & { log?: { what: string; ok: boolean; error?: string }[] }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  if (v.kind === "short") return { error: "Shorts don't use title/thumbnail swaps." };
  if (!v.youtube_video_id) return { error: "Link the YouTube video in Publish first." };
  const tests = await testsOf(c, videoId);
  if (activeTestCompare(tests)) return { error: "A Test & compare is running — changing the title or thumbnail would stop it. Log its result first." };
  if (openSwap(tests)) return { error: "A swap is already being measured." };
  const pairs = await pairInfos(c, [videoId]);
  const to = pairs.get(toPairId);
  if (!to) return { error: "Pair not found." };
  const from = [...pairs.values()].find((p) => p.is_primary) ?? null;
  if (from?.id === toPairId) return { error: "That pair is already the one on YouTube." };
  const log: { what: string; ok: boolean; error?: string }[] = [];
  if (mode === "api") {
    const tok = await getAccessToken(c.userId);
    if (tok.token === null) return { error: tok.error };
    if (to.title) {
      try {
        const cur = await videoRaw(c, v.youtube_video_id, tok.token, "snippet");
        if (!cur) throw new YtError("not_found", "YouTube could not find the video.");
        const { parts, body } = buildTitleSwap(cur as unknown as Parameters<typeof buildTitleSwap>[0], to.title);
        await ytFetch(c, "videos", { part: parts }, { cost: "videosUpdate", token: tok.token, method: "PUT", body });
        log.push({ what: "Title", ok: true });
      } catch (e) {
        log.push({ what: "Title", ok: false, error: errText(e) });
      }
    }
    if (to.image) {
      const t = await loadThumbnail(c.sb, c.userId, to.image);
      if ("error" in t) log.push({ what: "Thumbnail", ok: false, error: t.error });
      else {
        const r = await pushPackage(c, tok.token, { ytId: v.youtube_video_id, fields: {} as PublishFields, localizations: {}, thumbnail: t, playlists: [], parts: { metadata: false, thumbnail: true, playlists: false } });
        log.push(...r.log.map((l) => ({ what: l.what, ok: l.ok, error: l.error })));
      }
    }
    if (!log.some((l) => l.ok)) return { error: "Nothing changed on YouTube — see the list.", log };
  }
  const now = new Date().toISOString();
  const { error } = await c.sb.from("yt_tests").insert({
    user_id: c.userId,
    video_id: videoId,
    kind: "swap",
    pair_ids: [from?.id, toPairId].filter(Boolean),
    from_pair_id: from?.id ?? null,
    to_pair_id: toPairId,
    started_at: now,
    attrs: { mode, window_days: swapDays(v.published_at, now) },
  });
  if (error) return { error: dbFail(error), log };
  await setPrimary(c, videoId, toPairId);
  refresh(videoId);
  revalidatePath(videoHref(videoId, "publish"));
  return { ok: true, log, info: mode === "manual" ? "Recorded. Now change the title and thumbnail in Studio (the time is saved as the swap time)." : undefined };
}

export async function measureSwapNow(testId: string, force = false): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data } = await c.sb.from("yt_tests").select("*").eq("user_id", c.userId).eq("id", testId).maybeSingle();
  const t = data as YtTest | null;
  if (!t || t.kind !== "swap") return { error: "Swap not found." };
  const v = await videoOf(c, t.video_id);
  if (!v) return { error: "Video not found." };
  try {
    const r = await measureSwap(c, t, v, { token: await tokenOrNull(c.userId), force });
    if (!r) return { info: "The “after” window is not complete yet (plus 2 days for Analytics). The app checks it by itself." };
    refresh(v.id);
    return { ok: true, info: String(r.attrs?.reason ?? r.verdict ?? "") };
  } catch (e) {
    return { error: errText(e) };
  }
}

// ----- Comments ----------------------------------------------------------------------------------------
export async function loadCommentsNow(videoId: string): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v?.youtube_video_id) return { error: "Link the YouTube video in Publish first." };
  const token = await tokenOrNull(c.userId);
  if (!token && !hasApiKey()) return { error: "Add YOUTUBE_API_KEY (or connect Google) to load comments." };
  try {
    const items = await videoComments(c, v.youtube_video_id, { token, max: 100 });
    const ownTitle = (await c.sb.from("yt_settings").select("channel_title").eq("user_id", c.userId).maybeSingle()).data?.channel_title as string | undefined;
    const rows = items
      .filter((i) => i.replies === 0 && (!ownTitle || i.author !== ownTitle))
      .map((i) => ({ user_id: c.userId, video_id: videoId, comment_id: i.id, text: i.text, author: i.author, like_count: i.likes, published_at: i.publishedAt || null }));
    if (rows.length) {
      const { error } = await c.sb.from("yt_comments_todo").upsert(rows, { onConflict: "video_id,comment_id", ignoreDuplicates: true });
      if (error) return { error: dbFail(error) };
    }
    refresh(videoId);
    return { ok: true, info: `${items.length} comments read · ${rows.length} without a reply.` };
  } catch (e) {
    return { error: errText(e) };
  }
}

export async function setCommentAnswered(id: string, answered: boolean): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data, error } = await c.sb.from("yt_comments_todo").update({ answered }).eq("user_id", c.userId).eq("id", id).select("video_id").maybeSingle();
  if (error) return { error: dbFail(error) };
  if (data?.video_id) refresh(data.video_id as string);
  return { ok: true };
}

/** A comment → idea in the bank (source comment, linked to this video). */
export async function commentToIdea(id: string): Promise<R & { videoId?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data: cm } = await c.sb.from("yt_comments_todo").select("*").eq("user_id", c.userId).eq("id", id).maybeSingle();
  if (!cm) return { error: "Comment not found." };
  if (cm.idea_video_id) return { ok: true, videoId: cm.idea_video_id as string, info: "Already an idea." };
  const { data: v, error } = await c.sb
    .from("yt_videos")
    .insert({ user_id: c.userId, idea_name: commentIdeaName(cm.text as string), stage: "bank", source: "comment", source_quote: `${cm.author ?? "A viewer"}: ${cm.text}`.slice(0, 2000), origin_video_id: cm.video_id })
    .select("id")
    .single();
  if (error || !v) return { error: dbFail(error) };
  await c.sb.from("yt_comments_todo").update({ idea_video_id: v.id }).eq("id", id);
  refresh(cm.video_id as string);
  revalidatePath("/youtube");
  return { ok: true, videoId: v.id as string };
}

/** A follow-up idea typed by hand (source follow_up). */
export async function followUpIdea(videoId: string, name: string): Promise<R & { videoId?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const n = name.trim();
  if (!n) return { error: "Write the idea first." };
  const { data: v, error } = await c.sb.from("yt_videos").insert({ user_id: c.userId, idea_name: n.slice(0, 200), stage: "bank", source: "follow_up", origin_video_id: videoId }).select("id").single();
  if (error || !v) return { error: dbFail(error) };
  await c.sb.from("yt_video_links").insert({ user_id: c.userId, from_id: videoId, to_id: v.id, kind: "follow_up" });
  refresh(videoId);
  revalidatePath("/youtube");
  return { ok: true, videoId: v.id as string };
}

// ----- Post-mortem -------------------------------------------------------------------------------------
export async function aiPostmortem(videoId: string): Promise<{ text?: string; error?: string }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  const r = await withAiUsage("youtube-postmortem", () => draftPostmortem(c, v), { sb: c.sb, userId: c.userId });
  return "error" in r ? { error: r.error } : { text: r.text };
}

export async function savePostmortem(videoId: string, text: string, toNote: boolean): Promise<R & { noteId?: string | null }> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const v = await videoOf(c, videoId);
  if (!v) return { error: "Video not found." };
  if (!text.trim()) return { error: "The post-mortem is empty." };
  try {
    const noteId = await savePostmortemNote(c, v, text.trim().slice(0, 20000), toNote);
    refresh(videoId);
    return { ok: true, noteId };
  } catch (e) {
    return { error: errText(e) };
  }
}

// ----- Weekly review on demand -------------------------------------------------------------------------
export async function runWeeklyNow(sendTelegram: boolean): Promise<R> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  const { data: us } = await c.sb.from("user_settings").select("timezone,telegram_chat_id").eq("user_id", c.userId).maybeSingle();
  const chat = (us?.telegram_chat_id as number | null | undefined) ?? null;
  const { botToken } = await import("@/lib/telegram");
  const { send } = await import("@/lib/bot/tg");
  const { appUrl } = await import("@/lib/bot/youtube-nudges");
  const canSend = sendTelegram && !!chat && !!botToken();
  try {
    const r = await runWeekly(c, { date: todayFor((us?.timezone as string | undefined) ?? ""), note: true, send: canSend ? (t) => send(chat!, t) : null, appUrl: appUrl() });
    revalidatePath("/youtube/weekly");
    return { ok: true, info: `Saved${r.row?.note_id ? " as a note" : ""}${r.sent ? " and sent to Telegram" : sendTelegram ? " (Telegram not connected — not sent)" : ""}.` };
  } catch (e) {
    return { error: errText(e) };
  }
}

/** For Worker A's idea score: predicted vs real (see getCalibrationData in server/results.ts). */
export async function calibrationData() {
  const c = await ctx();
  if (!c) return null;
  return getCalibrationData(c).catch(() => null);
}
