// AI summary of a search (server only): finds every note the search finds, reads their properties and the
// pieces where the words appear (not whole notes: Groq's free plan), asks the AI once, keeps the answer a day.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, hasAi } from "@/lib/ai";
import { withAiUsage } from "@/lib/ai-usage";
import { parseQuery } from "@/lib/search/core";
import { buildEvidence, summaryPrompt, SUMMARY_SYSTEM, type EvidenceNote, type Source } from "@/lib/search/ai-evidence";
import { searchNotes, type SearchOptions, type SearchResult } from "@/lib/search/server";

export type SearchSummary = {
  ok: boolean;
  answer?: string;
  sources?: Source[];
  /** Notes the search found / notes whose excerpts the AI read. */
  found?: number;
  /** Several words: the AI only reads notes that have them together, in that order ("change management"). */
  phrase?: string;
  /** Notes that have the whole phrase (when there is one). */
  matched?: number;
  read?: number;
  corrected?: string;
  cached?: boolean;
  error?: string;
};

const KIND_GROUPS: Record<"text" | "code" | "file", string[]> = {
  text: ["title", "heading", "text", "table", "props", "media"],
  code: ["code"],
  file: ["file", "media"],
};
const CACHE_HOURS = 24;
const MAX_NOTES = 200;

export async function summarizeSearch(sb: SupabaseClient, userId: string, input: string, opts: SearchOptions = {}): Promise<SearchSummary> {
  const query = input.trim().slice(0, 300);
  if (!parseQuery(query).terms.length) return { ok: false, error: "Type some words first." };
  if (!hasAi()) return { ok: false, error: "The AI is not connected (GROQ_API_KEY in Vercel)." };

  // 1) Every note the search finds (best first)
  const collect = async (text: string) => {
    const list: SearchResult[] = [];
    let total = 0;
    let corrected: string | undefined;
    for (let offset = 0; offset < MAX_NOTES; offset += 100) {
      const r = await searchNotes(sb, userId, text, { ...opts, limit: 100, offset });
      if (!r.ok) return { error: r.error ?? "Search failed." };
      if (offset === 0) {
        total = r.total;
        corrected = r.corrected;
      }
      list.push(...r.results);
      if (list.length >= total || !r.results.length) break;
    }
    return { list, total, corrected };
  };
  const all = await collect(query);
  if ("error" in all) return { ok: false, error: all.error };
  const total = all.total;
  const corrected = all.corrected;
  if (!all.list.length) return { ok: true, found: 0, read: 0, answer: "", sources: [], corrected };

  // Several plain words ("change management"): the AI only talks about notes that have the whole phrase
  const plain = parseQuery(corrected ?? query).simple;
  const phraseWords = plain && plain.length > 1 ? plain : null;
  let results = all.list;
  let phrase: string | undefined;
  if (phraseWords) {
    phrase = (corrected ?? query).trim();
    const exact = await collect(`"${phraseWords.join(" ")}"`);
    if ("error" in exact) return { ok: false, error: exact.error };
    results = exact.list;
    if (!results.length) return { ok: true, found: total, matched: 0, read: 0, phrase, answer: "", sources: [], corrected };
  }
  const ids = results.map((r) => r.id);

  // 2) The same search answered in the last day (and none of its notes changed since): no new AI call
  const key = createHash("sha1")
    .update(JSON.stringify(["phrase-v1", query.toLowerCase(), opts.kinds ?? [], !!opts.trash, !!opts.templates, results.map((r) => `${r.id}@${r.updatedAt}`)]))
    .digest("hex");
  const { data: hit } = await sb.from("search_ai_cache").select("answer,created_at").eq("user_id", userId).eq("key", key).maybeSingle();
  if (hit && Date.now() - Date.parse((hit as { created_at: string }).created_at) < CACHE_HOURS * 3600_000) {
    return { ...((hit as { answer: SearchSummary }).answer), cached: true };
  }

  // 3) Their properties and the pieces where the words appear
  const q = parseQuery(corrected ?? query);
  // The pieces to read: with a phrase, only those that have it; otherwise any of the words
  const anyWord = phraseWords ? parseQuery(`"${phraseWords.join(" ")}"`).terms.join(" & ") : q.terms.map((t) => `(${t})`).join(" | ");
  const kinds = opts.kinds?.length ? [...new Set(opts.kinds.flatMap((k) => KIND_GROUPS[k]))] : null;
  const [{ data: pieces, error: e1 }, { data: props }] = await Promise.all([
    sb.rpc("search_passages", { p_user: userId, p_query: anyWord, p_notes: ids, p_kinds: kinds }),
    sb.from("search_chunks").select("note_id,body").eq("user_id", userId).eq("kind", "props").in("note_id", ids),
  ]);
  if (e1) return { ok: false, error: e1.message };
  const byNote = new Map<string, EvidenceNote["passages"]>();
  for (const p of (pieces ?? []) as { note_id: string; kind: string; label: string | null; anchor: string | null; body: string }[]) {
    const list = byNote.get(p.note_id) ?? [];
    list.push({ kind: p.kind, label: p.label, anchor: p.anchor, body: p.body });
    byNote.set(p.note_id, list);
  }
  const propsOf = new Map(((props ?? []) as { note_id: string; body: string }[]).map((p) => [p.note_id, p.body.split("\n")]));
  const notes: EvidenceNote[] = results.map((r) => ({ id: r.id, title: r.title, parentTitle: r.parentTitle, updatedAt: r.updatedAt, props: propsOf.get(r.id) ?? [], passages: byNote.get(r.id) ?? [] }));
  const evidence = buildEvidence(notes, q.words);

  // 4) One AI call
  const out = await withAiUsage(
    "search-summary",
    () => aiChat(SUMMARY_SYSTEM, [{ text: summaryPrompt(phraseWords ? `"${corrected ?? query}" (the whole phrase)` : corrected ?? query, results.length, evidence) }], { kind: "write", temperature: 0.3, maxTokens: 900, timeoutMs: 40000 }),
    { sb, userId },
  );
  if ("error" in out) return { ok: false, error: out.error, found: total, read: evidence.sources.length };
  const answer: SearchSummary = { ok: true, answer: out.text, sources: evidence.sources, found: total, read: evidence.sources.length, corrected, phrase, matched: phraseWords ? results.length : undefined };
  await sb.from("search_ai_cache").upsert({ user_id: userId, key, answer, created_at: new Date().toISOString() });
  return answer;
}
