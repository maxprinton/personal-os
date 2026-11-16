// BL-22: "Ask your notes" (@os) on the web. Pure helpers (depth levels, what extra data a question needs,
// the daily AI limit check, the saved conversation turns). The AI call itself is src/lib/bot/ask.ts askNotes.
import type { AskTurn } from "@/lib/bot/ask";

export type Depth = "quick" | "normal" | "deep";
export const DEPTHS: Record<Depth, { label: string; maxNotes: number; readLimit: number; hint: string }> = {
  quick: { label: "Quick", maxNotes: 2, readLimit: 5_500, hint: "about 2 notes · cheapest" },
  normal: { label: "Normal", maxNotes: 4, readLimit: 11_000, hint: "about 4 notes (same as Telegram)" },
  deep: { label: "Deep", maxNotes: 8, readLimit: 20_000, hint: "8 or more notes · uses more of today's free AI" },
};
export const isDepth = (v: unknown): v is Depth => v === "quick" || v === "normal" || v === "deep";

export const MAX_QUESTION = 1500;
/** How many earlier turns of the conversation go with a new question. */
export const HISTORY_TURNS = 3;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The question is about money: finance numbers are added (calculated by the app, not by the AI). */
export function wantsFinance(q: string): boolean {
  return /\b(money|spen[dt]|spent|expens\w*|income|earn\w*|salary|budget|balance|account|cuenta|saldo|gast\w*|ingres\w*|dinero|presupuesto|plata|pag[oa]\w*|finance|finanz\w*|transfer\w*|paid|cost\w*|bank|banco|cash|efectivo|ahorr\w*|saving\w*)\b/.test(fold(q));
}
/** The question is about the Backlog (items, what is in Now, ideas…). */
export function wantsBacklog(q: string): boolean {
  return /\b(backlog|bl-?\d+|now|next|verifying|inbox|parked|roadmap|feature\w*|bug\w*|spec\w*|idea\w*|ideas|building|built|pending|test mission\w*|waiting on me|que sigue|siguiente|pendiente\w*|construi\w*)\b/.test(fold(q));
}

export type LimitRow = { day: string; calls: number; tokens: number };
export type LimitLatest = { remaining_requests: number | null; remaining_tokens: number | null };

/**
 * The free AI has a daily limit (see ai-usage). When it is reached @os stops and says so, and nothing is sent.
 * Returns the message to show, or null when there is room.
 */
export function aiLimitMessage(rows: LimitRow[], latest: LimitLatest[], day: string, limits: { requests: number; tokens: number }): string | null {
  const today = rows.filter((r) => r.day === day);
  const calls = today.reduce((s, r) => s + r.calls, 0);
  const tokens = today.reduce((s, r) => s + r.tokens, 0);
  if (calls >= limits.requests || tokens >= limits.tokens) return "The free AI limit for today is reached. Nothing was sent. Try again tomorrow.";
  if (latest.some((l) => l.remaining_requests !== null && l.remaining_requests <= 0)) return "The free AI limit for today is reached. Nothing was sent. Try again tomorrow.";
  if (latest.some((l) => l.remaining_tokens !== null && l.remaining_tokens < 1_200)) return "The free AI has almost no room left today. Nothing was sent. Try again later or tomorrow.";
  return null;
}

export type StoredMessage = { role: "user" | "assistant"; content: string; sources?: { id: string; title: string }[] | null };

/** The last turns of a saved conversation, as the AskTurn list the notes search understands. */
export function turnsFromMessages(msgs: StoredMessage[], max = HISTORY_TURNS): AskTurn[] {
  const turns: AskTurn[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== "user") continue;
    const a = msgs[i + 1]?.role === "assistant" ? msgs[i + 1] : null;
    if (!a) continue;
    turns.push({ q: msgs[i].content, a: a.content, ids: (a.sources ?? []).map((s) => s.id) });
  }
  return turns.slice(-max);
}

/** A short title for a new conversation: the first question. */
export function conversationTitle(q: string): string {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "Conversation";
}

/** Backlog lines for the AI: what is in Now, Verifying, Next and the Inbox (exact, from the database). */
export function backlogContext(items: { number: number; title: string; status: string; size: string | null; type: string }[]): string {
  const order = ["now", "verifying", "next", "inbox"];
  const lines: string[] = ["BACKLOG (from the app):"];
  for (const st of order) {
    const list = items.filter((i) => i.status === st);
    lines.push(`${st.toUpperCase()} (${list.length}):`);
    for (const i of list.slice(0, 15)) lines.push(`- BL-${i.number} [${i.type}${i.size ? `, ${i.size}` : ""}] ${i.title.slice(0, 140)}`);
    if (list.length > 15) lines.push(`- …and ${list.length - 15} more`);
  }
  const counts = (["later", "parked", "done"] as const).map((st) => `${st} ${items.filter((i) => i.status === st).length}`).join(", ");
  lines.push(`Also: ${counts}.`);
  return lines.join("\n");
}
