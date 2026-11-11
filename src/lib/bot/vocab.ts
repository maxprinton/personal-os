// Your own command words for the bot (pure: no database, no network; covered by scripts/test-telegram.ts).
// A word you ADD for a feature is rewritten to the feature's canonical command before the bot reads the message,
// so every existing rule keeps working. A built-in word you HIDE answers "renamed, use …" instead of being
// saved as a task by accident.
import { commandArg, isOneOf, norm } from "@/lib/bot/text";

export type VocabRow = { feature_id: string; word: string; kind: "add" | "hide" };
/** What the rewriter needs to know about a feature that has a command. */
export type VocabFeature = { id: string; canonical: string; words: string[]; takesArg: boolean; locked: boolean };
export type VocabResult = { text: string } | { renamed: { word: string; use: string } };

/** A word as it is stored: no accents, lower case, no "/", letters, digits, "_" and single spaces, 2–30 characters. */
export function cleanWord(raw: string): string | null {
  const w = norm(String(raw ?? "")).replace(/^\/+/, "").replace(/\s+/g, " ").trim();
  return /^[a-z0-9_]+( [a-z0-9_]+){0,2}$/.test(w) && w.length >= 2 && w.length <= 30 ? w : null;
}

/** Every spelling the bot reads for a stored word ("hoy2" is also typed as "/hoy2"). */
const spellings = (w: string) => (w.includes(" ") ? [w, `/${w.replace(/ /g, "_")}`] : [w, `/${w}`]);
/** A built-in word without its "/", to compare it with stored words. */
export const bare = (w: string) => norm(w).replace(/^\/+/, "");

function matches(f: VocabFeature, text: string, words: string[]): string | null {
  if (!words.length) return null;
  if (!f.takesArg) return isOneOf(text, words) ? "" : null;
  return commandArg(text, words);
}

export function applyVocab(text: string, rows: VocabRow[], features: VocabFeature[]): VocabResult {
  const byId = new Map(features.map((f) => [f.id, f]));
  // 1) Added words → the canonical command (the rest of the message is kept as it was typed)
  for (const r of rows) {
    if (r.kind !== "add") continue;
    const f = byId.get(r.feature_id);
    if (!f) continue;
    const arg = matches(f, text, spellings(r.word));
    if (arg !== null) return { text: arg ? `${f.canonical} ${arg}` : f.canonical };
  }
  // 2) Hidden built-in words: say what to use now
  for (const f of features) {
    if (f.locked) continue;
    const hidden = rows.filter((r) => r.kind === "hide" && r.feature_id === f.id).map((r) => r.word);
    if (!hidden.length) continue;
    const word = matches(f, text, hidden.flatMap(spellings));
    if (word === null) continue;
    const added = rows.find((r) => r.kind === "add" && r.feature_id === f.id);
    const typed = norm(text.split(/\s+/)[0] ?? "") || hidden[0];
    return { renamed: { word: typed, use: added ? `/${added.word.replace(/ /g, "_")}` : f.canonical } };
  }
  return { text };
}

/** The words a feature answers to right now: its built-in words that are not hidden, plus the ones you added. */
export function activeWords(f: Pick<VocabFeature, "id" | "words" | "locked">, rows: VocabRow[]): string[] {
  const hidden = new Set(f.locked ? [] : rows.filter((r) => r.kind === "hide" && r.feature_id === f.id).map((r) => r.word));
  const added = rows.filter((r) => r.kind === "add" && r.feature_id === f.id).map((r) => r.word);
  return [...f.words.filter((w) => !hidden.has(bare(w))), ...added];
}
