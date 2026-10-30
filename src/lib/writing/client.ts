"use client";
// Browser side of the writing checker: one shared Web Worker for the whole app, a cache per text,
// and the words you never want marked (glossary + names of your notes, blocks and tags).
import { loadWritingWords } from "@/app/writing-actions";
import type { CheckResult, Lang } from "@/lib/writing/types";

type Status = { es: boolean; en: boolean; loaded: boolean };
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (r: CheckResult) => void>();
const waitingSuggest = new Map<number, (list: string[]) => void>();
const suggestCache = new Map<string, string[]>();
const cache = new Map<string, CheckResult>();
let status: Status = { es: false, en: false, loaded: false };
let known: string[] = [];
let knownLoaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const EMPTY: CheckResult = { lang: "es", issues: [] };

const notify = () => listeners.forEach((f) => f());
/** Called when the dictionaries finish loading or the known words change (everything is checked again). */
export function onWritingChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
/** Spelling dictionaries ready? (Until then only the rules work and the browser's spell check stays on.) */
export const writingStatus = () => status;

function get(): Worker | null {
  if (broken || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url));
  } catch (e) {
    console.warn("[writing] no worker", e);
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ type: string; id?: number; result?: CheckResult; es?: boolean; en?: boolean; list?: string[] }>) => {
    const m = e.data;
    if (m.type === "suggestions" && m.id !== undefined) {
      waitingSuggest.get(m.id)?.(m.list ?? []);
      waitingSuggest.delete(m.id);
    } else if (m.type === "result" && m.id !== undefined) {
      waiting.get(m.id)?.(m.result ?? EMPTY);
      waiting.delete(m.id);
    } else if (m.type === "ready") {
      status = { es: !!m.es, en: !!m.en, loaded: true };
      cache.clear();
      notify();
    }
  };
  worker.onerror = (e) => {
    console.warn("[writing] worker error", e.message);
    broken = true;
    for (const done of waiting.values()) done(EMPTY);
    waiting.clear();
    for (const done of waitingSuggest.values()) done([]);
    waitingSuggest.clear();
  };
  if (known.length) worker.postMessage({ type: "known", words: known });
  void ensureKnownWords();
  return worker;
}

/** Loads the glossary and the names (once per page load). */
export function ensureKnownWords() {
  knownLoaded ??= loadWritingWords()
    .then((r) => {
      if (r.ok) setKnownWords(r.words);
    })
    .catch(() => {});
  return knownLoaded;
}

export function setKnownWords(words: string[]) {
  known = [...new Set(words.map((w) => w.toLocaleLowerCase()))];
  cache.clear();
  worker?.postMessage({ type: "known", words: known });
  notify();
}
export function addKnownWord(word: string) {
  setKnownWords([...known, word]);
}

/** Checks a text (a paragraph or a field). Same text + same ignored words = from the cache. */
export function checkWriting(text: string, ignore: string[] = [], prevLang?: Lang): Promise<CheckResult> {
  const key = `${prevLang ?? ""}|${ignore.join(",")}|${text}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const w = get();
  if (!w) return Promise.resolve(EMPTY);
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (waiting.delete(id)) resolve(EMPTY);
    }, 20_000);
    waiting.set(id, (r) => {
      clearTimeout(t);
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      cache.set(key, r);
      resolve(r);
    });
    w.postMessage({ type: "check", id, text, ignore, prevLang });
  });
}

/** Suggestions for a misspelled word (asked when its menu opens). */
export function suggestWriting(word: string, lang: Lang = "es"): Promise<string[]> {
  const key = `${lang}|${word}`;
  const hit = suggestCache.get(key);
  if (hit) return Promise.resolve(hit);
  const w = get();
  if (!w) return Promise.resolve([]);
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (waitingSuggest.delete(id)) resolve([]);
    }, 15_000);
    waitingSuggest.set(id, (list) => {
      clearTimeout(t);
      if (suggestCache.size > 1000) suggestCache.clear();
      suggestCache.set(key, list);
      resolve(list);
    });
    w.postMessage({ type: "suggest", id, word, lang });
  });
}
