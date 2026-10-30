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
import { noteMetaMap } from "@/lib/notes-db/meta";

/** meta = the note's properties as lines ("Type: Idea", "AI summary: …"); the AI reads them too. */
type Note = { id: string; title: string; content: string; block_name: string | null; updated_at: string; meta?: string[]; md?: string; is_template?: boolean };
/** Earlier questions in this chat (last 45 minutes) or the answer you replied to. */
export type AskTurn = { ids: string[]; q: string; a: string };
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

/** Pieces of a note: by headings, then about 900 characters, each with the heading it sits under. */
export function noteChunks(md: string): { head: string; text: string }[] {
  const out: { head: string; text: string }[] = [];
  const sections: { head: string; lines: string[] }[] = [{ head: "", lines: [] }];
  for (const line of String(md ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line) ?? /<summary>(.*?)<\/summary>/i.exec(line);
    if (h) sections.push({ head: noteAsPlainText(h[1]).trim(), lines: [] });
    else sections.at(-1)!.lines.push(line);
  }
  for (const sec of sections) {
    const plain = noteAsPlainText(sec.lines.join("\n")).trim();
    if (!plain && !sec.head) continue;
    let buf = "";
    const flush = () => {
      if (buf.trim() || (!out.length && sec.head)) out.push({ head: sec.head, text: buf.trim() });
      buf = "";
    };
    for (const para of plain.split(/\n{2,}/)) {
      let p = para.trim();
      while (p.length > 900) {
        const cut = Math.max(p.lastIndexOf(". ", 900), p.lastIndexOf("\n", 900), 500);
        if (buf) flush();
        buf = p.slice(0, cut + 1);
        flush();
        p = p.slice(cut + 1).trim();
      }
      if (buf && buf.length + p.length > 900) flush();
      buf = buf ? `${buf}\n\n${p}` : p;
    }
    if (buf || sec.head) flush();
  }
  return out.filter((c) => c.text || c.head);
}

/**
 * What of a note is sent to the AI: all of it when it fits; otherwise its start plus the pieces that
 * best match the question (long study notes: the answer is often deep inside), in the note's order.
 */
export function excerpt(n: Pick<Note, "content" | "md">, words: string[], budget: number): string {
  if (n.content.length <= budget) return n.content;
  const chunks = noteChunks(n.md ?? n.content);
  if (!chunks.length) return n.content.slice(0, budget);
  const text = (c: { head: string; text: string }) => (c.head ? `[${c.head}]\n${c.text}` : c.text);
  const ranked = chunks.map((c, i) => ({ i, s: score({ title: c.head, content: c.text }, words), len: text(c).length + 2 })).sort((a, b) => b.s - a.s || a.i - b.i);
  // the start of the note (what it is about), but never more than a quarter of the room
  const startCap = Math.floor(budget / 4);
  const startHits = score({ title: chunks[0].head, content: chunks[0].text }, words) > 0;
  const start = text(chunks[0]).length > (startHits ? budget : startCap) ? `${text(chunks[0]).slice(0, startHits ? budget : startCap)}…` : text(chunks[0]);
  const pick = new Set<number>([0]);
  let used = start.length;
  for (const r of ranked) {
    if (r.s <= 0 || pick.has(r.i)) continue;
    if (used + r.len > budget) continue;
    pick.add(r.i);
    used += r.len;
  }
  // room left: the pieces right after the best ones (an answer often continues)
  for (const r of ranked.filter((x) => x.s > 0)) {
    const next = r.i + 1;
    if (next < chunks.length && !pick.has(next) && used + text(chunks[next]).length + 2 <= budget) {
      pick.add(next);
      used += text(chunks[next]).length + 2;
    }
  }
  const order = [...pick].sort((a, b) => a - b);
  let out = "";
  let prev = -1;
  for (const i of order) {
    if (prev >= 0 && i !== prev + 1) out += "\n…\n";
    else if (out) out += "\n\n";
    out += i === 0 ? start : text(chunks[i]);
    prev = i;
  }
  if (prev < chunks.length - 1) out += "\n…(more of this note not shown)";
  return out.slice(0, budget + 200);
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
    .map((n) => ({ ...n, md: n.content ?? "", content: noteAsPlainText(n.content ?? "") }));
  return { notes, missing: refs.nums.filter((n) => !notes.some((r) => Number(r.seq) === n)), summary: !refs.rest, prefix };
}

const READ_LIMIT = 11_000; // characters of notes sent to the free AI (~3,000 tokens)

/** Reads the chosen notes and answers the question about them (or summarizes them). */
async function readAndAnswer(
  chosen: Note[],
  question: string,
  follow: AskTurn | undefined,
  opts: { summary?: boolean; name?: (n: Note) => string; footnote?: string; today?: string; history?: AskTurn[] } = {},
): Promise<AskResult> {
  const name = opts.name ?? label;
  const per = Math.max(1_500, Math.floor(READ_LIMIT / Math.max(1, chosen.length)));
  const words = keywords(`${question} ${follow?.q ?? ""}`);
  const material = chosen
    .map((n, i) => {
      const body = opts.summary ? (n.content.length > per ? `${n.content.slice(0, per)}\n…(rest of the note not shown)` : n.content) : excerpt(n, words, per);
      const props = n.meta?.length ? `PROPERTIES:\n${n.meta.map((l) => `- ${l}`).join("\n")}\nTEXT:\n` : "";
      return `### NOTE ${i + 1}: ${name(n)} (edited ${n.updated_at.slice(0, 10)})\n${props}${body.trim() || "(empty note: only the title)"}`;
    })
    .join("\n\n");
  const system = opts.summary
    ? [
        "You summarize the user's own notes, in Telegram.",
        "For each NOTE below, write a short summary: 2 to 5 sentences or short bullet points with the key points (dates, numbers, decisions, to-dos).",
        "Use ONLY the note; never invent. Write in the same language as the note. With several notes, start each summary with the note's title.",
        "Each NOTE may start with its PROPERTIES (Type, Status, Area, Tags, dates, linked tasks, AI summary…): begin with one short line of the important ones.",
        "Plain text: you may use simple bullets (- ) but no tables, no headings, no bold. No preface.",
      ].join("\n")
    : [
        "You are the user's study and life assistant in Telegram. You answer from the user's own NOTES first (course notes, plans, diary…).",
        "1) Answer from the NOTES below and say which note each part comes from (by its title). Read them carefully: the answer may be in the middle of a note, worded differently from the question.",
        "2) If the notes cover only part of the question, or none of it, complete it with your general knowledge, and start that part with \"(Not in your notes)\" so the user knows. Never say the notes say something they don't.",
        "Each NOTE may start with its PROPERTIES (Type, Status, Area, Tags, Review on, ID, linked tasks / events, Block, AI summary, dates…): they are part of the note.",
        "The question may come from voice and be long or messy: answer what the user means.",
        opts.today ? `Today is ${opts.today}.` : "",
        "Answer in the same language as the question. Clear and useful, not long: a few sentences or short bullet points.",
        "Plain text: you may use simple bullets (- ) but no tables, no headings, no bold.",
      ].filter(Boolean).join("\n");
  const out = await aiChat(
    system,
    [
      ...(follow ? [{ text: `EARLIER QUESTION: ${follow.q.slice(0, 300)}\nYOUR EARLIER ANSWER: ${follow.a.slice(0, 800)}` }] : []),
      ...(!follow && opts.history?.length
        ? [{ text: `RECENT CONVERSATION (for context; the new question may refer to it):\n${opts.history.map((h) => `Q: ${h.q.slice(0, 200)}\nA: ${h.a.slice(0, 400)}`).join("\n")}` }]
        : []),
      { text: `NOTES:\n${material || "(No note matched this question.)"}` },
      { text: opts.summary ? "Summarize the note(s) above." : `QUESTION: ${question.slice(0, 800)}` },
    ],
    { kind: "write", temperature: 0.3, maxTokens: 1500, timeoutMs: 40000 },
  );
  if (!("text" in out)) return { text: `✨ ${out.error}`, kb: [], noteIds: [] };
  const sources = chosen.map(name).join(" · ");
  return {
    text: `${forTelegram(out.text)}\n\n${sources ? `📄 From: ${sources}` : "📄 No note matched: general answer"}${opts.footnote ? `\n${opts.footnote}` : ""}\n↩ Reply to this message to ask more about ${sources ? "these notes" : "it"}.`,
    kb: chosen.map((n) => [btn(`📄 ${label(n).slice(0, 40)}`, `no:${pk(n.id)}`)]),
    noteIds: chosen.map((n) => n.id),
  };
}

export async function askNotes(c: Ctx, question: string, follow?: AskTurn, history: AskTurn[] = []): Promise<AskResult> {
  if (!question.trim()) return { text: "✨ Ask about your notes: “@os what did I write about the trip?”", kb: [], noteIds: [] };
  if (!hasAi()) return { text: "✨ The AI is not connected (GROQ_API_KEY in Vercel).", kb: [], noteIds: [] };

  const metaP = noteMetaMap(c.admin, c.userId); // every note's properties (loads in parallel)
  const withMeta = async <T extends Note>(list: T[]): Promise<T[]> => {
    const meta = await metaP;
    return list.map((n) => ({ ...n, meta: meta.get(n.id) ?? [] }));
  };

  // ---- 0) "@os NOTE-12 …": straight to that note (no search)
  const direct = await notesByRef(c, question).catch(() => null);
  if (direct) {
    direct.notes = await withMeta(direct.notes);
    const tag = (n: number) => `${direct.prefix}-${n}`;
    if (!direct.notes.length) {
      return {
        text: `🔎 I couldn't find ${direct.missing.map(tag).join(", ")}. Check the number in the note's ID property (or it was deleted).`,
        kb: [],
        noteIds: [],
      };
    }
    return readAndAnswer(direct.notes, question, follow, {
      today: c.today,
      history,
      summary: direct.summary,
      name: (n) => `${tag(Number((n as SeqNote).seq))} ${label(n)}`,
      footnote: direct.missing.length ? `(${direct.missing.map(tag).join(", ")} not found)` : undefined,
    });
  }

  const rows = await fetchAll<Note>((a, b) =>
    c.admin.from("notes").select("id,title,content,block_name,updated_at,is_template").eq("user_id", c.userId).is("deleted_at", null).order("updated_at", { ascending: false }).range(a, b),
  ).catch(() =>
    fetchAll<Note>((a, b) => c.admin.from("notes").select("id,title,content,block_name,updated_at").eq("user_id", c.userId).is("deleted_at", null).order("updated_at", { ascending: false }).range(a, b)),
  );
  // templates are not notes; md = the note as written (its headings help pick the right part of a long note)
  const notes: Note[] = (await withMeta(rows.filter((n) => !n.is_template).map((n): Note => ({ ...n, md: n.content ?? "", content: noteAsPlainText(n.content ?? "") })))).filter(
    (n) => n.content.trim() || n.title.trim() || n.meta?.length,
  );
  if (!notes.length) return { text: "📝 You don't have notes yet.", kb: [], noteIds: [] };

  // ---- 1) Find
  const words = keywords(question);
  // Properties count for finding too ("notes with Status Lista", "tagged #trip", "AI summary says…")
  const ranked = notes.map((n) => ({ n, s: score({ title: n.title, content: `${n.content}\n${(n.meta ?? []).join("\n")}` }, words) })).sort((a, b) => b.s - a.s);
  const matched = ranked.filter((r) => r.s > 0).slice(0, 20).map((r) => r.n);
  const pool = [...matched];
  const earlier = new Set([...(follow?.ids ?? []), ...history.flatMap((h) => h.ids)]);
  for (const n of notes.filter((x) => earlier.has(x.id))) if (!pool.includes(n)) pool.unshift(n);
  for (const n of notes) {
    if (pool.length >= 30) break;
    if (!pool.includes(n)) pool.push(n); // the latest notes, in case the question uses other words
  }
  const short = (n: Note) => {
    const meta = (n.meta ?? []).filter((l) => !/^(Created|Last edited|Words|Open to-dos|Backlinks):/.test(l));
    const summary = meta.filter((l) => l.startsWith("AI summary:"));
    return [...summary, ...meta.filter((l) => !l.startsWith("AI summary:"))].join("; ").slice(0, 300);
  };
  const list = pool.map((n, i) => `[${i + 1}] ${label(n)} (edited ${n.updated_at.slice(0, 10)}): ${preview(n.content, words)}${short(n) ? ` {${short(n)}}` : ""}`).join("\n");
  const pick = await aiJson(
    [
      "You help find notes in the user's personal notes app.",
      "Given a QUESTION and a numbered list of notes (title + preview + {its properties}), choose the notes most likely to contain the answer.",
      'Return {"notes":[numbers]} with 1 to 4 numbers, best first. If the question asks about several topics or notes, include each one. If none fits, return {"notes":[]}.',
      follow ? "This is a follow-up question; the previous notes are first in the list and usually still apply." : "",
    ].filter(Boolean).join("\n"),
    [{ text: `QUESTION: ${question.slice(0, 500)}${follow ? `\nPREVIOUS QUESTION: ${follow.q.slice(0, 300)}` : ""}\n\nNOTES:\n${list}` }],
    "fast",
  );
  const nums = Array.isArray((pick as { notes?: unknown } | null)?.notes) ? ((pick as { notes: unknown[] }).notes as unknown[]) : null;
  let chosen = (nums ?? []).map((x) => pool[Number(x) - 1]).filter((n): n is Note => Boolean(n));
  if (!nums) chosen = matched.slice(0, 3); // the AI didn't answer: the best word matches
  if (!chosen.length) chosen = matched.slice(0, 2); // it said "none" but words match: read them anyway
  if (!chosen.length && earlier.size) chosen = notes.filter((n) => earlier.has(n.id));
  chosen = [...new Set(chosen)].slice(0, 4);

  // ---- 2) Read and answer (no note at all: a general answer, said so)
  return readAndAnswer(chosen, question, follow, { today: c.today, history });
}
