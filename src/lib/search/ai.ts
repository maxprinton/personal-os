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
  const results: SearchResult[] = [];
  let total = 0;
  let corrected: string | undefined;
  for (let offset = 0; offset < MAX_NOTES; offset += 100) {
    const r = await searchNotes(sb, userId, query, { ...opts, limit: 100, offset });
    if (!r.ok) return { ok: false, error: r.error ?? "Search failed." };
    if (offset === 0) {
      total = r.total;
      corrected = r.corrected;
    }
    results.push(...r.results);
    if (results.length >= total || !r.results.length) break;
  }
  if (!results.length) return { ok: true, found: 0, read: 0, answer: "", sources: [], corrected };
  const ids = results.map((r) => r.id);

  // 2) The same search answered in the last day (and none of its notes changed since): no new AI call
  const key = createHash("sha1")
    .update(JSON.stringify([query.toLowerCase(), opts.kinds ?? [], !!opts.trash, !!opts.templates, results.map((r) => `${r.id}@${r.updatedAt}`)]))
    .digest("hex");
  const { data: hit } = await sb.from("search_ai_cache").select("answer,created_at").eq("user_id", userId).eq("key", key).maybeSingle();
  if (hit && Date.now() - Date.parse((hit as { created_at: string }).created_at) < CACHE_HOURS * 3600_000) {
    return { ...((hit as { answer: SearchSummary }).answer), cached: true };
  }

  // 3) Their properties and the pieces where the words appear
  const q = parseQuery(corrected ?? query);
  const anyWord = q.terms.map((t) => `(${t})`).join(" | ");
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
    () => aiChat(SUMMARY_SYSTEM, [{ text: summaryPrompt(corrected ?? query, total, evidence) }], { kind: "write", temperature: 0.3, maxTokens: 900, timeoutMs: 40000 }),
    { sb, userId },
  );
  if ("error" in out) return { ok: false, error: out.error, found: total, read: evidence.sources.length };
  const answer: SearchSummary = { ok: true, answer: out.text, sources: evidence.sources, found: total, read: evidence.sources.length, corrected };
  await sb.from("search_ai_cache").upsert({ user_id: userId, key, answer, created_at: new Date().toISOString() });
  return answer;
}
