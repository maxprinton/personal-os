// Web Worker of the writing checker: loads the dictionaries (public/dict, copied by
// scripts/copy-dictionaries.mjs) once and checks texts off the main thread, so typing never stutters
// (the Spanish dictionary takes a few seconds to load). Messages: known · check → result · ready.
import nspell from "nspell";
import { checkText, suggestWord } from "@/lib/writing/check";
import type { Lang, Speller } from "@/lib/writing/types";

type In =
  | { type: "known"; words: string[] }
  | { type: "check"; id: number; text: string; ignore: string[]; prevLang?: Lang }
  | { type: "suggest"; id: number; word: string; lang: Lang }
  | { type: "langs"; es: boolean; en: boolean }
  | { type: "unknown"; id: number; text: string };
const ctx = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; postMessage: (m: unknown) => void };

let known = new Set<string>();
let langs = { es: true, en: true };
const spellers: { es: Speller | null; en: Speller | null } = { es: null, en: null };

/** nspell's suggest is slow: each word once. */
function memo(sp: { correct(w: string): boolean; suggest(w: string): string[] }): Speller {
  const cache = new Map<string, string[]>();
  return {
    correct: (w) => sp.correct(w),
    suggest: (w) => {
      const hit = cache.get(w);
      if (hit) return hit;
      const s = sp.suggest(w).slice(0, 6);
      if (cache.size > 2000) cache.clear();
      cache.set(w, s);
      return s;
    },
  };
}

async function load(name: string): Promise<Speller | null> {
  try {
    const [aff, dic] = await Promise.all([`/dict/${name}.aff`, `/dict/${name}.dic`].map((u) => fetch(u).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${u} ${r.status}`))))));
    return memo(nspell(aff, dic));
  } catch (e) {
    console.warn("[writing] dictionary not available:", name, e);
    return null;
  }
}

// English first (small and fast); Spanish next
const ready = (async () => {
  spellers.en = await load("en-US");
  spellers.es = await load("es-MX");
  ctx.postMessage({ type: "ready", es: !!spellers.es, en: !!spellers.en });
})();

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "known") {
    known = new Set(m.words.map((w) => w.toLocaleLowerCase()));
    return;
  }
  if (m.type === "langs") {
    langs = { es: m.es, en: m.en };
    return;
  }
  if (m.type === "unknown") {
    await ready;
    // "Review my notes": every misspelled word with how many times it appears (most first)
    const counts = new Map<string, { n: number; forms: Map<string, number> }>();
    const lines = m.text.split(/\n+/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const r = checkText(line.slice(0, 4000), { es: spellers.es, en: spellers.en, only: langs, known, maxSuggest: 0 });
      for (const i of r.issues) {
        if (i.kind !== "spelling") continue;
        const key = i.word.toLocaleLowerCase();
        const c = counts.get(key) ?? { n: 0, forms: new Map() };
        c.n++;
        c.forms.set(i.word, (c.forms.get(i.word) ?? 0) + 1);
        counts.set(key, c);
      }
    }
    const list = [...counts.values()]
      .map((c) => [[...c.forms].sort((a, b) => b[1] - a[1])[0][0], c.n] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 500);
    ctx.postMessage({ type: "unknown", id: m.id, list });
    return;
  }
  if (m.type === "check") {
    await ready;
    let result;
    try {
      // maxSuggest 0: spelling suggestions are asked only when you open a word's menu (fast checks)
      result = checkText(m.text, { es: spellers.es, en: spellers.en, only: langs, known, ignore: new Set(m.ignore.map((w) => w.toLocaleLowerCase())), prevLang: m.prevLang, maxSuggest: 0 });
    } catch (err) {
      console.warn("[writing] check failed", err);
      result = { lang: "es", issues: [] };
    }
    ctx.postMessage({ type: "result", id: m.id, result });
  }
  if (m.type === "suggest") {
    await ready;
    let list: string[] = [];
    try {
      list = suggestWord(m.word, m.lang, spellers);
    } catch {
      list = [];
    }
    ctx.postMessage({ type: "suggestions", id: m.id, list });
  }
};
