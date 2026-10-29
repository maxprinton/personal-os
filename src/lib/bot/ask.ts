// "Ask your notes" from Telegram (server only): /ask, @ai or "ai: <question>".
// 1) FIND: the notes that match the question's words get a score; the best ones (plus the latest, for
//    synonyms) go to the AI with a short preview, and it picks the 1–4 that can answer.
// 2) READ: those notes are read in full (as much as the free AI allows) and it answers from them only.
// Reply to the answer to ask more about the same notes. READ ONLY: nothing is changed.
import { aiChat, aiJson, hasAi } from "@/lib/ai";
import { noteAsPlainText } from "@/lib/block-notes";
import { fetchAll, type Ctx } from "@/lib/bot/core";
import { btn, pk, type Kb } from "@/lib/bot/tg";

type Note = { id: string; title: string; content: string; block_name: string | null; updated_at: string };
export type AskResult = { text: string; kb: Kb; noteIds: string[] };

/** The question, or null when the message isn't one. "/ai" alone is still the connection check. */
export function askQuestion(text: string): string | null {
  const m = /^(?:\/ask(?:@\w+)?|\/ai(?:@\w+)?(?=\s+\S)|\/gem(?:@\w+)?|@ai|@ia|@gem(?:ini)?|(?:ai|ia|ask|pregunta)\s*[:,])\s*([\s\S]*)$/i.exec(text.trim());
  return m ? m[1].trim() : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(
  (
    "que qué cual cuál cuales como cómo donde dónde cuando cuándo quien quién por para con sin sobre de del la las el los un una unos unas y o en mi mis me tu tus su sus es son era fue hay tengo tiene tenia " +
    "dice dijo nota notas escribi escribí escrito algo todo todos esta este esto estos estas ese esa eso al lo le les ya muy mas más pero porque si no se " +
    "what which how where when who why the a an and or of in on at to for with about from my me your is are was were do does did have has had there note notes wrote written say says said tell this that these those it"
  )
    .split(/\s+/)
    .map(fold),
);

/** Words that matter in the question ("gastos" also finds "gasto", "gastar"). */
export function keywords(q: string): string[] {
  const words = fold(q)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 12);
}

/** How well a note matches the words: title counts much more than the text. */
export function score(note: { title: string; content: string }, words: string[]) {
  if (!words.length) return 0;
  const title = fold(note.title || "");
  const body = fold(note.content || "");
  let s = 0;
  for (const w of words) {
    const stem = w.length > 5 ? w.slice(0, Math.max(5, w.length - 2)) : w;
    if (title.includes(stem)) s += 6;
    let hits = 0;
    let at = body.indexOf(stem);
    while (at >= 0 && hits < 6) {
      hits++;
      at = body.indexOf(stem, at + stem.length);
    }
    s += hits;
  }
  return s;
}

function preview(text: string, words: string[], n = 180) {
  const flat = text.replace(/\s+/g, " ").trim();
  const f = fold(flat);
  const at = words.map((w) => f.indexOf(w.slice(0, 5))).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 40);
  return `${start ? "…" : ""}${flat.slice(start, start + n)}${flat.length > start + n ? "…" : ""}`;
}

const label = (n: Note) => (n.block_name ? `✏️ ${n.block_name}` : n.title || "Untitled");

/** Telegram shows plain text: Markdown marks go, lists become "•". */
export function forTelegram(md: string) {
  return md
    .replace(/^#{1,6}\s+(.*)$/gm, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*])\*(?!\s)([^*\n]+)\*/g, "$1$2")
    .replace(/^\s*[-*+]\s+\[ \]\s+/gm, "☐ ")
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/gm, "☑ ")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const READ_LIMIT = 11_000; // characters of notes sent to the free AI (~3,000 tokens)

export async function askNotes(c: Ctx, question: string, follow?: { ids: string[]; q: string; a: string }): Promise<AskResult> {
  if (!question.trim()) return { text: "✨ Ask about your notes: “/ask what did I write about the trip?” (or “@ai …”).", kb: [], noteIds: [] };
  if (!hasAi()) return { text: "✨ The AI is not connected (GROQ_API_KEY in Vercel).", kb: [], noteIds: [] };

  const rows = await fetchAll<Note>((a, b) =>
    c.admin.from("notes").select("id,title,content,block_name,updated_at").eq("user_id", c.userId).is("deleted_at", null).order("updated_at", { ascending: false }).range(a, b),
  );
  const notes = rows.map((n) => ({ ...n, content: noteAsPlainText(n.content ?? "") })).filter((n) => n.content.trim() || n.title.trim());
  if (!notes.length) return { text: "📝 You don't have notes yet.", kb: [], noteIds: [] };

  // ---- 1) Find
  const words = keywords(question);
  const ranked = notes.map((n) => ({ n, s: score(n, words) })).sort((a, b) => b.s - a.s);
  const matched = ranked.filter((r) => r.s > 0).slice(0, 20).map((r) => r.n);
  const pool = [...matched];
  for (const n of follow ? notes.filter((x) => follow.ids.includes(x.id)) : []) if (!pool.includes(n)) pool.unshift(n);
  for (const n of notes) {
    if (pool.length >= 30) break;
    if (!pool.includes(n)) pool.push(n); // the latest notes, in case the question uses other words
  }
  const list = pool.map((n, i) => `[${i + 1}] ${label(n)} (edited ${n.updated_at.slice(0, 10)}): ${preview(n.content, words)}`).join("\n");
  const pick = await aiJson(
    [
      "You help find notes in the user's personal notes app.",
      "Given a QUESTION and a numbered list of notes (title + preview), choose the notes most likely to contain the answer.",
      'Return {"notes":[numbers]} with 1 to 4 numbers, best first. If the question asks about several topics or notes, include each one. If none fits, return {"notes":[]}.',
      follow ? "This is a follow-up question; the previous notes are first in the list and usually still apply." : "",
    ].filter(Boolean).join("\n"),
    [{ text: `QUESTION: ${question.slice(0, 500)}${follow ? `\nPREVIOUS QUESTION: ${follow.q.slice(0, 300)}` : ""}\n\nNOTES:\n${list}` }],
    "fast",
  );
  const nums = Array.isArray((pick as { notes?: unknown } | null)?.notes) ? ((pick as { notes: unknown[] }).notes as unknown[]) : null;
  let chosen = (nums ?? []).map((x) => pool[Number(x) - 1]).filter((n): n is Note => Boolean(n));
  if (!nums) chosen = matched.slice(0, 3); // the AI didn't answer: the best word matches
  if (!chosen.length && follow) chosen = notes.filter((n) => follow.ids.includes(n.id));
  chosen = [...new Set(chosen)].slice(0, 4);
  if (!chosen.length) {
    return {
      text: `🔎 I couldn't find a note about that${words.length ? ` (looked for: ${words.slice(0, 5).join(", ")})` : ""}. Try other words, or “/search word”.`,
      kb: [],
      noteIds: [],
    };
  }

  // ---- 2) Read and answer
  const per = Math.max(1_500, Math.floor(READ_LIMIT / chosen.length));
  const material = chosen
    .map((n, i) => {
      const body = n.content.length > per ? `${n.content.slice(0, per)}\n…(rest of the note not shown)` : n.content;
      return `### NOTE ${i + 1}: ${label(n)} (edited ${n.updated_at.slice(0, 10)})\n${body}`;
    })
    .join("\n\n");
  const out = await aiChat(
    [
      "You answer questions about the user's own notes, in Telegram.",
      "Use ONLY the NOTES below. If they don't contain the answer, say so plainly (and what they do say about the topic, if anything). Never invent.",
      "Answer in the same language as the question. Be short and direct: a few sentences or short bullet points. When you use several notes, say which note each part comes from (by its title).",
      "Plain text: you may use simple bullets (- ) but no tables, no headings, no bold.",
    ].join("\n"),
    [
      ...(follow ? [{ text: `EARLIER QUESTION: ${follow.q.slice(0, 300)}\nYOUR EARLIER ANSWER: ${follow.a.slice(0, 800)}` }] : []),
      { text: `NOTES:\n${material}` },
      { text: `QUESTION: ${question.slice(0, 800)}` },
    ],
    { kind: "write", temperature: 0.3, maxTokens: 1500, timeoutMs: 40000 },
  );
  if (!("text" in out)) return { text: `✨ ${out.error}`, kb: [], noteIds: [] };
  const sources = chosen.map(label).join(" · ");
  return {
    text: `${forTelegram(out.text)}\n\n📄 From: ${sources}\n↩ Reply to this message to ask more about these notes.`,
    kb: chosen.map((n) => [btn(`📄 ${label(n).slice(0, 40)}`, `no:${pk(n.id)}`)]),
    noteIds: chosen.map((n) => n.id),
  };
}
