// The AI layer of the writing checker (server): one paragraph in, a few fixes out, each with its why.
// It only runs when the local checker found something grave, or on a finished English paragraph
// (phrases that don't sound native), or when you ask. Tone, length and free prompts stay in ✨ Ask AI.
import type { Issue, Lang } from "@/lib/writing/types";

export type AiFix = { find: string; replace: string; why: string };
export type WritingAiRequest = { text: string; lang: Lang; reason: "grave" | "native" | "manual"; known?: string[]; voice?: string | null };

export const AI_TEXT_LIMIT = 2_000;

export function writingSystemPrompt(r: WritingAiRequest) {
  return [
    "You are a careful proofreader for Spanish and English inside a personal notes app. You get ONE paragraph.",
    "Find only real problems: grammar (agreement, tenses, prepositions, word order), a wrong word, missing accents that change meaning, and,",
    r.lang === "en" ? "because it is English: phrases a native speaker would not write (calques from Spanish, unnatural word choice)." : "in Spanish: anglicisms used wrongly and unnatural phrases.",
    "Never change the person's style, tone, slang, abbreviations or their mix of Spanish and English. Never touch the KNOWN WORDS, names, numbers, links or emojis.",
    "Spelling mistakes of single words are already handled elsewhere: only fix them when part of a bigger fix.",
    'Return {"fixes":[{"find":"exact text copied from the paragraph, 1 to 8 words","replace":"the corrected text","why":"one short sentence in English"}]} with at most 5 fixes, the most important first.',
    'If the paragraph is fine, return {"fixes":[]}. Do not rewrite whole sentences that are correct.',
    r.voice ? `HOW THIS PERSON WRITES (respect it):\n${r.voice.slice(0, 600)}` : "",
    r.known?.length ? `KNOWN WORDS: ${r.known.slice(0, 80).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The model's JSON → fixes that really point into the paragraph. */
export function parseFixes(raw: unknown, text: string): AiFix[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { fixes?: unknown }).fixes) ? ((raw as { fixes: unknown[] }).fixes as unknown[]) : [];
  const out: AiFix[] = [];
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    const find = String((f as AiFix).find ?? "");
    const replace = String((f as AiFix).replace ?? "");
    const why = String((f as AiFix).why ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!find.trim() || find === replace || find.length > 200 || replace.length > 300) continue;
    if (!text.includes(find)) continue;
    if (out.some((x) => x.find === find)) continue;
    out.push({ find, replace, why: why || "Suggested by the AI" });
    if (out.length >= 5) break;
  }
  return out;
}

/** Fixes → issues with offsets in the text (first place each one appears). */
export function fixesToIssues(fixes: AiFix[], text: string): Issue[] {
  const used: [number, number][] = [];
  const out: Issue[] = [];
  for (const f of fixes) {
    let from = text.indexOf(f.find);
    while (from >= 0 && used.some(([a, b]) => from < b && a < from + f.find.length)) from = text.indexOf(f.find, from + 1);
    if (from < 0) continue;
    const to = from + f.find.length;
    used.push([from, to]);
    out.push({ from, to, kind: "ai", word: f.find, message: f.why, suggestions: [f.replace] });
  }
  return out.sort((a, b) => a.from - b.from);
}
