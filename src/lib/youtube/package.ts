// YouTube add-on (Worker A) — pure logic of the Package step: title helpers and warnings, thumbnail
// warnings, title + thumbnail pairs and "package ready". No I/O: tested in scripts/test-youtube-a.ts.
import { MAX_STOPPERS, MAX_THUMBNAILS, MAX_TITLES, PAIR_LABELS, THUMB_TESTS, TITLE_CUT_WARNING, TITLE_FIRST_WORDS, TITLE_SOFT_LIMIT } from "@/lib/youtube/constants";
import type { ThumbTests } from "@/lib/youtube/types";

// ----- Words ----------------------------------------------------------------------------------------
const STOP = new Set(
  "a an the and or but of to in on at for with by from is are was were be been it its this that these those i my me you your we our how what why when who which do does did i'm im vs x el la los las un una unos unas y o de del en con por para que es son mi mis tu tus se lo le como".split(" "),
);
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Meaningful words (lowercase, no accents, no stop words). */
export function words(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}$%]+/u)
    .filter((w) => w && !STOP.has(w));
}
/** Jaccard similarity of meaningful words, 0–1. */
export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
/** Share of `part`'s meaningful words that also appear in `whole` (0–1). */
export function containment(part: string, whole: string): number {
  const P = words(part);
  if (!P.length) return 0;
  const W = new Set(words(whole));
  return P.filter((w) => W.has(w)).length / P.length;
}

// ----- Titles ---------------------------------------------------------------------------------------
/** The first N words (they must carry the idea) and the rest — for highlighting. */
export function splitFirstWords(title: string, n = TITLE_FIRST_WORDS): { head: string; tail: string } {
  const m = new RegExp(`^(\\s*(?:\\S+\\s+){0,${Math.max(0, n - 1)}}\\S+)([\\s\\S]*)$`).exec(title);
  if (!m) return { head: title, tail: "" };
  return { head: m[1], tail: m[2] };
}

export type TitleWarning = { kind: "empty" | "long" | "cut" | "repeats_thumb" | "like_idea" | "duplicate" | "caps"; level: "info" | "warn"; text: string };

/**
 * Warnings (never blocks) for one title:
 *  long > 60 (may be cut on some screens) · cut > 70 · repeats the thumbnail text · almost the same as the
 *  idea name ("is it boring?") · same as another title · ALL CAPS.
 */
export function titleWarnings(title: string, ctx: { ideaName?: string; thumbTexts?: (string | null | undefined)[]; otherTitles?: string[] } = {}): TitleWarning[] {
  const t = title.trim();
  const out: TitleWarning[] = [];
  if (!t) return [{ kind: "empty", level: "info", text: "Write a title." }];
  const len = [...t].length;
  if (len > TITLE_CUT_WARNING) out.push({ kind: "cut", level: "warn", text: `${len} characters — it will be cut on most screens (keep the idea in the first ${TITLE_SOFT_LIMIT}).` });
  else if (len > TITLE_SOFT_LIMIT) out.push({ kind: "long", level: "info", text: `${len} characters — may be cut on phones.` });
  for (const tt of ctx.thumbTexts ?? []) {
    if (!tt || !tt.trim()) continue;
    if (containment(tt, t) >= 0.6 || fold(t).includes(fold(tt.trim()))) {
      out.push({ kind: "repeats_thumb", level: "warn", text: `Repeats the thumbnail text “${tt.trim()}” — let each one add a different part of the curiosity gap.` });
      break;
    }
  }
  if (ctx.ideaName && (similarity(t, ctx.ideaName) >= 0.7 || fold(t).trim() === fold(ctx.ideaName).trim())) {
    out.push({ kind: "like_idea", level: "warn", text: "Almost the same as the idea name — is it boring? Make it pull the viewer in." });
  }
  if ((ctx.otherTitles ?? []).some((o) => o.trim() && fold(o.trim()) === fold(t))) out.push({ kind: "duplicate", level: "warn", text: "Same as another title." });
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 12 && letters === letters.toUpperCase()) out.push({ kind: "caps", level: "info", text: "ALL CAPS reads as shouting — use caps for one word at most." });
  return out;
}

/** Title as the sidebar shows it (cut with … at about `max` characters). */
export function previewTitle(title: string, max: number): string {
  const chars = [...title.trim()];
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max - 1).join("").replace(/\s+\S*$/, "")}…`;
}

// ----- Thumbnails -----------------------------------------------------------------------------------
export type ThumbWarning = { level: "info" | "warn"; text: string };
export function thumbWarnings(t: { stoppers?: string[] | null; thumb_text?: string | null; focal?: string | null; gap_type?: string | null }): ThumbWarning[] {
  const out: ThumbWarning[] = [];
  const n = (t.stoppers ?? []).length;
  if (n > MAX_STOPPERS + 1) out.push({ level: "warn", text: `${n} scroll stoppers — too many dilutes the thumbnail. Keep 2–3.` });
  else if (n === MAX_STOPPERS + 1) out.push({ level: "info", text: "3 scroll stoppers — that's the most that still reads clearly." });
  const words = (t.thumb_text ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words > 4) out.push({ level: "warn", text: `${words} words of text — thumbnails read best with 1–4 words.` });
  if (!t.gap_type) out.push({ level: "info", text: "Pick the curiosity-gap type." });
  if (!(t.focal ?? "").trim()) out.push({ level: "info", text: "Describe the focal point (main character)." });
  return out;
}

/** Tests passed (Bonus is automatic: ≥ 3 variations). */
export function thumbTestsPassed(tests: ThumbTests | null | undefined, variations: number): { passed: number; total: number; missing: string[] } {
  const missing: string[] = [];
  for (const t of THUMB_TESTS) {
    const ok = t.id === "bonus" ? variations >= 3 || !!tests?.bonus : !!tests?.[t.id];
    if (!ok) missing.push(t.label);
  }
  return { passed: THUMB_TESTS.length - missing.length, total: THUMB_TESTS.length, missing };
}

// ----- Pairs ----------------------------------------------------------------------------------------
export function nextPairLabel(used: string[]): string | null {
  return PAIR_LABELS.find((l) => !used.includes(l)) ?? null;
}

/** Default pairs when none exist: title i + thumbnail i (A, B, C), only where both exist. */
export function suggestPairs(titleIds: string[], thumbIds: string[]): { label: string; title_id: string; thumbnail_id: string }[] {
  const n = Math.min(titleIds.length, thumbIds.length, MAX_TITLES, MAX_THUMBNAILS);
  return Array.from({ length: n }, (_, i) => ({ label: PAIR_LABELS[i], title_id: titleIds[i], thumbnail_id: thumbIds[i] }));
}

// ----- Ready ----------------------------------------------------------------------------------------
export type ReadyInput = {
  gapKnown: string | null;
  gapWant: string | null;
  titles: { id: string; value: string }[];
  thumbs: { id: string; tests: ThumbTests | null; image_url?: string | null }[];
  pairs: { title_id: string | null; thumbnail_id: string | null; is_primary: boolean }[];
};
/** What is still missing before the package is "ready" (empty list = ready). Never blocks moving on. */
export function packageMissing(p: ReadyInput): string[] {
  const out: string[] = [];
  if (!(p.gapKnown ?? "").trim() || !(p.gapWant ?? "").trim()) out.push("Curiosity gap (what they know / want to know)");
  if (!p.titles.some((t) => t.value.trim())) out.push("At least 1 title");
  if (!p.thumbs.length) out.push("At least 1 thumbnail concept");
  const full = p.pairs.filter((x) => x.title_id && x.thumbnail_id);
  if (!full.length) out.push("A title + thumbnail pair");
  else if (!full.some((x) => x.is_primary)) out.push("Choose the primary pair");
  const primary = p.pairs.find((x) => x.is_primary && x.thumbnail_id);
  const thumb = primary ? p.thumbs.find((t) => t.id === primary.thumbnail_id) : null;
  if (thumb) {
    const r = thumbTestsPassed(thumb.tests, p.thumbs.length);
    const core = r.missing.filter((m) => m !== "Bonus");
    if (core.length) out.push(`Final tests of the primary thumbnail: ${core.join(", ")}`);
  }
  return out;
}

/** "yes" if bonus-only missing (3 variations are nice, not required). */
export function packageReadyHint(p: ReadyInput): { ready: boolean; missing: string[]; bonus: boolean } {
  const missing = packageMissing(p);
  return { ready: missing.length === 0, missing, bonus: p.thumbs.length >= 3 && p.titles.length >= 3 };
}

// ----- Images ---------------------------------------------------------------------------------------
/** Size to draw an image into so it fits inside max W×H, keeping its shape (never upscales). */
export function fitInside(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const s = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** http(s) image link or an app file (/api/files/…) — anything else is refused. */
export function isImageUrl(u: string): boolean {
  const s = u.trim();
  if (s.startsWith("/api/files/")) return true;
  try {
    const x = new URL(s);
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}
