// YouTube add-on — teleprompter logic (pure; Worker B). The page scrolls at the speaking speed:
// pixels per second = (words per second ÷ words per line) × line height.
import { paragraphs } from "@/lib/youtube/outline";

export type PrompterSectionIn = { id: string; code: string; title: string; content: string };
export type PrompterBlock = { sectionId: string; heading: string; paragraphs: { text: string; hash: string }[] };

/**
 * What the prompter shows: every section (or one with `sectionId`), Source blocks removed. With `onlyHashes`
 * (paragraphs of the shots of one filming setup) only those paragraphs are kept.
 */
export function prompterBlocks(sections: PrompterSectionIn[], opts: { sectionId?: string | null; onlyHashes?: Set<string> | null } = {}): PrompterBlock[] {
  return sections
    .filter((s) => !opts.sectionId || s.id === opts.sectionId)
    .map((s) => ({
      sectionId: s.id,
      heading: `${s.code} · ${s.title || "Untitled"}`,
      paragraphs: paragraphs(s.content)
        .filter((p) => !opts.onlyHashes || opts.onlyHashes.has(p.hash))
        .map((p) => ({ text: p.text, hash: p.hash })),
    }))
    .filter((b) => b.paragraphs.length > 0);
}

export const PROMPTER_LIMITS = { minWpm: 60, maxWpm: 260, minFont: 24, maxFont: 96 } as const;
export const clampWpm = (w: number) => Math.round(Math.min(PROMPTER_LIMITS.maxWpm, Math.max(PROMPTER_LIMITS.minWpm, Number(w) || 150)));
export const clampFont = (f: number) => Math.round(Math.min(PROMPTER_LIMITS.maxFont, Math.max(PROMPTER_LIMITS.minFont, Number(f) || 48)));

/** Average words that fit on one line: text width ÷ (font × 0.5 per char) ÷ 6 chars per word (incl. space). */
export function wordsPerLine(widthPx: number, fontPx: number): number {
  const chars = Math.max(8, widthPx / Math.max(8, fontPx * 0.5));
  return Math.max(1, chars / 6);
}

/** Scroll speed in px/s for a speaking speed (wpm), font size and line height (× font). */
export function scrollSpeed(wpm: number, fontPx: number, widthPx: number, lineHeight = 1.4): number {
  const wps = clampWpm(wpm) / 60;
  return (wps / wordsPerLine(widthPx, fontPx)) * fontPx * lineHeight;
}

/** Seconds left to read `words` at `wpm`. */
export const secondsLeft = (words: number, wpm: number) => Math.round((Math.max(0, words) / clampWpm(wpm)) * 60);
