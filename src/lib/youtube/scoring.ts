// YouTube add-on (Worker A) — pure logic of the idea bank, ideation and board: gates, view potential from
// saved references, the weighted idea score, "next step", WIP limit, YouTube links. No I/O: tested in
// scripts/test-youtube-a.ts.
import { DEFAULT_SCORE_WEIGHTS, GATES, RATINGS, RATING_MAX, RATING_MIN, WIP_STAGES, stageIndex } from "@/lib/youtube/constants";
import type { Gates, IdeaStep, RatingKey, Ratings, ScoreWeights, YtStage } from "@/lib/youtube/types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ----- Gates ----------------------------------------------------------------------------------------
export type GateStatus = "pass" | "fail" | "pending";

/** pass = all 3 gates yes · fail = any gate no · pending = some not answered yet. */
export function gateStatus(gates: Gates | null | undefined): GateStatus {
  const g = gates ?? {};
  let pending = false;
  for (const { id } of GATES) {
    const v = g[id];
    if (v === false) return "fail";
    if (v !== true) pending = true;
  }
  return pending ? "pending" : "pass";
}

// ----- Ratings --------------------------------------------------------------------------------------
/** A valid 1–10 rating, or null. */
export function cleanRating(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return clamp(Math.round(n), RATING_MIN, RATING_MAX);
}

/** Keeps only known keys with valid values. */
export function cleanRatings(raw: unknown): Ratings {
  const out: Ratings = {};
  if (!raw || typeof raw !== "object") return out;
  for (const { id } of RATINGS) {
    const v = cleanRating((raw as Record<string, unknown>)[id]);
    if (v !== null) out[id] = v;
  }
  return out;
}

/** Weights with defaults for missing / bad values (0 is allowed = ignore that item). */
export function cleanWeights(raw: ScoreWeights | null | undefined): Record<RatingKey | "view_potential", number> {
  const out = { ...DEFAULT_SCORE_WEIGHTS };
  if (!raw) return out;
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

// ----- View potential from saved references ----------------------------------------------------------
export type RefLike = { views: number | null; channel_median: number | null; outlier_score: number | null; is_short?: boolean };

/** views ÷ channel median (the stored score wins when there is one). null = not enough data. */
export function outlierOf(r: RefLike): number | null {
  if (typeof r.outlier_score === "number" && Number.isFinite(r.outlier_score) && r.outlier_score > 0) return r.outlier_score;
  if (r.views && r.channel_median && r.channel_median > 0) return r.views / r.channel_median;
  return null;
}

export function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export type DataScore = {
  /** 1–10, null when no reference has numbers */
  score: number | null;
  /** references with numbers */
  n: number;
  medianOutlier: number | null;
  /** references above the channel's view goal (null = no goal) */
  aboveGoal: number | null;
  /** short explanation for the UI */
  why: string;
};

/**
 * View potential (1–10) from the references saved in the Topic step.
 *  · outlier part: 1× → 1, 3× ≈ 5.3, 10× → 10 (log scale) using the median outlier score
 *  · if there is a view goal: 70% outlier part + 30% share of references above the goal
 */
export function dataScore(refs: RefLike[], viewGoal?: number | null): DataScore {
  const outs = refs.map(outlierOf).filter((n): n is number => n !== null);
  const withViews = refs.filter((r) => typeof r.views === "number" && r.views! >= 0);
  const goal = viewGoal && viewGoal > 0 ? viewGoal : null;
  const above = goal ? withViews.filter((r) => (r.views ?? 0) >= goal).length : null;
  if (!outs.length && !(goal && withViews.length)) {
    return { score: null, n: 0, medianOutlier: null, aboveGoal: above, why: refs.length ? "Add views + channel median to the references to get a score." : "Save some references in the Topic step." };
  }
  const med = median(outs);
  const outPart = med !== null ? clamp(1 + 9 * Math.log10(Math.max(med, 1)), 1, 10) : null;
  const goalPart = goal && withViews.length ? clamp((above! / withViews.length) * 10, 1, 10) : null;
  let score: number;
  if (outPart !== null && goalPart !== null) score = 0.7 * outPart + 0.3 * goalPart;
  else score = (outPart ?? goalPart)!;
  const parts: string[] = [];
  if (med !== null) parts.push(`median outlier ${round1(med)}× of ${outs.length}`);
  if (goal && withViews.length) parts.push(`${above}/${withViews.length} above your goal`);
  return { score: round1(clamp(score, 1, 10)), n: Math.max(outs.length, withViews.length), medianOutlier: med === null ? null : round1(med), aboveGoal: above, why: parts.join(" · ") };
}

// ----- Idea score -----------------------------------------------------------------------------------
export type ScoreBreakdown = { key: RatingKey | "view_potential"; value: number; /** 1–10 after flipping effort */ points: number; weight: number }[];

/**
 * Weighted idea score 0–100 from the 5 ratings (effort flipped: 10 effort → 1 point) and the view
 * potential. Items not rated yet are left out (the weights of the rest count). null = nothing rated.
 */
export function ideaScore(ratings: Ratings | null | undefined, viewPotential: number | null | undefined, weights?: ScoreWeights | null): { score: number | null; parts: ScoreBreakdown } {
  const w = cleanWeights(weights);
  const parts: ScoreBreakdown = [];
  const r = ratings ?? {};
  for (const { id, sign } of RATINGS) {
    const v = cleanRating(r[id]);
    if (v === null) continue;
    parts.push({ key: id, value: v, points: sign < 0 ? RATING_MAX + RATING_MIN - v : v, weight: w[id] });
  }
  const vp = typeof viewPotential === "number" && Number.isFinite(viewPotential) ? clamp(viewPotential, RATING_MIN, RATING_MAX) : null;
  if (vp !== null) parts.push({ key: "view_potential", value: vp, points: vp, weight: w.view_potential });
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (!parts.length || total <= 0) return { score: null, parts };
  const avg = parts.reduce((s, p) => s + p.points * p.weight, 0) / total; // 1–10
  return { score: Math.round(((avg - RATING_MIN) / (RATING_MAX - RATING_MIN)) * 100), parts };
}

// ----- Approve ---------------------------------------------------------------------------------------
export type ApproveCheck = { ok: boolean; reason?: string };

/** Hard gate (a): all 3 gates yes. Already approved videos can't be approved again. */
export function canApprove(v: { stage: YtStage; gates: Gates | null; idea_name: string }): ApproveCheck {
  if (v.stage !== "bank" && v.stage !== "idea") return { ok: false, reason: "Already approved." };
  if (!v.idea_name.trim()) return { ok: false, reason: "Write the idea name first." };
  const g = gateStatus(v.gates);
  if (g === "fail") return { ok: false, reason: "A gate says no — the idea stays in the bank. Change the angle or park it." };
  if (g === "pending") return { ok: false, reason: "Answer the 3 gates first." };
  return { ok: true };
}

// ----- Board helpers --------------------------------------------------------------------------------
export type BoardVideo = {
  id: string;
  stage: YtStage;
  step: IdeaStep;
  kind: "long" | "short";
  idea_name: string;
  topic: string | null;
  formats: string[];
  angles: string[];
  gates: Gates | null;
  ratings: Ratings | null;
  priority: number;
  package_ready: boolean;
  created_at: string;
  stage_changed_at: string;
};

/** Idea bank order: score (priority) high → low, then newest first. */
export function sortBank<T extends Pick<BoardVideo, "priority" | "created_at">>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.created_at.localeCompare(a.created_at));
}

/** One short line: what to do next with this video. */
export function nextStep(v: BoardVideo, extra: { titles?: number; thumbs?: number; cards?: number } = {}): string {
  switch (v.stage) {
    case "bank":
    case "idea": {
      if (!v.topic && !v.idea_name) return "Write the topic";
      if (v.step === "topic") return "Check the topic: save references";
      if (!v.formats.length) return "Pick a format";
      if (!v.angles.length) return "Pick an angle";
      const g = gateStatus(v.gates);
      if (g === "fail") return "Failed a gate — rework or park";
      if (g === "pending") return "Answer the 3 gates";
      if (!Object.keys(v.ratings ?? {}).length) return "Rate the idea";
      return "Approve → Package";
    }
    case "package":
      if (!extra.titles) return "Write titles";
      if (!extra.thumbs) return "Sketch thumbnail concepts";
      if (!v.package_ready) return "Pair + run the final tests";
      return "Package ready → Research";
    case "research":
      return extra.cards ? "Research → start the outline" : "Fill the research buckets";
    case "outline":
      return "Finish the outline (mark the climax)";
    case "script":
      return "Write the script";
    case "shots":
      return "Build the shot list";
    case "filming":
      return "Film the shots";
    case "edit":
      return "Edit: rough cut → passes";
    case "publish":
      return "Publish: metadata, chapters, captions";
    case "published":
      return "Follow-ups at 48 h · 7 · 30 · 90 days";
    default:
      return "Parked";
  }
}

export type WipInfo = { count: number; limit: number; over: boolean; atLimit: boolean };
export function wipStatus(stages: string[], limit: number | null | undefined): WipInfo {
  const lim = limit && limit > 0 ? limit : 3;
  const count = stages.filter((s) => (WIP_STAGES as string[]).includes(s)).length;
  return { count, limit: lim, over: count > lim, atLimit: count === lim };
}

/** Would moving to `to` add one more video to work in progress? (to warn before approving) */
export function addsToWip(from: string, to: string) {
  return !(WIP_STAGES as string[]).includes(from) && (WIP_STAGES as string[]).includes(to);
}

/** Stage after `s` in the pipeline (archived/published have none). */
export function nextStage(s: YtStage): YtStage | null {
  const order: YtStage[] = ["bank", "idea", "package", "research", "outline", "script", "shots", "filming", "edit", "publish", "published"];
  const i = order.indexOf(s);
  return i < 0 || i >= order.length - 1 ? null : order[i + 1];
}
export function prevStage(s: YtStage): YtStage | null {
  const order: YtStage[] = ["bank", "idea", "package", "research", "outline", "script", "shots", "filming", "edit", "publish", "published"];
  const i = order.indexOf(s);
  return i <= 0 ? null : order[i - 1];
}
export const isLater = (a: string, b: string) => stageIndex(a) > stageIndex(b);

// ----- Capture --------------------------------------------------------------------------------------
/**
 * Turns captured text (Telegram, a note, the web box) into { idea_name, topic }.
 * idea_name = first sentence/line, max 120 chars; topic = the whole text (max 1000).
 */
export function ideaFromText(text: string): { idea_name: string; topic: string } | null {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return null;
  const firstLine = t.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine;
  let name = sentence.replace(/\s+/g, " ").trim();
  if (name.length > 120) name = `${name.slice(0, 117).replace(/\s+\S*$/, "")}…`;
  const topic = t.replace(/\s+/g, " ").slice(0, 1000);
  return name ? { idea_name: name, topic } : null;
}

// ----- YouTube links (manual references) ------------------------------------------------------------
/** The 11-char video id of a YouTube link (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** Every distinct YouTube video in a pasted block of text (links separated by spaces / lines). */
export function parseYoutubeLinks(text: string): { yt_id: string; url: string; is_short: boolean }[] {
  const out: { yt_id: string; url: string; is_short: boolean }[] = [];
  const seen = new Set<string>();
  const toks = text.split(/[\s,;]+/).filter(Boolean);
  // A bare 11-character id only counts when the text is nothing but ids (else "programming" would be one).
  const bareOk = toks.every((t) => /youtu/i.test(t) || /^[\w-]{11}$/.test(t));
  for (const tok of toks) {
    if (!/youtu/i.test(tok) && !bareOk) continue;
    const id = youtubeId(tok.replace(/[)\]>.]+$/, ""));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const isShort = /\/shorts\//i.test(tok);
    out.push({ yt_id: id, url: isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, is_short: isShort });
  }
  return out;
}

export const ytThumb = (ytId: string, size: "hq" | "mq" = "hq") => `https://i.ytimg.com/vi/${ytId}/${size}default.jpg`;

/** "12K", "1.2M" */
export function fmtViews(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${round1(n / 1e9)}B`;
  if (n >= 1e6) return `${round1(n / 1e6)}M`;
  if (n >= 1e3) return `${n >= 1e4 ? Math.round(n / 1e3) : round1(n / 1e3)}K`;
  return String(Math.round(n));
}

/** "12,000" / "12k" / "1.2m" / "1,2M" → number; "" → null; bad → NaN */
export function parseCount(s: string | null | undefined): number | null {
  const t = String(s ?? "").trim().toLowerCase().replace(/[\s_]/g, "");
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d+)?)([kmb])?$/.exec(t.replace(/,(?=\d{3}(\D|$))/g, ""));
  if (!m) return NaN;
  const n = Number(m[1].replace(",", "."));
  const mul = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Math.round(n * mul);
}

// ----- Capture (Telegram "yt: …", web box) ------------------------------------------------------------
export type Capture = {
  /** Empty when the message was only links (the bot then uses the first video's title). */
  idea_name: string;
  topic: string;
  kind: "long" | "short";
  links: { yt_id: string; url: string; is_short: boolean }[];
  /** The full text when it is longer than the name (kept as source_quote). */
  quote: string | null;
};

/**
 * Splits a captured idea: "short:" / "#short(s)" → a Short, YouTube links → references, the rest → name + topic.
 * Returns null when nothing is left (empty text).
 */
export function parseCapture(raw: string): Capture | null {
  let t = String(raw ?? "").replace(/\r/g, "").trim().slice(0, 2000);
  if (!t) return null;
  let kind: "long" | "short" = "long";
  const lead = /^shorts?\s*[:\-–]\s*/i.exec(t);
  if (lead) {
    kind = "short";
    t = t.slice(lead[0].length);
  }
  if (/(^|\s)#shorts?\b/i.test(t)) {
    kind = "short";
    t = t.replace(/(^|\s)#shorts?\b/gi, " ");
  }
  const links = parseYoutubeLinks(t);
  const text = t
    .split(/(\s+)/)
    .filter((tok) => !(/youtu/i.test(tok) && youtubeId(tok.replace(/[)\]>.,;]+$/, ""))))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim()
    .replace(/^[,.;:\-–\s]+|[,;:\-–\s]+$/g, "");
  const idea = ideaFromText(text);
  if (!idea && !links.length) return null;
  const name = idea?.idea_name ?? "";
  const topic = idea?.topic ?? "";
  return { idea_name: name, topic, kind, links, quote: topic && topic.length > name.length ? topic : null };
}
