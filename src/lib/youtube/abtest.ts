// YouTube add-on (Worker C) — pure logic of A/B testing (three layers, confirmed 4 Nov):
// 1) YouTube's own verdict (Test & compare, logged by hand), 2) before/after swaps at 48 h with equal windows
// and a minimum of impressions, 3) the learning library (attributes of winners and losers).
import type { TestVerdict, VideoMetrics, YtKind, YtTest, YtVariant } from "@/lib/youtube/types";
import type { Baseline } from "@/lib/youtube/baseline";

/** Below this many impressions per window a before/after swap can't name a winner. */
export const MIN_IMPRESSIONS = 1000;
/** Without impressions (Google not connected) we fall back to views per window — and say it is less reliable. */
export const MIN_VIEWS_FALLBACK = 150;
/** Relative change smaller than this = "no clear difference". */
export const CLEAR_DIFFERENCE = 0.1;
/** Suggest a swap at 48 h when the video is below this share of the usual. */
export const SWAP_BELOW = 0.9;
export const SWAP_WINDOW_DAYS = [2, 7] as const;

export type SwapAdvice =
  | { suggest: true; reason: string }
  | { suggest: false; reason: string; blocked?: "test_compare" | "short" | "no_baseline" | "no_alternative" | "fine" };

/** Is there a Test & compare running? (kind test_compare, not ended) — then NOTHING is swapped. */
export function activeTestCompare(tests: Pick<YtTest, "kind" | "ended_at">[]) {
  return tests.some((t) => t.kind === "test_compare" && !t.ended_at);
}
export function openSwap<T extends Pick<YtTest, "kind" | "ended_at">>(tests: T[]): T | null {
  return tests.find((t) => t.kind === "swap" && !t.ended_at) ?? null;
}

/** The 48-hour advice: swap to another pair if the video is below the usual. */
export function swapAdvice(o: { kind: YtKind; views48h: number | null; base: Baseline; tests: Pick<YtTest, "kind" | "ended_at">[]; alternatives: number }): SwapAdvice {
  if (o.kind === "short") return { suggest: false, reason: "Shorts don't use title/thumbnail swaps.", blocked: "short" };
  if (activeTestCompare(o.tests)) return { suggest: false, reason: "A Test & compare is running in Studio — changing the title or thumbnail would stop it. Wait for its verdict.", blocked: "test_compare" };
  if (openSwap(o.tests)) return { suggest: false, reason: "A swap is already being measured.", blocked: "fine" };
  if (o.base.source !== "history" || !o.base.views || o.views48h === null) return { suggest: false, reason: "Not enough past videos to know what is usual at 48 h — decide by feel, or wait for more videos.", blocked: "no_baseline" };
  const r = o.views48h / o.base.views;
  if (r >= SWAP_BELOW) return { suggest: false, reason: `At 48 h it has ${Math.round(r * 100)} % of the usual — no swap needed.`, blocked: "fine" };
  if (o.alternatives < 1) return { suggest: false, reason: `Below the usual (${Math.round(r * 100)} %), but there is no other title + thumbnail pair. Make one in Package.`, blocked: "no_alternative" };
  return { suggest: true, reason: `At 48 h it has ${Math.round(r * 100)} % of the usual views. Try another title + thumbnail pair.` };
}

export type Window = { from: string; to: string };
/**
 * Equal windows around a swap: N days before vs N days after. Analytics reports whole days, so the swap day
 * itself is left out of both. 7-day windows compare the same weekdays; 2-day windows may not.
 */
export function equalWindows(swapAt: string, days: number): { before: Window; after: Window; sameWeekdays: boolean } {
  const d = new Date(swapAt);
  const day = (offset: number) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset));
    return x.toISOString().slice(0, 10);
  };
  return { before: { from: day(-days), to: day(-1) }, after: { from: day(1), to: day(days) }, sameWeekdays: days % 7 === 0 };
}

/** The after-window is complete (plus 2 days for Analytics delay, if impressions are used). */
export function windowReady(after: Window, now: Date, analyticsDelayDays = 2) {
  const end = Date.parse(`${after.to}T23:59:59Z`) + analyticsDelayDays * 86_400_000;
  return now.getTime() >= end;
}

export type SwapJudgement = { verdict: TestVerdict; winner: "before" | "after" | null; reason: string; reliable: boolean; change: number | null };

/**
 * Before/after verdict. With impressions (Google connected): CTR decides, but only with ≥ MIN_IMPRESSIONS in
 * BOTH windows. Without: views per window (≥ MIN_VIEWS_FALLBACK), marked less reliable.
 */
export function judgeSwap(before: VideoMetrics, after: VideoMetrics, minImpressions = MIN_IMPRESSIONS): SwapJudgement {
  const hasImp = before.impressions !== undefined && after.impressions !== undefined && before.ctr !== undefined && after.ctr !== undefined;
  if (hasImp) {
    if ((before.impressions ?? 0) < minImpressions || (after.impressions ?? 0) < minImpressions)
      return { verdict: "inconclusive", winner: null, reliable: true, change: null, reason: `Fewer than ${minImpressions.toLocaleString("en-US")} impressions in a window — not enough to decide.` };
    const change = before.ctr! > 0 ? (after.ctr! - before.ctr!) / before.ctr! : null;
    if (change === null) return { verdict: "inconclusive", winner: null, reliable: true, change, reason: "CTR before was 0." };
    if (Math.abs(change) < CLEAR_DIFFERENCE) return { verdict: "no_clear_difference", winner: null, reliable: true, change, reason: `CTR changed ${pct(change)} — smaller than ${Math.round(CLEAR_DIFFERENCE * 100)} %.` };
    return { verdict: "winner", winner: change > 0 ? "after" : "before", reliable: true, change, reason: `CTR ${pct(change)} (${round1(before.ctr!)} % → ${round1(after.ctr!)} %).` };
  }
  const b = before.views;
  const a = after.views;
  if (b === undefined || a === undefined) return { verdict: "inconclusive", winner: null, reliable: false, change: null, reason: "Missing views for one of the windows." };
  if (b < MIN_VIEWS_FALLBACK || a < MIN_VIEWS_FALLBACK) return { verdict: "inconclusive", winner: null, reliable: false, change: null, reason: `Fewer than ${MIN_VIEWS_FALLBACK} views in a window — not enough to decide.` };
  const change = (a - b) / b;
  // Views usually fall day after day, so "after" needs a clearly bigger jump to count.
  if (Math.abs(change) < CLEAR_DIFFERENCE * 2) return { verdict: "no_clear_difference", winner: null, reliable: false, change, reason: `Views changed ${pct(change)} — too small to tell without impressions/CTR (connect Google for a better test).` };
  return { verdict: "winner", winner: change > 0 ? "after" : "before", reliable: false, change, reason: `Views ${pct(change)} (${b} → ${a}). Less reliable without CTR — connect Google.` };
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)} %`;

// ----- Learning library ------------------------------------------------------------------------------
/** Attributes of a title (style) for the library. */
export function titleAttrs(title: string): string[] {
  const t = title.trim();
  const out: string[] = [];
  if (!t) return out;
  if (/\?\s*$/.test(t) || /^(how|why|what|which|who|is|can|should|does|do|cómo|por qué|qué)\b/i.test(t)) out.push("question");
  if (/\d/.test(t)) out.push("number");
  if (/^(i|i'm|i've|my)\b/i.test(t) || /^(yo|mi|me)\b/i.test(t)) out.push("first person");
  if (/\b(vs\.?|versus)\b/i.test(t)) out.push("versus");
  if (/[$€£]|\bmoney\b|\bdollars?\b/i.test(t)) out.push("money");
  if (/\b(never|don't|stop|mistake|wrong|worst)\b/i.test(t)) out.push("negative");
  if (/[A-Z]{3,}/.test(t.replace(/\b(ESL|AI|API|OS|USA|UK|PC|TV|YT)\b/g, ""))) out.push("caps word");
  out.push(t.length <= 40 ? "short title (≤40)" : t.length <= 60 ? "medium title (41–60)" : "long title (60+)");
  return out;
}

/** Attributes of a thumbnail concept (yt_variants kind thumbnail). */
export function thumbAttrs(v: Pick<YtVariant, "gap_type" | "stoppers" | "thumb_text" | "composition" | "contrast" | "attrs">): string[] {
  const out: string[] = [];
  if (v.gap_type) out.push(`gap: ${v.gap_type}`);
  for (const s of v.stoppers ?? []) out.push(`stopper: ${s.replace(/_/g, " ")}`);
  out.push((v.stoppers ?? []).includes("faces") || v.attrs?.face === true ? "face" : "no face");
  out.push(v.thumb_text && v.thumb_text.trim() ? "text on thumbnail" : "no text on thumbnail");
  if (v.composition) out.push(`composition: ${v.composition.toLowerCase()}`);
  for (const c of v.contrast ?? []) out.push(`contrast: ${c}`);
  for (const [k, val] of Object.entries(v.attrs ?? {})) if (k !== "face" && (typeof val === "string" || val === true)) out.push(val === true ? k : `${k}: ${val}`);
  return out;
}

export type PairAttrs = { pairId: string; label: string; title: string; attrs: string[] };
export type LearningRow = { testId: string; videoId: string; kind: "test_compare" | "swap"; verdict: TestVerdict; winner: PairAttrs | null; losers: PairAttrs[]; at: string; angles?: string[] };
export type AttrScore = { attr: string; wins: number; losses: number; ties: number; tests: number; winRate: number | null };

/** Wins / losses per attribute across all decided tests (only "winner" verdicts count as win/loss; "same" etc. count as ties). */
export function learningTable(rows: LearningRow[]): AttrScore[] {
  const m = new Map<string, AttrScore>();
  const get = (a: string) => m.get(a) ?? (m.set(a, { attr: a, wins: 0, losses: 0, ties: 0, tests: 0, winRate: null }), m.get(a)!);
  for (const r of rows) {
    const winAttrs = new Set(r.winner?.attrs ?? []);
    const loseAttrs = new Set(r.losers.flatMap((l) => l.attrs));
    if (r.verdict === "winner" && r.winner) {
      // Only attributes that DIFFER between winner and losers teach something.
      for (const a of winAttrs) if (!r.losers.every((l) => l.attrs.includes(a))) get(a).wins++;
      for (const a of loseAttrs) if (!winAttrs.has(a)) get(a).losses++;
    } else {
      for (const a of new Set([...winAttrs, ...loseAttrs])) get(a).ties++;
    }
    for (const a of new Set([...winAttrs, ...loseAttrs])) get(a).tests++;
  }
  for (const s of m.values()) s.winRate = s.wins + s.losses ? Math.round((s.wins / (s.wins + s.losses)) * 100) / 100 : null;
  return [...m.values()].sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.tests - a.tests || a.attr.localeCompare(b.attr));
}

/** One-line lesson for the weekly review / post-mortem ("text on thumbnail: 3 wins, 1 loss"). */
export function topLessons(table: AttrScore[], n = 3): string[] {
  return table
    .filter((s) => s.wins + s.losses >= 2)
    .slice(0, n)
    .map((s) => `${s.attr}: ${s.wins} win${s.wins === 1 ? "" : "s"}, ${s.losses} loss${s.losses === 1 ? "" : "es"}`);
}
