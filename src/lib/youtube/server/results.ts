// Server only (Worker C, round 3) — follow-ups, A/B swaps, learning library, calibration and the weekly
// review. Shared by the server actions (user's client) and the 5-minute cron (admin client): every query
// filters by ctx.userId and every insert sends user_id, so both work.
import { aiChat } from "@/lib/ai";
import { localNow } from "@/lib/time";
import { BANK_STAGES, NOTE_TYPES, WIP_STAGES, videoHref, videoLabel } from "@/lib/youtube/constants";
import {
  analyticsRange, baselineFor, calibrationSummary, checkinLabel, metricsLine, postmortemPrompt, pushStat, ratioText, retentionBySection, sectionMarks,
  shortTestPassed, verdictOf, viewsBetween, type Baseline, type BaselinePoint, type CalibrationInput, type SectionForMarks, type StatPoint,
} from "@/lib/youtube/baseline";
import { angleTable, equalWindows, judgeSwap, learningRows, learningTable, swapDays, topLessons, windowReady, type PairInfo } from "@/lib/youtube/abtest";
import { weekRange, weeklyText, type WeeklyData } from "@/lib/youtube/weekly";
import { cacheGet, cacheSet, hasApiKey, videosStats, YtError, type YtCtx } from "@/lib/youtube/server/yt-data";
import { retentionCurve, videoTotals } from "@/lib/youtube/server/yt-analytics";
import type { CheckinKind, CheckinVerdict, VideoMetrics, YtCheckin, YtKind, YtTest, YtVariant, YtVideo, YtWeekly } from "@/lib/youtube/types";

export const STATS_KEY = (ytId: string) => `ytstats:${ytId}`;
const STATS_LAST = "ytstats:last";

// ----- Views history (public numbers, kept in yt_api_cache) ------------------------------------------
export async function statsHistory(ctx: YtCtx, ytId: string): Promise<StatPoint[]> {
  const c = await cacheGet<StatPoint[]>(ctx, STATS_KEY(ytId), { allowStale: true });
  return Array.isArray(c?.data) ? c!.data : [];
}
async function addStat(ctx: YtCtx, ytId: string, p: StatPoint) {
  const hist = pushStat(await statsHistory(ctx, ytId), p);
  await cacheSet(ctx, STATS_KEY(ytId), hist, null);
  return hist;
}

/** Fresh public stats for the user's published videos (1 unit per 50 videos). Returns how many were saved. */
export async function refreshStats(ctx: YtCtx, opts: { token?: string | null; maxAgeDays?: number; force?: boolean } = {}): Promise<number> {
  if (!opts.force) {
    const last = await cacheGet<string>(ctx, STATS_LAST, { allowStale: true });
    if (last && Date.now() - Date.parse(last.fetchedAt) < 6 * 3600_000) return 0;
  }
  if (!opts.token && !hasApiKey()) return 0;
  const since = new Date(Date.now() - (opts.maxAgeDays ?? 120) * 86_400_000).toISOString();
  const { data } = await ctx.sb.from("yt_videos").select("youtube_video_id").eq("user_id", ctx.userId).eq("stage", "published").gte("published_at", since).not("youtube_video_id", "is", null).limit(100);
  const ids = ((data ?? []) as { youtube_video_id: string }[]).map((r) => r.youtube_video_id);
  await cacheSet(ctx, STATS_LAST, new Date().toISOString(), null);
  if (!ids.length) return 0;
  const stats = await videosStats(ctx, ids, { token: opts.token, parts: "statistics" });
  const at = new Date().toISOString();
  for (const s of stats) if (s.views !== null) await addStat(ctx, s.id, { at, views: s.views, likes: s.likes, comments: s.comments });
  return stats.length;
}

// ----- Baseline ("the usual") -------------------------------------------------------------------------
export async function baselinePoints(ctx: YtCtx): Promise<BaselinePoint[]> {
  const [{ data: ck }, { data: vids }] = await Promise.all([
    ctx.sb.from("yt_checkins").select("video_id,kind,done_at,metrics").eq("user_id", ctx.userId).not("done_at", "is", null).limit(1000),
    ctx.sb.from("yt_videos").select("id,kind,youtube_video_id").eq("user_id", ctx.userId).not("youtube_video_id", "is", null).limit(1000),
  ]);
  const byId = new Map(((vids ?? []) as { id: string; kind: YtKind; youtube_video_id: string }[]).map((v) => [v.id, v]));
  const out: BaselinePoint[] = [];
  for (const c of (ck ?? []) as Pick<YtCheckin, "video_id" | "kind" | "done_at" | "metrics">[]) {
    const v = byId.get(c.video_id);
    const views = c.metrics?.views;
    if (v && typeof views === "number") out.push({ ytId: v.youtube_video_id, kind: v.kind, checkin: c.kind, views, at: c.done_at });
  }
  return out;
}

/** Stored baseline jsonb → Baseline. */
export function storedBaseline(b: YtCheckin["baseline"] | null | undefined, viewGoal: number | null): Baseline {
  const views = typeof b?.views === "number" ? b.views : null;
  return { views, n: b?.n ?? 0, source: views ? "history" : viewGoal ? "goal" : "none", goal: viewGoal };
}

async function viewGoalOf(ctx: YtCtx) {
  const { data } = await ctx.sb.from("yt_settings").select("view_goal").eq("user_id", ctx.userId).maybeSingle();
  return (data?.view_goal as number | null | undefined) ?? null;
}

// ----- Check-ins -------------------------------------------------------------------------------------
export type CheckinRead = { metrics: VideoMetrics; base: Baseline; verdict: CheckinVerdict; line: string; notes: string[] };

/**
 * Reads one check-in: public views/likes/comments (API key or Google) and, when Google is connected and the
 * check-in is 7 days or later, impressions/CTR/retention from Analytics (1–3 days late). Saves the row.
 */
export async function readCheckin(ctx: YtCtx, checkin: YtCheckin, video: YtVideo, opts: { token?: string | null; now?: Date } = {}): Promise<CheckinRead> {
  const now = opts.now ?? new Date();
  const ytId = video.youtube_video_id;
  if (!ytId) throw new YtError("not_linked", "This video has no YouTube link yet — link it in Publish.");
  if (!opts.token && !hasApiKey()) throw new YtError("no_key", "Add YOUTUBE_API_KEY (or connect Google) to read the numbers.");
  const notes: string[] = [];
  const stat = (await videosStats(ctx, [ytId], { token: opts.token, parts: "statistics" }))[0];
  if (!stat) throw new YtError("not_found", "YouTube could not find this video (deleted or private?).");
  const metrics: VideoMetrics = { at: now.toISOString() };
  if (stat.views !== null) metrics.views = stat.views;
  if (stat.likes !== null) metrics.likes = stat.likes;
  if (stat.comments !== null) metrics.comments = stat.comments;
  if (stat.views !== null) await addStat(ctx, ytId, { at: metrics.at!, views: stat.views, likes: stat.likes, comments: stat.comments });

  if (opts.token && checkin.kind !== "48h" && video.published_at) {
    const range = analyticsRange(video.published_at, checkin.due_at, now);
    if (range) {
      try {
        const t = await videoTotals(opts.token, ytId, range.start, range.end);
        for (const k of ["impressions", "ctr", "avg_view_duration_s", "avg_view_pct", "subs_gained"] as const) if (t[k] !== undefined) metrics[k] = t[k];
        if (video.kind === "long") {
          const curve = await retentionCurve(opts.token, ytId, range.start, range.end).catch(() => []);
          if (curve.length) metrics.retention = curve.map((p) => ({ t: Math.round(p.t * 1000) / 1000, pct: Math.round(p.pct * 1000) / 1000 }));
        }
      } catch (e) {
        notes.push(`Analytics: ${e instanceof Error ? e.message : "not available"}`);
      }
    } else notes.push("Analytics numbers arrive 1–3 days late — CTR and retention will show at the next check-in.");
  }

  const base = baselineFor(await baselinePoints(ctx), { kind: video.kind, checkin: checkin.kind, excludeYtId: ytId, viewGoal: await viewGoalOf(ctx) });
  const verdict = verdictOf(metrics.views, base);
  const line = [metricsLine(metrics), ratioText(metrics.views, base)].filter(Boolean).join(" · ");
  await ctx.sb
    .from("yt_checkins")
    .update({ done_at: now.toISOString(), metrics, baseline: { ...(base.views ? { views: base.views } : {}), n: base.n }, verdict, notes: notes.join(" ") || checkin.notes })
    .eq("user_id", ctx.userId)
    .eq("id", checkin.id);

  // Short "test": ≥ 2× the usual Shorts views at 7 days → a long-video idea in the bank (once).
  if (video.kind === "short" && video.short_role === "test" && checkin.kind === "7d" && shortTestPassed(metrics.views, base)) {
    const { data: had } = await ctx.sb.from("yt_videos").select("id").eq("user_id", ctx.userId).eq("origin_video_id", video.id).eq("source", "short_test").limit(1);
    if (!had?.length)
      await ctx.sb.from("yt_videos").insert({ user_id: ctx.userId, idea_name: `${video.idea_name} (long version)`.slice(0, 200), topic: video.topic, topic_id: video.topic_id ?? null, stage: "bank", source: "short_test", origin_video_id: video.id, quick_notes: `The test Short got ${line}.` });
    notes.push("Test passed: a long-video idea was added to the bank.");
  }
  return { metrics, base, verdict, line, notes };
}

// ----- A/B swaps -------------------------------------------------------------------------------------
/** Measures an open swap when its after-window is complete. Returns the updated test or null (not ready). */
export async function measureSwap(ctx: YtCtx, test: YtTest, video: YtVideo, opts: { token?: string | null; now?: Date; force?: boolean } = {}): Promise<YtTest | null> {
  const now = opts.now ?? new Date();
  const days = (test.attrs?.window_days as number | undefined) ?? swapDays(video.published_at, test.started_at);
  const w = equalWindows(test.started_at, days);
  if (!opts.force && !windowReady(w.after, now, opts.token ? 2 : 0)) return null;
  const ytId = video.youtube_video_id;
  if (!ytId) return null;
  let before: VideoMetrics = {};
  let after: VideoMetrics = {};
  if (opts.token) {
    before = await videoTotals(opts.token, ytId, w.before.from, w.before.to);
    after = await videoTotals(opts.token, ytId, w.after.from, w.after.to);
  } else {
    const hist = await statsHistory(ctx, ytId);
    const t = (d: string, end = false) => Date.parse(`${d}T${end ? "23:59:59" : "00:00:00"}Z`);
    const b = viewsBetween(hist, t(w.before.from), t(w.before.to, true), video.published_at);
    const a = viewsBetween(hist, t(w.after.from), t(w.after.to, true), video.published_at);
    if (b !== null) before = { views: b };
    if (a !== null) after = { views: a };
  }
  const j = judgeSwap(before, after);
  const winner = j.winner === "after" ? test.to_pair_id : j.winner === "before" ? test.from_pair_id : null;
  const patch = {
    ended_at: now.toISOString(),
    verdict: j.verdict,
    winner_pair_id: winner,
    metrics_before: before,
    metrics_after: after,
    attrs: { ...(test.attrs ?? {}), window_days: days, reason: j.reason, reliable: j.reliable, change: j.change, same_weekdays: w.sameWeekdays },
  };
  await ctx.sb.from("yt_tests").update(patch).eq("user_id", ctx.userId).eq("id", test.id);
  return { ...test, ...patch } as YtTest;
}

// ----- Pairs with their variants (for tests and the library) -----------------------------------------
export async function pairInfos(ctx: YtCtx, videoIds?: string[]): Promise<Map<string, PairInfo & { video_id: string; is_primary: boolean; image: string | null }>> {
  let pq = ctx.sb.from("yt_pairs").select("id,video_id,label,title_id,thumbnail_id,is_primary,position").eq("user_id", ctx.userId);
  let vq = ctx.sb.from("yt_variants").select("id,video_id,kind,value,gap_type,stoppers,thumb_text,composition,contrast,attrs,image_url").eq("user_id", ctx.userId);
  if (videoIds) {
    pq = pq.in("video_id", videoIds.length ? videoIds : ["00000000-0000-0000-0000-000000000000"]);
    vq = vq.in("video_id", videoIds.length ? videoIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const [{ data: pairs }, { data: vars }] = await Promise.all([pq.order("position"), vq.limit(2000)]);
  const vm = new Map(((vars ?? []) as YtVariant[]).map((v) => [v.id, v]));
  const out = new Map<string, PairInfo & { video_id: string; is_primary: boolean; image: string | null }>();
  for (const p of (pairs ?? []) as { id: string; video_id: string; label: string; title_id: string | null; thumbnail_id: string | null; is_primary: boolean }[]) {
    const t = p.title_id ? vm.get(p.title_id) : undefined;
    const th = p.thumbnail_id ? vm.get(p.thumbnail_id) : undefined;
    out.set(p.id, { id: p.id, video_id: p.video_id, label: p.label, is_primary: p.is_primary, title: t?.value ?? null, thumb: th ?? null, image: th?.image_url ?? null });
  }
  return out;
}

// ----- Learning library + calibration ----------------------------------------------------------------
export async function loadLearning(ctx: YtCtx) {
  const [{ data: tests }, { data: vids }, { data: cks }] = await Promise.all([
    ctx.sb.from("yt_tests").select("*").eq("user_id", ctx.userId).order("started_at", { ascending: false }).limit(500),
    ctx.sb.from("yt_videos").select("id,code,idea_name,kind,angles,formats,predicted_views,data_score,ratings,view_potential,stage,published_at").eq("user_id", ctx.userId).neq("stage", "bank").limit(1000),
    ctx.sb.from("yt_checkins").select("video_id,kind,metrics,verdict,done_at").eq("user_id", ctx.userId).not("done_at", "is", null).limit(2000),
  ]);
  const videos = (vids ?? []) as Pick<YtVideo, "id" | "code" | "idea_name" | "kind" | "angles" | "formats" | "predicted_views" | "data_score" | "ratings" | "view_potential" | "stage" | "published_at">[];
  const vById = new Map(videos.map((v) => [v.id, v]));
  const pairs = await pairInfos(ctx);
  const rows = learningRows((tests ?? []) as YtTest[], pairs, (id) => vById.get(id)?.angles ?? []);
  const table = learningTable(rows);
  const checkins = (cks ?? []) as Pick<YtCheckin, "video_id" | "kind" | "metrics" | "verdict" | "done_at">[];
  const order: CheckinKind[] = ["90d", "30d", "7d", "48h"];
  const latest = new Map<string, CheckinVerdict | null>();
  for (const k of order) for (const c of checkins) if (c.kind === k && !latest.has(c.video_id)) latest.set(c.video_id, c.verdict);
  const angles = angleTable([...latest.entries()].map(([id, verdict]) => ({ angles: vById.get(id)?.angles ?? [], verdict })));
  const viewsAt = (id: string, k: CheckinKind) => {
    const c = checkins.find((x) => x.video_id === id && x.kind === k);
    return typeof c?.metrics?.views === "number" ? c.metrics.views : null;
  };
  const calInput: CalibrationInput[] = videos
    .filter((v) => v.kind === "long" && v.stage === "published")
    .map((v) => ({ videoId: v.id, kind: v.kind, predictedViews: v.predicted_views, dataScore: v.data_score, ratings: (v.ratings ?? {}) as Record<string, number | undefined>, viewPotential: v.view_potential, views7d: viewsAt(v.id, "7d"), views30d: viewsAt(v.id, "30d") }));
  const calibration = calibrationSummary(calInput);
  return { rows, table, lessons: topLessons(table, 5), angles, calibration, tests: (tests ?? []) as YtTest[], videos, pairs };
}

/**
 * Calibration helper for later use (Worker A's idea score): predicted vs real views of published long
 * videos. `ready` once there are 10 with a 7/30-day check-in; `medianRatio` scales predictions,
 * `scoreCorrelation` says whether data_score tracks real views at all.
 */
export async function getCalibrationData(ctx: YtCtx) {
  return (await loadLearning(ctx)).calibration;
}

// ----- Follow-up page ---------------------------------------------------------------------------------
export async function loadFollowUp(ctx: YtCtx, video: YtVideo) {
  const [{ data: cks }, { data: tests }, { data: secs }, { data: pm }, { data: comments }, { data: settings }, { data: pub }, { data: cuts }] = await Promise.all([
    ctx.sb.from("yt_checkins").select("*").eq("user_id", ctx.userId).eq("video_id", video.id).order("due_at"),
    ctx.sb.from("yt_tests").select("*").eq("user_id", ctx.userId).eq("video_id", video.id).order("started_at", { ascending: false }),
    ctx.sb.from("yt_sections").select("id,kind,num,position,title,start_s,words").eq("user_id", ctx.userId).eq("video_id", video.id),
    ctx.sb.from("yt_postmortems").select("*").eq("user_id", ctx.userId).eq("video_id", video.id).order("updated_at", { ascending: false }).limit(1),
    ctx.sb.from("yt_comments_todo").select("*").eq("user_id", ctx.userId).eq("video_id", video.id).order("like_count", { ascending: false }).limit(200),
    ctx.sb.from("yt_settings").select("view_goal,words_per_min").eq("user_id", ctx.userId).maybeSingle(),
    ctx.sb.from("yt_publish").select("youtube_video_id,post_plan").eq("user_id", ctx.userId).eq("video_id", video.id).maybeSingle(),
    ctx.sb.from("yt_cuts").select("label,duration_s,created_at").eq("user_id", ctx.userId).eq("video_id", video.id).order("created_at", { ascending: false }),
  ]);
  const checkins = (cks ?? []) as YtCheckin[];
  const viewGoal = (settings?.view_goal as number | null | undefined) ?? null;
  const uploaded = ((pub?.post_plan as Record<string, unknown> | null)?.uploaded ?? null) as { duration_s?: number | null } | null;
  const finalCut = ((cuts ?? []) as { label: string | null; duration_s: number | null }[]).find((c) => /final/i.test(c.label ?? "") && c.duration_s);
  const durationS = uploaded?.duration_s ?? finalCut?.duration_s ?? null;
  const { marks, estimated } = sectionMarks((secs ?? []) as SectionForMarks[], { wpm: settings?.words_per_min as number | undefined, durationS });
  const withRet = [...checkins].reverse().find((c) => c.metrics?.retention?.length);
  const retention = withRet && durationS ? retentionBySection(withRet.metrics.retention!, durationS, marks) : [];
  const pairs = [...(await pairInfos(ctx, [video.id])).values()];
  const ytId = video.youtube_video_id ?? (pub?.youtube_video_id as string | null) ?? null;
  const history = ytId ? await statsHistory(ctx, ytId) : [];
  return {
    checkins,
    tests: (tests ?? []) as YtTest[],
    pairs,
    postmortem: (pm?.[0] ?? null) as { id: string; text: string; note_id: string | null } | null,
    comments: (comments ?? []) as { id: string; comment_id: string | null; text: string; author: string | null; like_count: number | null; published_at: string | null; answered: boolean; idea_video_id: string | null }[],
    viewGoal,
    durationS,
    retention,
    retentionFrom: withRet?.kind ?? null,
    sectionsEstimated: estimated,
    history,
    ytId,
  };
}

// ----- Post-mortem ------------------------------------------------------------------------------------
export async function draftPostmortem(ctx: YtCtx, video: YtVideo): Promise<{ text: string } | { error: string }> {
  const d = await loadFollowUp(ctx, video);
  const primary = d.pairs.find((p) => p.is_primary) ?? d.pairs[0];
  const { data: others } = await ctx.sb.from("yt_videos").select("id,code,idea_name").eq("user_id", ctx.userId).eq("stage", "published").eq("kind", video.kind).neq("id", video.id).order("published_at", { ascending: false }).limit(5);
  const oIds = ((others ?? []) as { id: string }[]).map((o) => o.id);
  const { data: oCk } = oIds.length ? await ctx.sb.from("yt_checkins").select("video_id,kind,metrics,verdict").eq("user_id", ctx.userId).in("video_id", oIds).not("done_at", "is", null) : { data: [] };
  const oList = ((others ?? []) as { id: string; code: string | null; idea_name: string }[]).map((o) => {
    const cs = ((oCk ?? []) as { video_id: string; kind: string; metrics: VideoMetrics; verdict: CheckinVerdict | null }[]).filter((c) => c.video_id === o.id);
    const best = ["30d", "7d", "48h"].map((k) => cs.find((c) => c.kind === k)).find(Boolean);
    return { video: videoLabel(o), views: best?.metrics?.views ?? null, verdict: best?.verdict ?? null };
  });
  const prompt = postmortemPrompt({
    video: videoLabel(video),
    kind: video.kind,
    title: primary?.title ?? null,
    thumbnail: primary?.thumb ? [primary.thumb.value, primary.thumb.gap_type, primary.thumb.thumb_text ? `text "${primary.thumb.thumb_text}"` : null].filter(Boolean).join(" · ") : null,
    angles: video.angles ?? [],
    formats: video.formats ?? [],
    checkins: d.checkins.filter((c) => c.done_at).map((c) => ({ kind: c.kind, views: c.metrics?.views ?? null, usual: typeof c.baseline?.views === "number" ? c.baseline.views : null, verdict: c.verdict, line: metricsLine(c.metrics) })),
    retention: d.retention.map((r) => ({ title: r.title, startPct: r.startPct, endPct: r.endPct, worst: r.worst })),
    tests: d.tests.filter((t) => t.verdict).map((t) => `${t.kind === "swap" ? "swap" : "Test & compare"}: ${t.verdict}${t.winner_pair_id ? ` (winner ${d.pairs.find((p) => p.id === t.winner_pair_id)?.label ?? "?"})` : ""}`),
    others: oList,
    comments: d.comments.slice(0, 5).map((c) => c.text),
  });
  if (!d.checkins.some((c) => c.done_at)) return { error: "No check-in has numbers yet — wait for the 48 h check-in (or press “Check now”)." };
  const system =
    "You review one YouTube video for its creator (a beginner). Use ONLY the numbers given. Write short Markdown in English with exactly these headings: " +
    "'## What worked', '## What didn’t', '## Try next time' (3 numbered, concrete ideas). Max 180 words. Mention the section where most people left if given. No intro sentence.";
  const out = await aiChat(system, [{ text: prompt }], { kind: "write", temperature: 0.4, maxTokens: 700, timeoutMs: 40_000 });
  if ("error" in out) return { error: out.error };
  return { text: out.text.trim() };
}

/** Type = given option of the notes "type" property (created if missing), as notes.props. */
export async function noteTypeProps(ctx: YtCtx, name: string, id: string): Promise<Record<string, unknown>> {
  const { data: prop } = await ctx.sb.from("note_properties").select("id,config").eq("user_id", ctx.userId).eq("key", "type").is("deleted_at", null).maybeSingle();
  if (!prop) return {};
  const config = (prop.config ?? {}) as { options?: { id: string; name: string; color?: string }[] };
  const options = config.options ?? [];
  let opt = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
  if (!opt) {
    opt = { id, name, color: "red" };
    await ctx.sb.from("note_properties").update({ config: { ...config, options: [...options, opt] } }).eq("id", prop.id);
  }
  return { [prop.id as string]: opt.id };
}

/** Creates or updates a note; returns its id. */
export async function upsertNote(ctx: YtCtx, noteId: string | null, title: string, content: string, type: { name: string; id: string }): Promise<string | null> {
  const props = await noteTypeProps(ctx, type.name, type.id).catch(() => ({}));
  if (noteId) {
    const { data: n } = await ctx.sb.from("notes").select("id,props").eq("user_id", ctx.userId).eq("id", noteId).is("deleted_at", null).maybeSingle();
    if (n) {
      await ctx.sb.from("notes").update({ title, content, props: { ...((n.props ?? {}) as object), ...props } }).eq("id", noteId);
      return noteId;
    }
  }
  const { data, error } = await ctx.sb.from("notes").insert({ user_id: ctx.userId, title, content, props }).select("id").single();
  if (error || !data) return null;
  return data.id as string;
}

export async function savePostmortemNote(ctx: YtCtx, video: YtVideo, text: string, toNote: boolean) {
  const { data: pm } = await ctx.sb.from("yt_postmortems").select("id,note_id").eq("user_id", ctx.userId).eq("video_id", video.id).order("updated_at", { ascending: false }).limit(1);
  const row = (pm?.[0] ?? null) as { id: string; note_id: string | null } | null;
  const { data: ck } = await ctx.sb.from("yt_checkins").select("id,kind,done_at").eq("user_id", ctx.userId).eq("video_id", video.id).not("done_at", "is", null).order("due_at", { ascending: false }).limit(1);
  let noteId = row?.note_id ?? null;
  if (toNote) {
    const content = `[${videoLabel(video)} · open in YouTube](${videoHref(video.id, "follow-up")})\n\n${text}`;
    noteId = await upsertNote(ctx, noteId, `Post-mortem · ${videoLabel(video)}`, content, { name: NOTE_TYPES.postmortem, id: "yt_postmortem" });
    if (!noteId) throw new YtError("db", "Could not save the note.");
  }
  if (row) await ctx.sb.from("yt_postmortems").update({ text, note_id: noteId, checkin_id: ck?.[0]?.id ?? null }).eq("id", row.id);
  else await ctx.sb.from("yt_postmortems").insert({ user_id: ctx.userId, video_id: video.id, text, note_id: noteId, checkin_id: ck?.[0]?.id ?? null });
  return noteId;
}

// ----- Weekly review ----------------------------------------------------------------------------------
export async function buildWeekly(ctx: YtCtx, date: string): Promise<{ data: WeeklyData; key: string }> {
  const r = weekRange(date);
  const from = `${r.from}T00:00:00Z`;
  const to = `${r.to}T23:59:59Z`;
  const next = new Date(Date.parse(to) + 7 * 86_400_000).toISOString();
  const [{ data: vids }, { data: settings }, { data: cks }, { data: due }, { data: tests }, { data: shots }, { data: outs }] = await Promise.all([
    ctx.sb.from("yt_videos").select("id,code,idea_name,stage,source,created_at,published_at,kind").eq("user_id", ctx.userId).neq("stage", "archived").limit(1000),
    ctx.sb.from("yt_settings").select("wip_limit").eq("user_id", ctx.userId).maybeSingle(),
    ctx.sb.from("yt_checkins").select("video_id,kind,verdict,metrics,baseline,done_at").eq("user_id", ctx.userId).gte("done_at", from).lte("done_at", to),
    ctx.sb.from("yt_checkins").select("video_id,kind,due_at").eq("user_id", ctx.userId).is("done_at", null).gt("due_at", to).lte("due_at", next),
    ctx.sb.from("yt_tests").select("video_id,kind,verdict,ended_at,started_at").eq("user_id", ctx.userId).or(`ended_at.is.null,ended_at.gte.${from}`),
    ctx.sb.from("yt_shots").select("video_id").eq("user_id", ctx.userId).eq("done", false).limit(5000),
    ctx.sb.from("yt_watch_outliers").select("title,outlier_score,channel_row_id,found_at").eq("user_id", ctx.userId).eq("status", "new").gte("found_at", from).limit(20),
  ]);
  const videos = (vids ?? []) as Pick<YtVideo, "id" | "code" | "idea_name" | "stage" | "source" | "created_at" | "published_at" | "kind">[];
  const label = (id: string) => {
    const v = videos.find((x) => x.id === id);
    return v ? videoLabel(v) : "a video";
  };
  const inRange = (iso: string | null) => !!iso && iso >= from && iso <= to;
  const goal = await viewGoalOf(ctx);
  const shotCount = new Map<string, number>();
  for (const s of (shots ?? []) as { video_id: string }[]) shotCount.set(s.video_id, (shotCount.get(s.video_id) ?? 0) + 1);
  const learning = await loadLearning(ctx).catch(() => null);
  const data: WeeklyData = {
    from: r.from,
    to: r.to,
    newIdeas: videos.filter((v) => inRange(v.created_at) && (BANK_STAGES as string[]).includes(v.stage)).map((v) => ({ label: v.idea_name, source: v.source ?? "web" })),
    byStage: WIP_STAGES.map((stage) => ({ stage, videos: videos.filter((v) => v.stage === stage).map((v) => videoLabel(v)) })),
    wipLimit: (settings?.wip_limit as number | undefined) ?? 3,
    wipCount: videos.filter((v) => (WIP_STAGES as string[]).includes(v.stage)).length,
    checkins: ((cks ?? []) as Pick<YtCheckin, "video_id" | "kind" | "verdict" | "metrics" | "baseline">[]).map((c) => ({
      video: label(c.video_id),
      kind: c.kind,
      verdict: c.verdict,
      line: [metricsLine(c.metrics), ratioText(c.metrics?.views, storedBaseline(c.baseline, goal))].filter(Boolean).join(" · "),
    })),
    dueSoon: ((due ?? []) as { video_id: string; kind: CheckinKind; due_at: string }[]).map((c) => ({ video: label(c.video_id), kind: c.kind, due: c.due_at.slice(0, 10) })),
    tests: ((tests ?? []) as Pick<YtTest, "video_id" | "kind" | "verdict" | "ended_at">[]).map((t) => ({ video: label(t.video_id), kind: t.kind, status: t.ended_at ? `done — ${t.verdict ?? "no verdict"}` : "running" })),
    lessons: learning?.lessons ?? [],
    pendingShots: [...shotCount.entries()].filter(([id]) => videos.some((v) => v.id === id)).map(([id, count]) => ({ video: label(id), count })),
    newOutliers: ((outs ?? []) as { title: string; outlier_score: number | null }[]).map((o) => ({ title: o.title, score: o.outlier_score === null ? null : Math.round(o.outlier_score * 10) / 10 })),
    published: videos.filter((v) => inRange(v.published_at)).map((v) => videoLabel(v)),
  };
  return { data, key: r.key };
}

/** Builds the review, saves yt_weekly (+ note) and sends Telegram (when chatId). */
export async function runWeekly(ctx: YtCtx, opts: { date: string; note: boolean; send?: ((text: string) => Promise<unknown>) | null; appUrl?: string }): Promise<{ row: YtWeekly | null; telegram: string; sent: boolean }> {
  const { data, key } = await buildWeekly(ctx, opts.date);
  const txt = weeklyText(data, opts.appUrl);
  const { data: old } = await ctx.sb.from("yt_weekly").select("id,note_id").eq("user_id", ctx.userId).eq("week_start", key).maybeSingle();
  let noteId = (old?.note_id as string | null | undefined) ?? null;
  if (opts.note) noteId = await upsertNote(ctx, noteId, txt.title, txt.markdown, { name: NOTE_TYPES.weekly, id: "yt_weekly" });
  let sent = false;
  if (opts.send) {
    try {
      await opts.send(txt.telegram);
      sent = true;
    } catch {
      sent = false;
    }
  }
  const row = { user_id: ctx.userId, week_start: key, summary: txt.markdown, data: data as unknown as Record<string, unknown>, note_id: noteId, ...(sent ? { sent_at: new Date().toISOString() } : {}) };
  const { data: saved } = await ctx.sb.from("yt_weekly").upsert(row, { onConflict: "user_id,week_start" }).select("*").maybeSingle();
  return { row: (saved as YtWeekly | null) ?? null, telegram: txt.telegram, sent };
}

export const todayFor = (tz: string) => localNow(tz || "America/Guayaquil").date;
export { checkinLabel };
