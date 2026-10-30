// Next-word prediction, like a phone keyboard, learned only from what you write (pure; browser,
// server and tests). It counts which word comes after which ("voy al" → "gimnasio") and which words
// you use most, then offers: the end of the word you are typing ("gimn" → "asio"), or, after a space,
// the word you usually write next. Nothing here uses the AI.

export type ModelRow = [ctx: string, next: string, n: number];
export type Model = {
  /** ctx ('' / 'w' / 'w w') → next word → count */
  next: Map<string, Map<string, number>>;
  /** All known words, sorted (for "words starting with…"). */
  words: string[];
  dirty: boolean;
};
export type Prediction = { insert: string; word: string };

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const SEP = "\u0001";
const MIN_NEXT = 2; // a word that came after another only once is not offered yet
const MIN_WORD = 2;

export function emptyModel(): Model {
  return { next: new Map(), words: [], dirty: false };
}

function bump(m: Model, ctx: string, word: string, n: number) {
  let inner = m.next.get(ctx);
  if (!inner) m.next.set(ctx, (inner = new Map()));
  const before = inner.get(word) ?? 0;
  inner.set(word, before + n);
  if (ctx === "" && before === 0) m.dirty = true;
}

function sortWords(m: Model) {
  if (!m.dirty) return;
  m.words = [...(m.next.get("")?.keys() ?? [])].sort();
  m.dirty = false;
}

export function buildModel(rows: ModelRow[]): Model {
  const m = emptyModel();
  for (const [c, w, n] of rows) if (w) bump(m, c, w, Number(n) || 1);
  sortWords(m);
  return m;
}

/** Words of each sentence (lower case; numbers and very long words left out). */
function sentenceWords(text: string): string[][] {
  return text
    .split(/[.!?…\n;:()"“”«»]+/)
    .map((s) => [...s.matchAll(WORD)].map((x) => x[0].toLocaleLowerCase().replace(/’/g, "'")).filter((w) => w.length <= 30));
}

/** What a text teaches: counts by `ctx␁word` (one word, after one word, after two words). */
export function ngramsOf(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
  for (const ws of sentenceWords(text)) {
    for (let i = 0; i < ws.length; i++) {
      add(`${SEP}${ws[i]}`);
      if (i >= 1) add(`${ws[i - 1]}${SEP}${ws[i]}`);
      if (i >= 2) add(`${ws[i - 2]} ${ws[i - 1]}${SEP}${ws[i]}`);
    }
  }
  return out;
}

/** Counts → rows for the database ({c, w, n}). */
export function ngramRows(counts: Map<string, number>) {
  return [...counts].map(([k, n]) => {
    const i = k.indexOf(SEP);
    return { c: k.slice(0, i), w: k.slice(i + 1), n };
  });
}

export function learnInto(m: Model, counts: Map<string, number>) {
  for (const { c, w, n } of ngramRows(counts)) bump(m, c, w, n);
  sortWords(m);
}

const count = (m: Model, ctx: string, w: string) => m.next.get(ctx)?.get(w) ?? 0;

/** Words starting with `p` (binary search in the sorted list). */
function withPrefix(m: Model, p: string, max = 200) {
  const ws = m.words;
  let lo = 0;
  let hi = ws.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ws[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  for (let i = lo; i < ws.length && out.length < max && ws[i].startsWith(p); i++) out.push(ws[i]);
  return out;
}

/**
 * The suggestion for the text right before the cursor, or null.
 * "Mañana voy al gimn" → { insert: "asio", word: "gimnasio" } · "Mañana voy al " → { insert: "gimnasio", … }
 */
export function predict(m: Model, before: string): Prediction | null {
  if (!before || /[\p{N}]$/u.test(before)) return null;
  const tail = before.split(/[.!?…\n;:()"“”«»]/).pop() ?? "";
  const words = [...tail.matchAll(WORD)].map((x) => x[0]);
  const typing = /[\p{L}\p{M}'’]$/u.test(tail);
  const partial = typing ? words.pop() ?? "" : "";
  if (!typing && !/\s$/.test(tail)) return null; // right after a comma etc.: wait for the space
  const prev = words.map((w) => w.toLocaleLowerCase().replace(/’/g, "'"));
  const p1 = prev.at(-1) ?? "";
  const p2 = prev.length >= 2 ? `${prev.at(-2)} ${p1}` : "";

  let best: string | null = null;
  let score = 0;
  if (partial) {
    if (partial.length < 2) return null;
    const low = partial.toLocaleLowerCase().replace(/’/g, "'");
    for (const w of withPrefix(m, low)) {
      if (w.length < low.length + 2) continue; // at least two letters to gain
      const uni = count(m, "", w);
      if (uni < MIN_WORD && !count(m, p1, w)) continue;
      const s = (p2 ? count(m, p2, w) * 50 : 0) + (p1 ? count(m, p1, w) * 10 : 0) + uni;
      if (s > score) (score = s), (best = w);
    }
    if (!best) return null;
    let word = best;
    if (partial[0] !== partial[0].toLocaleLowerCase()) word = word.charAt(0).toLocaleUpperCase() + word.slice(1);
    if (partial === partial.toLocaleUpperCase() && partial.length > 1) word = word.toLocaleUpperCase();
    return { insert: word.slice(partial.length), word };
  }
  if (!p1) return null; // the start of a sentence: nothing to go on
  for (const [ctx, weight] of [
    [p2, 3],
    [p1, 1],
  ] as const) {
    if (!ctx) continue;
    for (const [w, n] of m.next.get(ctx) ?? []) {
      if (n < MIN_NEXT) continue;
      const s = n * weight;
      if (s > score) (score = s), (best = w);
    }
    if (best) break; // two words of context found something: trust it
  }
  return best ? { insert: best, word: best } : null;
}
