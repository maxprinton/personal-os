// The local writing checker (pure, no network): spelling in Spanish (Mexico) and English (US), plus
// repeated words, spaces, a capital letter to start a sentence, "i" → "I", and the opening ¿ ¡ in Spanish.
// Runs in a Web Worker in the browser (worker.ts) and in the tests with fake dictionaries.
//
// Never marked: words in CAPITALS, words with digits, capitalized words in the middle of a sentence
// (names), words you added (glossary, note / block / tag names), URLs, emails, @mentions, #tags and
// anything masked by the caller (code, links, chips).
import { MASK, type CheckResult, type Issue, type Lang, type Speller } from "@/lib/writing/types";

export type CheckOptions = {
  es?: Speller | null;
  en?: Speller | null;
  /** Words never marked (lower case): glossary + names of notes, blocks and tags. */
  known?: Set<string>;
  /** Words ignored here (lower case). */
  ignore?: Set<string>;
  /** Language of the text before this one (for short, unclear sentences). */
  prevLang?: Lang;
  /** At most this many spelling suggestions are computed (they are the slow part). */
  maxSuggest?: number;
};

const LETTER = /[\p{L}\p{M}]/u;
const WORD = /[\p{L}\p{M}\p{N}_]+(?:['’-][\p{L}\p{M}\p{N}_]+)*/gu;
const NOT_CHECKED = [
  /\bhttps?:\/\/\S+/giu, // URLs
  /\bwww\.\S+/giu,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, // emails
  /(?<![\p{L}\p{N}])[@#][\p{L}\p{N}_-]+/gu, // @mentions, #tags
];

const ES_STOP = new Set("de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas".split(" "));
const EN_STOP = new Set("the of and to in is you that it he was for on are as with his they i at be this have from or one had by but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first been call who its now find long down day did get come made may part".split(" "));
// "had had", "that that" are fine in English
const REPEAT_OK = new Set(["had", "that", "is", "nos", "le", "lo"]);
const ABBREV = /(?:^|[\s(])(?:etc|ej|e\.g|i\.e|vs|aprox|sr|sra|srta|dr|dra|ing|lic|pág|pag|núm|num|no|art|cap|fig|min|máx|max|mr|mrs|ms|st|jr|approx|dept|est|inc|ltd|p\.\s?ej)\.\s*$/i;

const isUpperWord = (w: string) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
const hasDigit = (w: string) => /\p{N}/u.test(w);
const lower = (w: string) => w.toLocaleLowerCase();
const capitalize = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1);
const stripApos = (w: string) => w.replace(/’/g, "'");

/** A copy of the text where URLs, emails, @mentions and #tags are masked (same length, same offsets). */
export function maskText(text: string) {
  let out = text;
  for (const re of NOT_CHECKED) out = out.replace(re, (m) => MASK.repeat(m.length));
  return out;
}

type Word = { text: string; from: number; to: number; start: boolean };
type Sentence = { from: number; to: number; words: Word[]; end: string };

/** Sentences (split at . ! ? … and line breaks) with their words and whether each word starts it. */
export function sentences(masked: string): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  const push = (to: number, end: string) => {
    if (to > from) out.push({ from, to, words: [], end });
    from = to;
  };
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "\n") push(i + 1, "\n");
    else if (c === "." || c === "!" || c === "?" || c === "…") {
      let j = i;
      while (j + 1 < masked.length && /[.!?…"”’)\]»]/.test(masked[j + 1])) j++;
      // a dot inside a number or an abbreviation is not an end
      if (c === "." && j === i && (/\p{N}/u.test(masked[i + 1] ?? "") || ABBREV.test(masked.slice(Math.max(0, i - 12), i + 1)))) continue;
      push(j + 1, masked.slice(i, j + 1));
      i = j;
    }
  }
  push(masked.length, "");
  for (const s of out) {
    let first = true;
    for (const m of masked.slice(s.from, s.to).matchAll(WORD)) {
      const w = { text: m[0], from: s.from + (m.index ?? 0), to: s.from + (m.index ?? 0) + m[0].length, start: first };
      first = false;
      s.words.push(w);
    }
  }
  return out;
}

function langOf(words: Word[], o: CheckOptions): Lang {
  let es = 0;
  let en = 0;
  for (const w of words) {
    const l = lower(w.text);
    if (ES_STOP.has(l)) es += 2;
    if (EN_STOP.has(l)) en += 2;
    if (/[ñáéíóú¿¡]/i.test(w.text)) es += 2;
    if (l.length > 2 && !hasDigit(l)) {
      if (o.es?.correct(l)) es += 1;
      if (o.en?.correct(stripApos(l))) en += 1;
    }
  }
  if (es === en) return o.prevLang ?? (o.es ? "es" : "en");
  return es > en ? "es" : "en";
}

function correctIn(sp: Speller | null | undefined, w: string) {
  if (!sp) return false;
  const v = stripApos(w);
  return sp.correct(v) || sp.correct(lower(v)) || sp.correct(capitalize(lower(v)));
}

/** Suggestions for one misspelled word (asked when its menu opens: nspell's suggest is slow). */
export function suggestWord(word: string, lang: Lang, o: Pick<CheckOptions, "es" | "en">, atStart = false): string[] {
  const main = lang === "es" ? o.es : o.en;
  const other = lang === "es" ? o.en : o.es;
  const fromMain = main?.suggest(word) ?? [];
  let out = (fromMain.length ? fromMain : other?.suggest(word) ?? []).slice(0, 4);
  if (atStart || word[0] !== word[0].toLocaleLowerCase()) out = out.map(capitalize);
  return [...new Set(out)];
}

/** Checks one text (a paragraph). Offsets in the result are offsets in `text`. */
export function checkText(text: string, o: CheckOptions = {}): CheckResult {
  const masked = maskText(text);
  const list = sentences(masked);
  const issues: Issue[] = [];
  const known = o.known ?? new Set<string>();
  const ignore = o.ignore ?? new Set<string>();
  const skip = (w: string) => known.has(lower(w)) || ignore.has(lower(w));
  let budget = o.maxSuggest ?? 30;
  let prev: Lang | undefined = o.prevLang;
  const langs: Lang[] = [];

  for (const s of list) {
    const lang = langOf(s.words, { ...o, prevLang: prev });
    prev = lang;
    langs.push(lang);
    const main = lang === "es" ? o.es : o.en;
    const other = lang === "es" ? o.en : o.es;

    for (let k = 0; k < s.words.length; k++) {
      const w = s.words[k];
      const t = w.text;
      // ---- spelling
      const letters = LETTER.test(t);
      const checkable = letters && !hasDigit(t) && !isUpperWord(t) && !(t !== lower(t) && !w.start) && t.length > 1 && !skip(t);
      if (checkable && (main || other)) {
        // a hyphenated word is fine when each part is
        const parts = t.split("-");
        const ok = correctIn(main, t) || correctIn(other, t) || (parts.length > 1 && parts.every((p) => !p || correctIn(main, p) || correctIn(other, p) || skip(p)));
        if (!ok) {
          let suggestions: string[] = [];
          if (budget > 0) {
            budget--;
            const fromMain = main?.suggest(t) ?? [];
            suggestions = (fromMain.length ? fromMain : other?.suggest(t) ?? []).slice(0, 4);
            if (w.start) suggestions = suggestions.map((x) => (t[0] === t[0].toLocaleUpperCase() ? capitalize(x) : x));
          }
          issues.push({ from: w.from, to: w.to, kind: "spelling", word: t, message: "Possible spelling mistake", suggestions: [...new Set(suggestions)], lang });
        }
      }
      // ---- the same word twice ("el el", "the the")
      const next = s.words[k + 1];
      if (next && lower(next.text) === lower(t) && letters && !REPEAT_OK.has(lower(t)) && /^\s+$/.test(masked.slice(w.to, next.from))) {
        issues.push({ from: w.to, to: next.to, kind: "repeat", word: text.slice(w.to, next.to), message: `Repeated word “${t}”`, suggestions: [""] });
      }
      // ---- "i" alone in English
      if (lang === "en" && t === "i") issues.push({ from: w.from, to: w.to, kind: "capital", word: t, message: "“I” is always capitalized", suggestions: ["I"] });
    }

    // ---- a sentence starts with a capital letter
    const first = s.words[0];
    if (first && first.start && LETTER.test(first.text[0]) && first.text[0] !== first.text[0].toLocaleUpperCase() && !skip(first.text) && !hasDigit(first.text)) {
      const before = masked.slice(s.from, first.from);
      // only after the start of the text or a real sentence end (not after "…", ":" or a mask)
      const prevEnd = list[list.indexOf(s) - 1]?.end ?? "\n";
      if (!before.includes(MASK) && !/…|\.\.\./.test(prevEnd) && first.text !== "i" && /^[\s"“'‘(«¿¡-]*$/.test(before)) {
        issues.push({ from: first.from, to: first.to, kind: "capital", word: first.text, message: "Start the sentence with a capital letter", suggestions: [capitalize(first.text)] });
      }
    }

    // ---- Spanish questions and exclamations open with ¿ ¡
    if (lang === "es" && first) {
      const body = masked.slice(s.from, s.to);
      for (const [close, open, what] of [["?", "¿", "question"], ["!", "¡", "exclamation"]] as const) {
        if (s.end.includes(close) && !body.includes(open)) {
          issues.push({ from: first.from, to: first.to, kind: "punct", word: first.text, message: `Spanish ${what}s open with “${open}”`, suggestions: [`${open}${first.text}`] });
        }
      }
    }
  }

  // ---- spaces: two in a row, or a space before , . ; : ! ? )
  for (const m of masked.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    issues.push({ from: m.index!, to: m.index! + m[0].length, kind: "space", word: m[0], message: "Two spaces in a row", suggestions: [" "] });
  }
  for (const m of masked.matchAll(/(?<=[\p{L}\p{N}]) +(?=[,.;:!?)](?!\p{N}))/gu)) {
    issues.push({ from: m.index!, to: m.index! + m[0].length, kind: "space", word: m[0], message: "No space before punctuation", suggestions: [""] });
  }

  issues.sort((a, b) => a.from - b.from || a.to - b.to);
  // one issue per place (the first kind wins)
  const out: Issue[] = [];
  for (const it of issues) if (!out.some((x) => x.from < it.to && it.from < x.to)) out.push(it);
  const count = (l: Lang) => langs.filter((x) => x === l).length;
  return { lang: count("en") > count("es") ? "en" : langs.length ? (count("es") ? "es" : "en") : o.prevLang ?? "es", issues: out };
}
