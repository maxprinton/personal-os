"use client";
// Browser side of the writing assistant, shared by the whole app:
// · one Web Worker with the dictionaries (spelling + rules), a cache per text
// · the words you never want marked, the words you keep writing, your settings
// · next-word prediction (model loaded once, learns from what you write)
// · the AI checks (per-minute limit here, daily cap on the server, results kept in this browser)
import { learnNgrams, loadPredictModel, loadWritingWords, noteUnknownWords, recordMistake, trainFromNotes } from "@/app/writing-actions";
import { buildModel, emptyModel, learnInto, ngramRows, ngramsOf, predict, type Model, type Prediction } from "@/lib/writing/predict";
import { fixesToIssues, type AiFix } from "@/lib/ai-writing";
import { AI_PER_MINUTE, langsOf, type WritingSettings } from "@/lib/writing/settings";
import type { CheckResult, Issue, Lang } from "@/lib/writing/types";

type Status = { es: boolean; en: boolean; loaded: boolean };
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (r: CheckResult) => void>();
const waitingSuggest = new Map<number, (list: string[]) => void>();
const waitingUnknown = new Map<number, (list: [string, number][]) => void>();
const cache = new Map<string, CheckResult>();
const suggestCache = new Map<string, string[]>();
let status: Status = { es: false, en: false, loaded: false };
let known: string[] = [];
let frequent = new Set<string>();
let settings: WritingSettings = {};
let setupLoaded: Promise<void> | null = null;
let setupDone = false;
const listeners = new Set<() => void>();
const EMPTY: CheckResult = { lang: "es", issues: [] };

const notify = () => listeners.forEach((f) => f());
/** Called when the dictionaries finish loading, the settings or the known words change. */
export function onWritingChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
/** Spelling dictionaries ready? (Until then only the rules work and the browser's spell check stays on.) */
export const writingStatus = () => status;
export const writingSettings = () => settings;
export const writingReady = () => setupDone;
/** You wrote this unknown word on 3 or more days: the menu offers to add it. */
export const isFrequentUnknown = (w: string) => frequent.has(w.toLocaleLowerCase());

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
  worker.onmessage = (e: MessageEvent<{ type: string; id?: number; result?: CheckResult; es?: boolean; en?: boolean; list?: unknown }>) => {
    const m = e.data;
    if (m.type === "suggestions" && m.id !== undefined) {
      waitingSuggest.get(m.id)?.((m.list as string[]) ?? []);
      waitingSuggest.delete(m.id);
    } else if (m.type === "unknown" && m.id !== undefined) {
      waitingUnknown.get(m.id)?.((m.list as [string, number][]) ?? []);
      waitingUnknown.delete(m.id);
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
    for (const done of waitingSuggest.values()) done([]);
    for (const done of waitingUnknown.values()) done([]);
    waiting.clear();
    waitingSuggest.clear();
    waitingUnknown.clear();
  };
  postSetup();
  void ensureKnownWords();
  return worker;
}

function postSetup() {
  worker?.postMessage({ type: "known", words: known });
  worker?.postMessage({ type: "langs", ...langsOf(settings) });
}

/** Settings, glossary, names and frequent words (once per page load). */
export function ensureKnownWords() {
  setupLoaded ??= loadWritingWords()
    .then((r) => {
      if (!r.ok) return;
      settings = r.settings ?? {};
      frequent = new Set(r.frequent.map((w) => w.toLocaleLowerCase()));
      setKnownWords(r.words);
    })
    .catch(() => {})
    .finally(() => {
      setupDone = true;
      notify();
    });
  return setupLoaded;
}

export function setWritingSettings(next: WritingSettings) {
  settings = next;
  cache.clear();
  postSetup();
  notify();
}

export function setKnownWords(words: string[]) {
  known = [...new Set(words.map((w) => w.toLocaleLowerCase()))];
  cache.clear();
  postSetup();
  notify();
}
export function addKnownWord(word: string) {
  frequent.delete(word.toLocaleLowerCase());
  setKnownWords([...known, word]);
}
export const knownWords = () => known;

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

/** "Review my notes" / "Paste a text": the words the dictionaries don't know, most used first. */
export function unknownWordsIn(text: string): Promise<[string, number][]> {
  const w = get();
  if (!w) return Promise.resolve([]);
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (waitingUnknown.delete(id)) resolve([]);
    }, 120_000);
    waitingUnknown.set(id, (list) => {
      clearTimeout(t);
      resolve(list);
    });
    w.postMessage({ type: "unknown", id, text });
  });
}

// ---------- Learning while you write ----------

const seenToday = new Set<string>();
let seenTimer: ReturnType<typeof setTimeout> | null = null;
/** Unknown words still underlined: counted once a day (3 days → "Add it to your dictionary?"). */
export function noteUnknown(words: string[]) {
  let added = false;
  for (const w of words) {
    const l = w.toLocaleLowerCase();
    if (l.length < 3 || seenToday.has(l)) continue;
    seenToday.add(l);
    added = true;
  }
  if (!added || seenTimer) return;
  seenTimer = setTimeout(() => {
    seenTimer = null;
    const list = [...seenToday].filter((w) => !sentUnknown.has(w));
    list.forEach((w) => sentUnknown.add(w));
    if (list.length) void noteUnknownWords(list).catch(() => {});
  }, 30_000);
}
const sentUnknown = new Set<string>();

/** A correction you accepted (for your most repeated mistakes). */
export function noteMistake(wrong: string, fixed: string) {
  void recordMistake(wrong, fixed).catch(() => {});
}

// ---------- Next-word prediction ----------

let model: Model = emptyModel();
let modelLoaded: Promise<void> | null = null;
const pending = new Map<string, number>();
let learnTimer: ReturnType<typeof setTimeout> | null = null;
const learned = new Set<string>();

/** Loads what the prediction learned; the first time it learns from all your notes. */
export function ensurePredictModel() {
  modelLoaded ??= loadPredictModel()
    .then(async (r) => {
      if (!r.ok) return;
      if (!r.rows.length && !r.trained) {
        const t = await trainFromNotes();
        if (t.ok) {
          const again = await loadPredictModel();
          if (again.ok) model = buildModel(again.rows);
        }
        return;
      }
      model = buildModel(r.rows);
    })
    .catch(() => {});
  return modelLoaded;
}

/** The suggestion for the text right before the cursor. */
export function predictNext(before: string): Prediction | null {
  void ensurePredictModel();
  if (settings.predict === false) return null;
  return predict(model, before);
}

/** Text you finished writing: the prediction learns it now (and on the server, in batches). */
export function learnText(text: string) {
  const t = text.trim();
  if (t.length < 8 || learned.has(t)) return;
  learned.add(t);
  if (learned.size > 5000) learned.clear();
  const counts = ngramsOf(t);
  learnInto(model, counts);
  for (const [k, n] of counts) pending.set(k, (pending.get(k) ?? 0) + n);
  if (learnTimer) return;
  learnTimer = setTimeout(flushLearning, 20_000);
}
export function flushLearning() {
  if (learnTimer) clearTimeout(learnTimer);
  learnTimer = null;
  if (!pending.size) return;
  const rows = ngramRows(new Map(pending));
  pending.clear();
  void learnNgrams(rows).catch(() => {});
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushLearning);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushLearning());
}

// ---------- The AI checks ----------

const AI_KEY = "pos-writing-ai-v1";
const aiMem = new Map<string, Issue[]>();
const recent: number[] = [];
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}
function store(): Record<string, AiFix[]> {
  try {
    return JSON.parse(localStorage.getItem(AI_KEY) ?? "{}") as Record<string, AiFix[]>;
  } catch {
    return {};
  }
}
function remember(key: string, fixes: AiFix[]) {
  try {
    const all = store();
    all[key] = fixes;
    const keys = Object.keys(all);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete all[k];
    localStorage.setItem(AI_KEY, JSON.stringify(all));
  } catch {
    /* private mode: memory only */
  }
}

/** AI fixes already known for this exact text (no request). */
export function aiCached(text: string): Issue[] | null {
  const key = hash(text);
  const mem = aiMem.get(key);
  if (mem) return mem;
  const saved = store()[key];
  if (!saved) return null;
  const issues = fixesToIssues(saved, text);
  aiMem.set(key, issues);
  return issues;
}

export type AiOutcome = { issues: Issue[]; limited?: "minute" | "day" | "off"; error?: string };

/** Asks the AI about one paragraph. reason "manual" = you asked (no limits from this side). */
export async function aiCheck(text: string, lang: Lang, reason: "grave" | "native" | "manual"): Promise<AiOutcome> {
  const cached = aiCached(text);
  if (cached) return { issues: cached };
  if (reason !== "manual") {
    if (settings.ai === false) return { issues: [], limited: "off" };
    const now = Date.now();
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    if (recent.length >= AI_PER_MINUTE) return { issues: [], limited: "minute" };
    recent.push(now);
  }
  try {
    const res = await fetch("/api/writing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang, reason, known: known.slice(0, 80) }),
    });
    const j = (await res.json().catch(() => null)) as { fixes?: AiFix[]; capped?: boolean; off?: boolean; error?: string } | null;
    if (j?.capped) return { issues: [], limited: "day" };
    if (j?.off) return { issues: [], limited: "off" };
    if (!j?.fixes) return { issues: [], error: j?.error ?? `The AI couldn't answer (HTTP ${res.status}).` };
    remember(hash(text), j.fixes);
    const issues = fixesToIssues(j.fixes, text);
    aiMem.set(hash(text), issues);
    return { issues };
  } catch {
    return { issues: [], error: "No connection." };
  }
}
