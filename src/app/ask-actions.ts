"use server";
// BL-22: "Ask your notes" (@os) from the web: ask, list, open and delete conversations.
// Reads notes, and (only when the question needs them) the Backlog and finance numbers. Nothing is changed.
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { hasAi } from "@/lib/ai";
import { askNotes, type AskOptions, type AskTurn } from "@/lib/bot/ask";
import type { Ctx } from "@/lib/bot/core";
import { DAY_REQUESTS, DAY_TOKENS, scopeUsageLine, startOfDay, usageSummary, withAiUsage } from "@/lib/ai-usage";
import { localNow } from "@/lib/time";
import { listItems } from "@/lib/backlog/data";
import { loadSummaryData } from "@/lib/finance-summary-data";
import { monthOf, prevMonth, summarizeMonth, summaryText } from "@/lib/finance-summary";
import {
  DEPTHS,
  HISTORY_TURNS,
  MAX_QUESTION,
  aiLimitMessage,
  backlogContext,
  conversationTitle,
  isDepth,
  turnsFromMessages,
  wantsBacklog,
  wantsFinance,
  type Depth,
  type StoredMessage,
} from "@/lib/ask/web";

export type AskSource = { id: string; title: string };
export type AskReply =
  | { ok: true; answer: string; sources: AskSource[]; conversationId: string | null; saved: boolean; usage?: string | null; alsoRead: string[] }
  | { ok?: false; error: string };
export type ConversationRow = { id: string; title: string; updated_at: string; focus_note_id: string | null };
export type MessageRow = { id: string; role: "user" | "assistant"; content: string; sources: AskSource[]; depth: Depth | null; created_at: string };

const MISSING_TABLES = "Conversations are not saved yet: run MIGRACION-0071-ask-os.sql in Supabase.";
const isMissing = (e: { message?: string; code?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /ask_(conversations|messages)/.test(e.message ?? ""));

async function me() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, user };
}

export async function askWeb(input: {
  conversationId?: string | null;
  question: string;
  depth?: string;
  focusNoteId?: string | null;
  /** The thread so far, kept by the browser: used when conversations cannot be saved. */
  thread?: { q: string; a: string; ids: string[] }[];
}): Promise<AskReply> {
  try {
    const { sb, user } = await me();
    if (!user) return { error: "Sign in again." };
    const question = String(input.question ?? "").trim();
    if (!question) return { error: "Write a question first." };
    if (question.length > MAX_QUESTION) return { error: `That is too long (${question.length} characters). Keep it under ${MAX_QUESTION}.` };
    if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
    const depth: Depth = isDepth(input.depth) ? input.depth : "normal";
    const { timezone } = await getSettings(sb);
    const today = localNow(timezone).date;

    // The free AI has a daily limit: when it is reached, stop and say so (nothing is sent)
    const sum = await usageSummary(sb, { from: startOfDay(today, timezone), tz: timezone, userId: user.id }).catch(() => null);
    const limit = sum ? aiLimitMessage(sum.rows, sum.latest, today, { requests: DAY_REQUESTS, tokens: DAY_TOKENS }) : null;
    if (limit) return { error: limit };

    // The thread: from the saved conversation when there is one, otherwise from the browser
    let conversationId = input.conversationId ?? null;
    let history: AskTurn[] = (input.thread ?? []).slice(-HISTORY_TURNS).map((t) => ({ q: String(t.q).slice(0, 600), a: String(t.a).slice(0, 1200), ids: (t.ids ?? []).slice(0, 12) }));
    if (conversationId) {
      const { data, error } = await sb.from("ask_messages").select("role,content,sources").eq("user_id", user.id).eq("conversation_id", conversationId).order("created_at");
      if (!error) history = turnsFromMessages((data ?? []) as StoredMessage[]);
      else if (!isMissing(error)) return { error: error.message };
    }

    // Extra data, only when the question is about it
    const alsoRead: string[] = [];
    const extra: string[] = [];
    if (wantsBacklog(question)) {
      const { items, missing } = await listItems(sb, user.id);
      if (!missing && items.length) {
        extra.push(backlogContext(items));
        alsoRead.push("Backlog");
      }
    }
    if (wantsFinance(question)) {
      try {
        const data = await loadSummaryData(sb, user.id, timezone);
        const m = monthOf(today);
        extra.push(`FINANCE (calculated by the app):\n${summaryText(summarizeMonth(data, m, today))}\n\n${summaryText(summarizeMonth(data, prevMonth(m), today))}`);
        alsoRead.push("Finance");
      } catch {
        /* finance unavailable: answer from the notes alone */
      }
    }

    const d = DEPTHS[depth];
    const opts: AskOptions = { maxNotes: d.maxNotes, readLimit: d.readLimit, focusId: input.focusNoteId || undefined, extra: extra.join("\n\n") || undefined };
    const ctx: Ctx = { admin: sb, userId: user.id, chatId: 0, tz: timezone, today, nowMin: 0 };

    let usage: string | null = null;
    const res = await withAiUsage(
      "ask-web",
      async () => {
        const r = await askNotes(ctx, question, undefined, history, opts);
        usage = await scopeUsageLine(sb, user.id, timezone, today).catch(() => null);
        return r;
      },
      { sb, userId: user.id },
    );
    const answer = res.answer ?? res.text;
    const sources = res.sources ?? [];
    if (!res.answer && !res.sources) return { error: res.text.replace(/^[✨📝🔎]\s*/, "") }; // a message from the finder, not an answer

    // Save the turn (quietly skipped when migration 0071 has not been run)
    let saved = false;
    try {
      if (!conversationId) {
        const { data: conv, error } = await sb
          .from("ask_conversations")
          .insert({ user_id: user.id, title: conversationTitle(question), focus_note_id: input.focusNoteId || null })
          .select("id")
          .single();
        if (!error && conv) conversationId = (conv as { id: string }).id;
      }
      if (conversationId) {
        const { error } = await sb.from("ask_messages").insert([
          { user_id: user.id, conversation_id: conversationId, role: "user", content: question, sources: [], depth },
          { user_id: user.id, conversation_id: conversationId, role: "assistant", content: answer, sources, depth },
        ]);
        if (!error) {
          saved = true;
          await sb.from("ask_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", user.id);
        } else conversationId = null;
      }
    } catch {
      conversationId = null;
    }
    return { ok: true, answer, sources, conversationId, saved, usage, alsoRead };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not answer. Try again." };
  }
}

export async function listAskConversations(): Promise<{ rows: ConversationRow[]; missing: boolean; error?: string }> {
  const { sb, user } = await me();
  if (!user) return { rows: [], missing: false, error: "Sign in again." };
  const { data, error } = await sb.from("ask_conversations").select("id,title,updated_at,focus_note_id").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(200);
  if (error) return { rows: [], missing: isMissing(error), error: isMissing(error) ? MISSING_TABLES : error.message };
  return { rows: (data ?? []) as ConversationRow[], missing: false };
}

export async function loadAskConversation(id: string): Promise<{ messages: MessageRow[]; error?: string }> {
  const { sb, user } = await me();
  if (!user) return { messages: [], error: "Sign in again." };
  const { data, error } = await sb.from("ask_messages").select("id,role,content,sources,depth,created_at").eq("user_id", user.id).eq("conversation_id", id).order("created_at");
  if (error) return { messages: [], error: error.message };
  return { messages: ((data ?? []) as MessageRow[]).map((m) => ({ ...m, sources: Array.isArray(m.sources) ? m.sources : [] })) };
}

/** Permanent: the browser asks for a confirmation first. */
export async function deleteAskConversation(id: string): Promise<{ ok?: boolean; error?: string }> {
  const { sb, user } = await me();
  if (!user) return { error: "Sign in again." };
  const { error } = await sb.from("ask_conversations").delete().eq("id", id).eq("user_id", user.id);
  return error ? { error: error.message } : { ok: true };
}
