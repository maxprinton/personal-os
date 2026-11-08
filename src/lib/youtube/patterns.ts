// YouTube add-on — what the saved outliers have in common (pure, no network, no AI call).
// Reads the TITLES (and scores) of a video's outlier references and writes a few plain facts such as
// "5 of 8 titles contain a number". The AI title/idea buttons receive these lines, so "from outlier patterns"
// is based on counted facts instead of the model guessing. Needs at least MIN_PATTERN_TITLES titles.
export const MIN_PATTERN_TITLES = 3;

export type PatternRef = { title: string; outlier_score?: number | null };

const STAKES = /\b(vs\.?|versus|worst|best|never|always|only|free|cheap|\$\s?\d|\d+\s?(days?|hours?|weeks?|months?|years?)|mistakes?|truth|secret|why|stop)\b/i;
const YOU = /\b(you|your|you're|youre)\b/i;
const FIRST_PERSON = /^(i|my|we|our)\b|\b(i|my)\b/i;
const HOW = /^how\b/i;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const medianOf = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type TitlePatterns = { n: number; lines: string[] };

/** Counted facts about the titles. `lines` is empty when there are too few titles to say anything. */
export function titlePatterns(refs: PatternRef[]): TitlePatterns {
  const titles = refs.map((r) => (r.title ?? "").trim()).filter(Boolean);
  const n = titles.length;
  if (n < MIN_PATTERN_TITLES) return { n, lines: [] };
  const count = (f: (t: string) => boolean) => titles.filter(f).length;
  const lines: string[] = [];
  const add = (c: number, what: string) => {
    // a pattern is worth mentioning when at least 40% of the titles (and 2+) share it
    if (c >= 2 && c / n >= 0.4) lines.push(`${c} of ${n} titles ${what}`);
  };
  add(count((t) => /\d/.test(t)), "contain a number");
  add(count((t) => /\?/.test(t)), "are questions");
  add(count((t) => HOW.test(t)), 'start with "How"');
  add(count((t) => FIRST_PERSON.test(t)), 'speak in the first person ("I", "my")');
  add(count((t) => YOU.test(t)), 'speak to the viewer ("you", "your")');
  add(count((t) => STAKES.test(t)), "carry stakes, a comparison, a time span or money");
  add(count((t) => /[:|–—-]\s/.test(t)), "use a colon or dash to split the title in two");
  add(count((t) => /\b[A-Z]{3,}\b/.test(t)), "include an ALL-CAPS word");
  const len = medianOf(titles.map((t) => t.length));
  const wc = medianOf(titles.map((t) => words(t).length));
  lines.push(`typical length: ${Math.round(len)} characters, ${Math.round(wc)} words`);
  const firstWords = new Map<string, number>();
  for (const t of titles) {
    const w = words(t)[0]?.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (w && w.length > 1) firstWords.set(w, (firstWords.get(w) ?? 0) + 1);
  }
  const top = [...firstWords.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2 && top[1] / n >= 0.4) lines.push(`${top[1]} of ${n} titles open with "${top[0]}"`);
  return { n, lines };
}

/** The block added to an AI prompt ("" when there is nothing to say). */
export function patternPrompt(refs: PatternRef[]): string {
  const { lines } = titlePatterns(refs);
  if (!lines.length) return "";
  return `What the outlier titles have in common (counted, use as evidence, do not copy their wording):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
