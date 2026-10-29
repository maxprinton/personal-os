// What the ✨ AI in notes asks the AI (Groq) (pure: no network, no database; the route sends it).
// Every mode returns Markdown that the editor turns into real blocks after you accept it.
import { simplifyNotionMarkdown } from "@/lib/notion-md";

export const AI_MODES = [
  "summarize", // the whole page → a few bullet points
  "action-items", // the whole page (or the selection) → a to-do list
  "continue", // keep writing from the cursor
  "write", // free request ("a plan for…"), the page is context
  "summarize-selection",
  "improve",
  "fix",
  "shorter",
  "longer",
  "simplify",
  "tone", // prompt = the tone
  "translate", // prompt = the language
  "explain",
  "edit", // prompt = what to do with the selection
  "summarize-notes", // several notes → one summary note
] as const;
export type AiMode = (typeof AI_MODES)[number];

export type AiRequest = {
  mode: AiMode;
  /** Selected text (Markdown), or for "continue" the text before the cursor. */
  text?: string;
  /** The page being edited, for context. */
  page?: { title?: string; content?: string };
  /** The user's own words: the request, the tone, the language, the edit. */
  prompt?: string;
  /** Asking for changes to a draft the AI already wrote. */
  previous?: string;
  refine?: string;
  notes?: { title?: string; content?: string }[];
};

/** Modes that work on selected text (they need `text`). */
export const SELECTION_MODES: AiMode[] = ["summarize-selection", "improve", "fix", "shorter", "longer", "simplify", "tone", "translate", "explain", "edit"];
/** Modes whose answer replaces the selection (the rest go below it). */
export const REPLACING_MODES: AiMode[] = ["improve", "fix", "shorter", "longer", "simplify", "tone", "translate", "edit"];

const BASE = [
  "You are the writing assistant inside the user's personal notes app (like Notion AI).",
  "Reply ONLY with the content asked for, in Markdown: headings (##, ###), bullet or numbered lists, to-dos (- [ ] …), **bold**, *italic*, tables and > quotes are fine.",
  "No preface (\"Here is…\", \"Sure\"), no closing remarks, no questions back, never wrap the whole answer in a code block.",
  "Write in the same language as the user's text (they write in Spanish and in English) unless they ask for another one.",
].join("\n");

// Groq's free plan reads ~8,000 tokens a minute (question + answer), so what is sent stays near
// 14,000 characters (~4,000 tokens), leaving room for the answer.
export const LIMIT = 14_000;
const cut = (s: string | undefined, n = LIMIT) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}\n…(cut)` : t;
};
/** The END of a text (for "continue writing": what is right before the cursor matters). */
const tail = (s: string | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t.length > n ? `(…)${t.slice(-n)}` : t;
};
const clean = (md: string | undefined) => simplifyNotionMarkdown(md ?? "");

function pageBlock(page: AiRequest["page"], n = LIMIT) {
  const body = cut(clean(page?.content), n);
  return `PAGE TITLE: ${page?.title?.trim() || "Untitled"}\nPAGE CONTENT:\n${body || "(empty page)"}`;
}

const TASK: Record<Exclude<AiMode, "summarize-notes">, (r: AiRequest) => string> = {
  summarize: () =>
    "Summarize the page in 3–7 short bullet points, most important first. Keep names, numbers, dates and decisions. No heading.",
  "action-items": (r) =>
    `List the action items ${r.text ? "in the SELECTED TEXT" : "in the page"} as a to-do list (- [ ] …), one per line, short and concrete. If there are none, write one line saying so.`,
  continue: () =>
    "Continue writing from the end of TEXT BEFORE CURSOR: 1–3 paragraphs (or more list items if it ends in a list) that follow naturally, in the same style and language. Don't repeat what is already written.",
  write: (r) => `Write what the user asks: ${r.prompt?.trim() || "something useful for this page"}\nUse the page only as context when it helps.`,
  "summarize-selection": () => "Summarize the SELECTED TEXT in a few short bullet points. No heading.",
  improve: () => "Rewrite the SELECTED TEXT so it reads better: clearer, better flow, same meaning, same language, similar length. Keep its Markdown structure (a list stays a list).",
  fix: () => "Fix only spelling, grammar and punctuation in the SELECTED TEXT. Keep the wording, the language and the Markdown structure.",
  shorter: () => "Make the SELECTED TEXT about half as long, keeping what matters. Keep its Markdown structure.",
  longer: () => "Make the SELECTED TEXT longer and richer (about twice as long) with useful detail, same voice. Keep its Markdown structure.",
  simplify: () => "Rewrite the SELECTED TEXT in simple, plain words a 12-year-old would understand. Keep its Markdown structure.",
  tone: (r) => `Rewrite the SELECTED TEXT in a ${r.prompt?.trim() || "friendly"} tone. Same meaning, same language, keep its Markdown structure.`,
  translate: (r) => `Translate the SELECTED TEXT into ${r.prompt?.trim() || "English"}. Keep its Markdown structure. Only the translation.`,
  explain: () => "Explain the SELECTED TEXT simply in a short paragraph (or a few bullets if it has several ideas). Use the page for context.",
  edit: (r) => `Apply this to the SELECTED TEXT and return the new version: ${r.prompt?.trim() || "improve it"}\nKeep its Markdown structure unless asked otherwise.`,
};

/** The instructions and the material for one request, or an error to show. */
export function buildAiPrompt(r: AiRequest): { system: string; user: string; temperature: number } | { error: string } {
  if (!AI_MODES.includes(r.mode)) return { error: "Unknown AI action." };
  const temperature = r.mode === "fix" || r.mode === "translate" ? 0.2 : r.mode.startsWith("summarize") || r.mode === "action-items" ? 0.3 : 0.7;
  const refine =
    r.previous && r.refine?.trim()
      ? `\n\nYOUR PREVIOUS DRAFT:\n${cut(r.previous, 5_000)}\n\nTHE USER WANTS THIS CHANGED: ${r.refine.trim()}\nReturn the full new version of the draft (not only the changes).`
      : "";

  if (r.mode === "summarize-notes") {
    const notes = (r.notes ?? []).filter((n) => (n.content ?? "").trim() || (n.title ?? "").trim());
    if (!notes.length) return { error: "Those notes are empty." };
    const per = Math.max(1_200, Math.floor((LIMIT - 1_000) / notes.length));
    const material = notes.map((n, i) => `### NOTE ${i + 1}: ${n.title?.trim() || "Untitled"}\n${cut(clean(n.content), per) || "(empty)"}`).join("\n\n");
    const task =
      notes.length === 1
        ? "Summarize this note: one short overview paragraph, then the key points as bullets. Add a \"## To-dos\" section (- [ ] …) only if the note has pending actions."
        : `Summarize these ${notes.length} notes as one document: start with a short overview paragraph, then one ## section per main theme with bullet points (say which note an idea comes from when it helps), and finish with a "## To-dos" section (- [ ] …) only if the notes have pending actions.`;
    return { system: BASE, user: `${task}${refine}\n\n${material}`, temperature };
  }

  const needsText = SELECTION_MODES.includes(r.mode);
  if (needsText && !r.text?.trim()) return { error: "Select some text first." };
  if (r.mode === "write" && !r.prompt?.trim() && !refine) return { error: "Tell the AI what to write." };
  const parts = [TASK[r.mode](r) + refine];
  if (r.mode === "continue") {
    parts.push(`TEXT BEFORE CURSOR:\n${tail(clean(r.text), 10_000) || "(nothing yet)"}`);
    parts.push(`PAGE TITLE: ${r.page?.title?.trim() || "Untitled"}`);
  } else if (needsText || (r.mode === "action-items" && r.text)) {
    parts.push(`SELECTED TEXT:\n${cut(r.text, 8_000)}`);
    // The page as context, shorter: the selection is what matters
    parts.push(pageBlock(r.page, 4_000));
  } else parts.push(pageBlock(r.page, LIMIT));
  return { system: BASE, user: parts.join("\n\n"), temperature };
}

/** Takes off what models add even when told not to: a wrapping ```markdown fence, "Here is…" lines. */
export function cleanAiMarkdown(out: string): string {
  let t = out.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/^(?:here(?:'s| is)[^\n]{0,80}:|aquí (?:tienes|está)[^\n]{0,80}:)\s*\n+/i, "");
  return t.trim();
}
