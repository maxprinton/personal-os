// Search engine — pure pieces shared by the server, the browser and the tests:
// folding text (case + accents), reading what you typed (words, "phrases", OR, -not) into full-text
// queries for Postgres, and cutting a snippet with the matches marked.

const MARKS = /[̀-ͯ]/g;

/** One character, lowercase and without accent ("Ó" → "o"). Keeps the length (for highlight positions). */
function foldChar(c: string): string {
  const f = c.normalize("NFD").replace(MARKS, "").toLowerCase();
  return f.length === 1 ? f : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
}

/** Lowercase, no accents, same length as the input (character by character). */
export function foldKeep(s: string): string {
  let out = "";
  for (const c of s) out += foldChar(c).length === c.length ? foldChar(c) : c;
  return out;
}

/** Lowercase, no accents (may change the length; for comparing words). */
export const fold = (s: string) => s.normalize("NFD").replace(MARKS, "").toLowerCase();

/** The words of a text as the index sees them: letters and digits only. */
export const wordsOf = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

export type ParsedQuery = {
  /** One tsquery per word / phrase / OR-group: each must match somewhere in the note. */
  terms: string[];
  /** tsqueries that must not match anywhere in the note. */
  not: string[];
  /** Words to highlight (folded), each matched as the start of a word. */
  words: string[];
  /** Plain words only (no phrases / OR / -not): a typo suggestion can replace them one by one. */
  simple: string[] | null;
};

const MAX_TERMS = 12;

/** "w" → "w:*" (start of a word); single letters and pure numbers stay exact. */
const pref = (w: string) => (w.length >= 2 && !/^\d+$/.test(w) ? `${w}:*` : w);

/** Several words that must come one after another ("user_id", "present perfect"). */
const seq = (ws: string[], prefixLast: boolean) => ws.map((w, i) => (i === ws.length - 1 && prefixLast ? pref(w) : w)).join(" <-> ");

/**
 * What you typed → full-text queries. Words: every one must be in the note (start of a word, accents and
 * case ignored). "exact phrase" · a OR b · -word (not). Anything else is ignored, so the result is always
 * a valid tsquery (only a–z, 0–9 and operators).
 */
export function parseQuery(input: string): ParsedQuery {
  const tokens: { neg: boolean; phrase: boolean; text: string }[] = [];
  const re = /(-?)"([^"]*)"?|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input ?? "")) && tokens.length < 40) {
    if (m[2] !== undefined) tokens.push({ neg: m[1] === "-", phrase: true, text: m[2] });
    else {
      const raw = m[3];
      const neg = raw.startsWith("-") && raw.length > 1;
      tokens.push({ neg, phrase: false, text: neg ? raw.slice(1) : raw });
    }
  }
  const groups: string[][] = []; // OR-groups of single tsquery pieces
  const not: string[] = [];
  const words: string[] = [];
  let simple = true;
  let joinNext = false;
  for (const t of tokens) {
    if (!t.phrase && !t.neg && t.text === "OR") {
      if (groups.length) joinNext = true;
      simple = false;
      continue;
    }
    const ws = wordsOf(t.text);
    if (!ws.length) continue;
    const q = ws.length === 1 ? (t.phrase ? ws[0] : pref(ws[0])) : seq(ws, !t.phrase);
    if (t.neg) {
      not.push(ws.length === 1 ? ws[0] : seq(ws, false));
      simple = false;
      joinNext = false;
      continue;
    }
    if (t.phrase || ws.length > 1) simple = false;
    words.push(...ws);
    if (joinNext && groups.length) groups[groups.length - 1].push(q);
    else groups.push([q]);
    joinNext = false;
  }
  const terms = groups.slice(0, MAX_TERMS).map((g) => (g.length === 1 ? g[0] : `(${g.map((x) => `(${x})`).join(" | ")})`));
  return { terms, not: not.slice(0, MAX_TERMS), words: [...new Set(words)], simple: simple ? [...new Set(words)] : null };
}

export type Snippet = { text: string; marks: [number, number][] };

/** Where the words appear in a text (start of a word, accents / case ignored): [start, end) ranges. */
export function findMatches(text: string, words: string[]): [number, number][] {
  if (!text || !words.length) return [];
  const f = foldKeep(text);
  const out: [number, number][] = [];
  for (const w of words) {
    if (!w) continue;
    let i = f.indexOf(w);
    while (i >= 0) {
      const before = i === 0 ? "" : f[i - 1];
      if (!before || !/[a-z0-9]/.test(before)) {
        let end = i + w.length;
        while (end < f.length && /[a-z0-9]/.test(f[end])) end++; // mark the whole word ("reun" → "reunión")
        out.push([i, end]);
      }
      i = f.indexOf(w, i + 1);
    }
  }
  out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** A short piece of the text around the best group of matches, with the matches marked. */
export function makeSnippet(text: string, words: string[], size = 220): Snippet {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  const all = findMatches(clean, words);
  if (!all.length) return { text: clean.length > size ? `${clean.slice(0, size).trimEnd()}…` : clean, marks: [] };
  // The window that holds the most different words
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < all.length; i++) {
    const end = all[i][0] + size * 0.8;
    const seen = new Set<string>();
    for (let j = i; j < all.length && all[j][0] < end; j++) seen.add(foldKeep(clean.slice(all[j][0], all[j][1])));
    if (seen.size > bestScore) {
      bestScore = seen.size;
      best = i;
    }
  }
  let start = Math.max(0, all[best][0] - 60);
  if (start > 0) {
    const sp = clean.lastIndexOf(" ", start + 10);
    start = sp > start - 20 && sp >= 0 ? sp + 1 : start;
  }
  let end = Math.min(clean.length, start + size);
  if (end < clean.length) {
    const sp = clean.indexOf(" ", end - 10);
    end = sp > 0 && sp < end + 20 ? sp : end;
  }
  const pre = start > 0 ? "…" : "";
  const post = end < clean.length ? "…" : "";
  const marks = all
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a - start + pre.length, b - start + pre.length] as [number, number]);
  return { text: `${pre}${clean.slice(start, end)}${post}`, marks };
}

/** "getUserName" → "get user name"; "HTTPServer2" → "http server 2" (searchable parts of code words). */
export function splitIdentifiers(text: string): string {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    const w = m[0];
    if (!/[a-z][A-Z]|[A-Z]{2}[a-z]|[A-Za-z]\d|\d[A-Za-z]/.test(w)) continue;
    const parts = w
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2")
      .toLowerCase()
      .split(" ");
    if (parts.length > 1) out.add(parts.join(" "));
  }
  return [...out].join(" ");
}

/** "1.500", "2,000,000" → "1500 2000000" (numbers findable without separators). */
export function plainNumbers(text: string): string {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?/g)) out.add(m[0].replace(/[.,\s]/g, ""));
  return [...out].join(" ");
}
