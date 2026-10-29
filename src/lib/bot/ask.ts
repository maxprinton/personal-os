// "Ask your notes" from Telegram (server only): @os <question> (also /os, /ask, "os: …", by voice "OS, …").
// 1) FIND: the notes that match the question's words get a score; the best ones (plus the latest, for
//    synonyms) go to the AI with a short preview, and it picks the 1–4 that can answer.
// 2) READ: those notes are read in full (as much as the free AI allows) and it answers from them only.
// "@os NOTE-12 …" goes straight to that note (no search); "@os NOTE-12" alone = a short summary of it.
// Reply to the answer to ask more about the same notes. READ ONLY: nothing is changed.
import { aiChat, aiJson, hasAi } from "@/lib/ai";
import { noteAsPlainText } from "@/lib/block-notes";
import { fetchAll, type Ctx } from "@/lib/bot/core";
import { btn, pk, type Kb } from "@/lib/bot/tg";

type Note = { id: string; title: string; content: string; block_name: string | null; updated_at: string };
export type AskResult = { text: string; kb: Kb; noteIds: string[] };

/** The question, or null when the message isn't one. */
export function askQuestion(text: string): string | null {
  const m = /^(?:@os\b|\/os(?:@\w+)?(?=\s|$)|\/ask(?:@\w+)?(?=\s|$)|o\.?\s?s\.?\s*[:,])\s*([\s\S]*)$/i.exec(text.trim());
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

// ---- NOTE-12: go straight to a note by its ID (the built-in "ID" property = notes.seq, migration 0021)

export type NoteRefs = { nums: number[]; rest: string };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The note numbers a question names: "NOTE-12", "note-12", "NOTE #12", "NOTE12" (any case, up to 4), and
 * "note 12" / "nota 12" only when that is the whole question (otherwise "note 12 ideas" would be ambiguous).
 * rest = the question without them ("" = nothing else was asked → a short summary). null = no reference.
 */
export function noteRefs(q: string, prefixes: string[] = ["NOTE", "NOTA"]): NoteRefs | null {
  const alts = [...new Set(prefixes.map((p) => p.trim()).filter(Boolean))].map(esc).join("|");
  if (!alts) return null;
  const whole = new RegExp(`^\\s*(?:${alts})\\s+#?(\\d{1,7})\\s*[?.!]*\\s*$`, "iu").exec(q);
  if (whole) return Number(whole[1]) > 0 ? { nums: [Number(whole[1])], rest: "" } : null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts})(?:\\s?[-‐‑–]\\s?|\\s?#|)(\\d{1,7})(?![\\p{L}\\p{N}])`, "giu");
  const nums: number[] = [];
  for (const m of q.matchAll(re)) {
    const n = Number(m[1]);
    if (n > 0 && !nums.includes(n)) nums.push(n);
  }
  if (!nums.length) return null;
  const rest = q.replace(re, " ").replace(/\s+/g, " ").trim();
  return { nums: nums.slice(0, 4), rest: keywords(rest).length ? rest : "" };
}

type SeqNote = Note & { seq: number };

/** The prefix of the user's built-in ID property, when it isn't NOTE (null = default / unknown). */
async function customPrefix(c: Ctx): Promise<string | null> {
  const { data, error } = await c.admin.from("note_properties").select("config").eq("user_id", c.userId).eq("key", "id").eq("builtin", true).is("deleted_at", null).limit(1);
  if (error) return null;
  const p = ((data ?? []) as { config: { prefix?: string } | null }[])[0]?.config?.prefix?.trim();
  return p && !/^not[ae]$/i.test(p) ? p : null;
}

/** null = the question names no note (or migration 0021 isn't run): search as usual. */
async function notesByRef(c: Ctx, question: string): Promise<{ notes: SeqNote[]; missing: number[]; summary: boolean; prefix: string } | null> {
  let prefix = "NOTE";
  let refs = noteRefs(question);
  if (!refs && /(?<![\p{L}\p{N}])\p{L}{1,12}-\d{1,7}(?![\p{L}\p{N}])/u.test(question)) {
    const custom = await customPrefix(c);
    if (custom) {
      refs = noteRefs(question, [custom]);
      prefix = custom.toUpperCase();
    }
  }
  if (!refs) return null;
  const { data, error } = await c.admin.from("notes").select("id,title,content,block_name,updated_at,seq").eq("user_id", c.userId).is("deleted_at", null).in("seq", refs.nums);
  if (error) return null;
  const rows = (data ?? []) as SeqNote[];
  const notes = refs.nums
    .map((n) => rows.find((r) => Number(r.seq) === n))
    .filter((n): n is SeqNote => Boolean(n))
    .map((n) => ({ ...n, content: noteAsPlainText(n.content ?? "") }));
  return { notes, missing: refs.nums.filter((n) => !notes.some((r) => Number(r.seq) === n)), summary: !refs.rest, prefix };
}

const READ_LIMIT = 11_000; // characters of notes sent to the free AI (~3,000 tokens)

/** Reads the chosen notes and answers the question about them (or summarizes them). */
async function readAndAnswer(
  chosen: Note[],
  question: string,
  follow: { ids: string[]; q: string; a: string } | undefined,
  opts: { summary?: boolean; name?: (n: Note) => string; footnote?: string } = {},
): Promise<AskResult> {
  const name = opts.name ?? label;
  const per = Math.max(1_500, Math.floor(READ_LIMIT / chosen.length));
  const material = chosen
    .map((n, i) => {
      const body = n.content.length > per ? `${n.content.slice(0, per)}\n…(rest of the note not shown)` : n.content;
      return `### NOTE ${i + 1}: ${name(n)} (edited ${n.updated_at.slice(0, 10)})\n${body.trim() || "(empty note: only the title)"}`;
    })
    .join("\n\n");
  const system = opts.summary
    ? [
        "You summarize the user's own notes, in Telegram.",
        "For each NOTE below, write a short summary: 2 to 5 sentences or short bullet points with the key points (dates, numbers, decisions, to-dos).",
        "Use ONLY the note; never invent. Write in the same language as the note. With several notes, start each summary with the note's title.",
        "Plain text: you may use simple bullets (- ) but no tables, no headings, no bold. No preface.",
      ].join("\n")
    : [
        "You answer questions about the user's own notes, in Telegram.",
        "Use ONLY the NOTES below. If they don't contain the answer, say so plainly (and what they do say about the topic, if anything). Never invent.",
        "Answer in the same language as the question. Be short and direct: a few sentences or short bullet points. When you use several notes, say which note each part comes from (by its title).",
        "Plain text: you may use simple bullets (- ) but no tables, no headings, no bold.",
      ].join("\n");
  const out = await aiChat(
    system,
    [
      ...(follow ? [{ text: `EARLIER QUESTION: ${follow.q.slice(0, 300)}\nYOUR EARLIER ANSWER: ${follow.a.slice(0, 800)}` }] : []),
      { text: `NOTES:\n${material}` },
      { text: opts.summary ? "Summarize the note(s) above." : `QUESTION: ${question.slice(0, 800)}` },
    ],
    { kind: "write", temperature: 0.3, maxTokens: 1500, timeoutMs: 40000 },
  );
  if (!("text" in out)) return { text: `✨ ${out.error}`, kb: [], noteIds: [] };
  const sources = chosen.map(name).join(" · ");
  return {
    text: `${forTelegram(out.text)}\n\n📄 From: ${sources}${opts.footnote ? `\n${opts.footnote}` : ""}\n↩ Reply to this message to ask more about these notes.`,
    kb: chosen.map((n) => [btn(`📄 ${label(n).slice(0, 40)}`, `no:${pk(n.id)}`)]),
    noteIds: chosen.map((n) => n.id),
  };
}

export async function askNotes(c: Ctx, question: string, follow?: { ids: string[]; q: string; a: string }): Promise<AskResult> {
  if (!question.trim()) return { text: "✨ Ask about your notes: “@os what did I write about the trip?”", kb: [], noteIds: [] };
  if (!hasAi()) return { text: "✨ The AI is not connected (GROQ_API_KEY in Vercel).", kb: [], noteIds: [] };

  // ---- 0) "@os NOTE-12 …": straight to that note (no search)
  const direct = await notesByRef(c, question).catch(() => null);
  if (direct) {
    const tag = (n: number) => `${direct.prefix}-${n}`;
    if (!direct.notes.length) {
      return {
        text: `🔎 I couldn't find ${direct.missing.map(tag).join(", ")}. Check the number in the note's ID property (or it was deleted).`,
        kb: [],
        noteIds: [],
      };
    }
    return readAndAnswer(direct.notes, question, follow, {
      summary: direct.summary,
      name: (n) => `${tag(Number((n as SeqNote).seq))} ${label(n)}`,
      footnote: direct.missing.length ? `(${direct.missing.map(tag).join(", ")} not found)` : undefined,
    });
  }

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
  return readAndAnswer(chosen, question, follow);
}
