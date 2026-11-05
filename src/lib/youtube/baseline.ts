// YouTube add-on (Worker C) — pure logic of follow-ups: check-in dates, "the usual" of the channel at the same
// point (median of the last ~10 videos of the same kind), verdicts, views history, retention by section and
// the calibration points for the idea score (predicted vs real).
import { BASELINE_LAST_N, BASELINE_MIN_VIDEOS, CALIBRATION_MIN_VIDEOS, CHECKINS, SHORT_TEST_MULTIPLIER } from "@/lib/youtube/constants";
import type { CheckinKind, CheckinVerdict, VideoMetrics, YtKind } from "@/lib/youtube/types";
import { median } from "@/lib/youtube/outliers";

export const CHECKIN_KINDS: CheckinKind[] = CHECKINS.map((c) => c.id);
export const checkinHours = (k: CheckinKind) => CHECKINS.find((c) => c.id === k)?.hours ?? 48;
export const checkinLabel = (k: CheckinKind) => CHECKINS.find((c) => c.id === k)?.label ?? k;

/** The 4 check-in rows to create when a video is published. */
export function checkinsFor(publishedAt: string): { kind: CheckinKind; due_at: string }[] {
  const t = Date.parse(publishedAt);
  return CHECKINS.map((c) => ({ kind: c.id, due_at: new Date(t + c.hours * 3600_000).toISOString() }));
}

/** ±10 % of the usual = "normal" (YouTube numbers are noisy). */
export const VERDICT_BAND = 0.1;

export type Baseline = { views: number | null; n: number; source: "history" | "goal" | "none"; goal?: number | null };

/** One past data point: views of another video at the same check-in. */
export type BaselinePoint = { ytId: string; kind: YtKind; checkin: CheckinKind; views: number; at?: string | null };

/**
 * "The usual": median views at the same check-in of the last N videos of the same kind (long vs Shorts).
 * With fewer than BASELINE_MIN_VIDEOS → insufficient (the page shows progress vs the view goal instead).
 */
export function baselineFor(points: BaselinePoint[], opts: { kind: YtKind; checkin: CheckinKind; excludeYtId?: string | null; viewGoal?: number | null; lastN?: number; minVideos?: number }): Baseline {
  const seen = new Set<string>();
  const pool = points
    .filter((p) => p.kind === opts.kind && p.checkin === opts.checkin && p.ytId !== opts.excludeYtId && Number.isFinite(p.views))
    .sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0)
    .filter((p) => (seen.has(p.ytId) ? false : (seen.add(p.ytId), true)))
    .slice(0, opts.lastN ?? BASELINE_LAST_N);
  if (pool.length >= (opts.minVideos ?? BASELINE_MIN_VIDEOS)) return { views: median(pool.map((p) => p.views)), n: pool.length, source: "history", goal: opts.viewGoal ?? null };
  if (opts.viewGoal) return { views: null, n: pool.length, source: "goal", goal: opts.viewGoal };
  return { views: null, n: pool.length, source: "none" };
}

export function verdictOf(views: number | null | undefined, base: Baseline): CheckinVerdict {
  if (views === null || views === undefined || base.source !== "history" || !base.views) return "insufficient";
  const r = views / base.views;
  if (r >= 1 + VERDICT_BAND) return "above";
  if (r <= 1 - VERDICT_BAND) return "below";
  return "normal";
}

/** "1.8× the usual" / "62 % of the usual" (null when there is no usual). */
export function ratioText(views: number | null | undefined, base: Baseline) {
  if (views === null || views === undefined) return null;
  if (base.source === "history" && base.views) {
    const r = views / base.views;
    return r >= 1 ? `${(Math.round(r * 10) / 10).toString()}× the usual` : `${Math.round(r * 100)} % of the usual`;
  }
  if (base.goal) return `${Math.round((views / base.goal) * 100)} % of your view goal (not enough videos to compare yet: ${base.n}/${BASELINE_MIN_VIDEOS})`;
  return null;
}

export const VERDICT_LABEL: Record<CheckinVerdict, string> = { above: "Above usual", normal: "Normal", below: "Below usual", insufficient: "Not enough data" };

/** Short test: ≥ 2× the Shorts median at 7 days → back to the idea bank with a bonus. */
export function shortTestPassed(views: number | null | undefined, base: Baseline) {
  return base.source === "history" && !!base.views && (views ?? 0) >= base.views * SHORT_TEST_MULTIPLIER;
}

// ----- Views history (public stats snapshots) --------------------------------------------------------
export type StatPoint = { at: string; views: number; likes?: number | null; comments?: number | null };

/** Adds a snapshot (sorted, one per 30 min at most, capped). */
export function pushStat(hist: StatPoint[] | null | undefined, p: StatPoint, cap = 240): StatPoint[] {
  const list = [...(hist ?? [])].filter((x) => x && Number.isFinite(Date.parse(x.at)));
  const last = list[list.length - 1];
  if (last && Math.abs(Date.parse(p.at) - Date.parse(last.at)) < 30 * 60_000) list[list.length - 1] = p;
  else list.push(p);
  list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return list.slice(-cap);
}

/** Views at a moment, by straight-line interpolation between snapshots (null outside the known range,
 *  except at/after publish time when `publishedAt` is given: views were 0 then). */
export function viewsAt(hist: StatPoint[], at: string | number, publishedAt?: string | null): number | null {
  const t = typeof at === "number" ? at : Date.parse(at);
  const pts = [...(publishedAt ? [{ at: publishedAt, views: 0 }] : []), ...hist].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!pts.length) return null;
  for (let i = 0; i < pts.length; i++) {
    const ti = Date.parse(pts[i].at);
    if (ti === t) return pts[i].views;
    if (ti > t) {
      if (i === 0) return null;
      const a = pts[i - 1];
      const ta = Date.parse(a.at);
      return Math.round(a.views + ((pts[i].views - a.views) * (t - ta)) / (ti - ta));
    }
  }
  return null;
}

/** Views gained between two moments (null if either end is unknown). */
export function viewsBetween(hist: StatPoint[], from: number, to: number, publishedAt?: string | null) {
  const a = viewsAt(hist, from, publishedAt);
  const b = viewsAt(hist, to, publishedAt);
  return a === null || b === null ? null : Math.max(0, b - a);
}

// ----- Retention by section --------------------------------------------------------------------------
export type RetentionPoint = { t: number; pct: number };
export type SectionMark = { id: string; title: string; code?: string; start_s: number | null };
export type SectionRetention = { id: string; title: string; code?: string; startS: number; endS: number; startPct: number | null; endPct: number | null; drop: number | null; worst: boolean };

/** Retention value at a ratio 0..1 of the video (nearest point; Analytics gives 100 points). */
function retAt(curve: RetentionPoint[], ratio: number): number | null {
  if (!curve.length) return null;
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.t - ratio) < Math.abs(best.t - ratio)) best = p;
  return best.pct;
}

/**
 * Maps the retention curve (t = 0..1 of the video, pct = share still watching, 1 = 100 %) to the outline
 * sections using their start times. Sections without a start time are skipped. The biggest drop is flagged.
 */
export function retentionBySection(curve: RetentionPoint[], durationS: number | null, sections: SectionMark[]): SectionRetention[] {
  if (!durationS || durationS <= 0) return [];
  const timed = sections.filter((s) => s.start_s !== null && s.start_s! >= 0 && s.start_s! < durationS).sort((a, b) => a.start_s! - b.start_s!);
  const rows: SectionRetention[] = timed.map((s, i) => {
    const startS = s.start_s!;
    const endS = i + 1 < timed.length ? timed[i + 1].start_s! : durationS;
    const startPct = retAt(curve, startS / durationS);
    const endPct = retAt(curve, Math.min(1, endS / durationS));
    const drop = startPct !== null && endPct !== null ? Math.round((startPct - endPct) * 1000) / 1000 : null;
    return { id: s.id, title: s.title, code: s.code, startS, endS, startPct, endPct, drop, worst: false };
  });
  let worst: SectionRetention | null = null;
  for (const r of rows) if (r.drop !== null && (!worst || r.drop > (worst.drop ?? -1))) worst = r;
  if (worst && (worst.drop ?? 0) > 0) worst.worst = true;
  return rows;
}

// ----- Calibration of the idea score (helper for Worker A) ------------------------------------------
export type CalibrationInput = { videoId: string; kind: YtKind; predictedViews: number | null; dataScore: number | null; ratings?: Record<string, number | undefined>; viewPotential?: number | null; views7d: number | null; views30d: number | null };
export type CalibrationPoint = CalibrationInput & { /** real ÷ predicted at 30 days (or 7 days if no 30 yet) */ ratio: number | null; at: "30d" | "7d" | null };
export type CalibrationSummary = { points: CalibrationPoint[]; n: number; ready: boolean; /** median real ÷ predicted (1 = predictions right on) */ medianRatio: number | null; /** Pearson correlation of data_score vs log(real views) */ scoreCorrelation: number | null };

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx || !syy) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000;
}

/**
 * Predicted vs real for every published long video with a 7- or 30-day check-in. `ready` once there are
 * CALIBRATION_MIN_VIDEOS (10). Worker A's scoring can read medianRatio (scale predictions) and
 * scoreCorrelation (is the score useful at all?) — see getCalibrationData() in server/results.ts.
 */
export function calibrationSummary(rows: CalibrationInput[]): CalibrationSummary {
  const points: CalibrationPoint[] = rows.map((r) => {
    const real = r.views30d ?? r.views7d;
    const at = r.views30d !== null ? "30d" : r.views7d !== null ? "7d" : null;
    return { ...r, at, ratio: real !== null && r.predictedViews ? Math.round((real / r.predictedViews) * 100) / 100 : null };
  });
  const withReal = points.filter((p) => p.at !== null);
  const scored = withReal.filter((p) => p.dataScore !== null);
  return {
    points,
    n: withReal.length,
    ready: withReal.length >= CALIBRATION_MIN_VIDEOS,
    medianRatio: median(withReal.map((p) => p.ratio)),
    scoreCorrelation: pearson(scored.map((p) => p.dataScore!), scored.map((p) => Math.log10(1 + (p.views30d ?? p.views7d ?? 0)))),
  };
}

/** Compact one-line metrics text (Telegram, weekly). */
export function metricsLine(m: VideoMetrics | null | undefined) {
  if (!m) return "";
  const parts: string[] = [];
  const f = (n: number) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1e3 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n)));
  if (m.views !== undefined) parts.push(`${f(m.views)} views`);
  if (m.ctr !== undefined) parts.push(`CTR ${Math.round(m.ctr * 10) / 10} %`);
  if (m.impressions !== undefined) parts.push(`${f(m.impressions)} impressions`);
  if (m.avg_view_pct !== undefined) parts.push(`${Math.round(m.avg_view_pct)} % watched`);
  if (m.subs_gained !== undefined) parts.push(`+${m.subs_gained} subs`);
  if (m.likes !== undefined) parts.push(`${f(m.likes)} likes`);
  if (m.comments !== undefined) parts.push(`${m.comments} comments`);
  return parts.join(" · ");
}

// ----- Section start times for retention (round 3) ---------------------------------------------------
export type SectionForMarks = { id: string; kind: "intro" | "body" | "closing"; title: string; num?: number | null; position?: number | null; start_s: number | null; words: number | null };

/**
 * Start time of every section: the real start_s (saved by the Edit page) when ALL sections have one;
 * otherwise an estimate from the words (cumulative words ÷ speaking speed), stretched to the real video
 * length when it is known. `estimated` tells the page to say so.
 */
export function sectionMarks(sections: SectionForMarks[], opts: { wpm?: number | null; durationS?: number | null } = {}): { marks: SectionMark[]; estimated: boolean } {
  const order = (s: SectionForMarks) => (s.kind === "intro" ? -1 : s.kind === "closing" ? 1e9 : s.position ?? s.num ?? 0);
  const list = [...sections].sort((a, b) => order(a) - order(b));
  const code = (s: SectionForMarks) => (s.num === null || s.num === undefined ? undefined : `S${String(s.num).padStart(2, "0")}`);
  if (list.length && list.every((s) => s.start_s !== null && s.start_s !== undefined)) {
    return { marks: list.map((s) => ({ id: s.id, title: s.title, code: code(s), start_s: s.start_s })), estimated: false };
  }
  const wpm = opts.wpm && opts.wpm > 0 ? opts.wpm : 150;
  const total = list.reduce((a, s) => a + Math.max(0, s.words ?? 0), 0);
  const spoken = (total / wpm) * 60;
  const k = opts.durationS && spoken > 0 ? opts.durationS / spoken : 1;
  let acc = 0;
  const marks = list.map((s) => {
    const start = Math.round(acc * k);
    acc += (Math.max(0, s.words ?? 0) / wpm) * 60;
    return { id: s.id, title: s.title, code: code(s), start_s: start };
  });
  return { marks, estimated: true };
}

// ----- Post-mortem input (compact, for src/lib/ai.ts) --------------------------------------------------
export type PostmortemInput = {
  video: string;
  kind: YtKind;
  title: string | null;
  thumbnail: string | null;
  angles: string[];
  formats: string[];
  checkins: { kind: CheckinKind; views: number | null; usual: number | null; verdict: CheckinVerdict | null; line: string }[];
  retention: { title: string; startPct: number | null; endPct: number | null; worst: boolean }[];
  tests: string[];
  others: { video: string; views: number | null; verdict: CheckinVerdict | null }[];
  comments: string[];
};

/** Short prompt text (well under AI_PROMPT_MAX): numbers, package, sections, tests, a few other videos. */
export function postmortemPrompt(d: PostmortemInput, max = 6000): string {
  const L: string[] = [];
  L.push(`Video: ${d.video} (${d.kind === "short" ? "Short" : "long video"})`);
  if (d.title) L.push(`Title: ${d.title}`);
  if (d.thumbnail) L.push(`Thumbnail concept: ${d.thumbnail}`);
  if (d.formats.length || d.angles.length) L.push(`Format: ${d.formats.join(", ") || "-"} · Angle: ${d.angles.join(", ") || "-"}`);
  for (const c of d.checkins) L.push(`Check-in ${c.kind}: ${c.line || "no numbers"}${c.usual ? ` (usual ${c.usual})` : ""}${c.verdict ? ` → ${c.verdict}` : ""}`);
  if (d.retention.length) {
    L.push("Retention by section (share still watching at start → end):");
    for (const r of d.retention) L.push(`- ${r.title}: ${pctTxt(r.startPct)} → ${pctTxt(r.endPct)}${r.worst ? " (biggest drop)" : ""}`);
  }
  if (d.tests.length) L.push(`A/B tests: ${d.tests.join(" | ")}`);
  if (d.others.length) L.push(`Other recent videos: ${d.others.map((o) => `${o.video} ${o.views ?? "?"} views${o.verdict ? ` (${o.verdict})` : ""}`).join("; ")}`);
  if (d.comments.length) L.push(`Some comments: ${d.comments.map((c) => `"${c.slice(0, 140)}"`).join(" ")}`);
  const s = L.join("\n");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
const pctTxt = (p: number | null) => (p === null ? "?" : `${Math.round(p * 100)} %`);

/** Idea name from a viewer comment ("Video idea from a comment: …", ≤ 80 chars). */
export function commentIdeaName(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t || "Idea from a comment";
}

/** Which check-ins can be read now: due and not done (oldest first). */
export function dueCheckins<T extends { due_at: string; done_at: string | null }>(rows: T[], now: Date): T[] {
  return rows.filter((r) => !r.done_at && Date.parse(r.due_at) <= now.getTime()).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
}

/** Analytics window for a check-in: published day → min(today − 2 days, due day). Null if too early. */
export function analyticsRange(publishedAt: string, dueAt: string, now: Date): { start: string; end: string } | null {
  const start = publishedAt.slice(0, 10);
  const lastFull = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const due = dueAt.slice(0, 10);
  const end = lastFull < due ? lastFull : due;
  return end >= start ? { start, end } : null;
}
