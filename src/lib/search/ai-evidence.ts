// AI summary of a search — pure part: turns the found notes (their properties + only the pieces where the
// words appear) into numbered excerpts that fit one call of Groq's free plan, and splits the AI's
// citations ([3], [2][5], [1, 4]) for the screen.
import { makeSnippet } from "@/lib/search/core";

export type EvidencePassage = { kind: string; label: string | null; anchor: string | null; body: string };
export type EvidenceNote = { id: string; title: string; parentTitle: string | null; updatedAt: string; props: string[]; passages: EvidencePassage[] };
export type SourcePassage = { label: string; text: string };
export type Source = { n: number; id: string; title: string; parentTitle: string | null; props: string[]; passages: SourcePassage[] };

/** Everything sent to the AI stays near this size (~4,000 tokens), so question + answer fit the free plan. */
export const EVIDENCE_BUDGET = 13_000;
export const MIN_PER_NOTE = 130;
export const MAX_PER_NOTE = 1_600;

/** Properties that say little about the content (left out to save room). */
const SKIP_PROP = /^(Words|Open to-dos|Backlinks|Kind|ID):/;

export function passageLabel(p: EvidencePassage): string {
  if (p.kind === "code") return `Code${p.label ? ` (${p.label})` : ""}`;
  if (p.kind === "file") return p.label ?? "File";
  if (p.kind === "media") return p.label ? `File ${p.label}` : "Media";
  if (p.kind === "table") return "Table";
  if (p.kind === "title") return "Title";
  if (p.kind === "heading") return "Heading";
  if (p.kind === "props") return "Properties";
  return p.anchor ? `Text under “${p.anchor.slice(0, 60)}”` : "Text";
}

/**
 * The excerpts for the AI: every note gets the same share of the budget (more each when fewer notes were
 * found), first its properties (at most a third of its share), then its best matching pieces.
 * Notes past what fits are left out and counted (the screen says "read X of N").
 */
export function buildEvidence(notes: EvidenceNote[], words: string[], budget = EVIDENCE_BUDGET): { text: string; sources: Source[]; left: number } {
  if (!notes.length) return { text: "", sources: [], left: 0 };
  const fits = Math.max(1, Math.floor(budget / MIN_PER_NOTE));
  const list = notes.slice(0, fits);
  const per = Math.max(MIN_PER_NOTE, Math.min(MAX_PER_NOTE, Math.floor(budget / list.length)));
  const blocks: string[] = [];
  const sources: Source[] = [];
  list.forEach((note, i) => {
    const n = i + 1;
    let room = per;
    const head = `[${n}] ${note.title || "Untitled"}${note.parentTitle ? ` (inside “${note.parentTitle}”)` : ""} · edited ${note.updatedAt.slice(0, 10)}`;
    const props = note.props.filter((l) => l.trim() && !SKIP_PROP.test(l));
    let propText = "";
    const usedProps: string[] = [];
    for (const l of props) {
      const line = l.length > 200 ? `${l.slice(0, 200)}…` : l;
      if (propText.length + line.length + 2 > Math.max(60, room / 3)) break;
      propText += (propText ? "; " : "") + line;
      usedProps.push(line);
    }
    room -= propText.length;
    const lines: string[] = [head];
    if (propText) lines.push(`Properties: ${propText}`);
    const used: SourcePassage[] = [];
    const passages = note.passages.filter((p) => p.kind !== "props");
    const each = passages.length ? Math.max(90, Math.floor(room / Math.min(passages.length, 4))) : 0;
    for (const p of passages) {
      if (room < 60) break;
      const snip = makeSnippet(p.body, words, Math.min(each, room)).text;
      if (!snip) continue;
      const label = passageLabel(p);
      lines.push(`- ${label}: ${snip}`);
      used.push({ label, text: snip });
      room -= snip.length + label.length + 4;
    }
    blocks.push(lines.join("\n"));
    sources.push({ n, id: note.id, title: note.title || "Untitled", parentTitle: note.parentTitle, props: usedProps, passages: used });
  });
  return { text: blocks.join("\n\n"), sources, left: notes.length - list.length };
}

export const SUMMARY_SYSTEM = [
  "You summarize search results from the user's personal notes app.",
  "You get the words the user searched for and numbered excerpts: for each note [n] its title, its properties (metadata such as type, status, tags, dates, AI summary) and ONLY the parts of the note where the words appear.",
  "Task: explain how the searched words relate to these notes: what the notes say about them, the main themes, how the notes connect or differ, and anything telling in the properties.",
  "Rules:",
  "- Use ONLY the excerpts. Never add outside knowledge and never guess what isn't written.",
  "- Cite every statement with the note number in square brackets, like [3] or [2][5]. Every note you mention must be cited; never cite a number that isn't in the excerpts.",
  "- Write in the language most of the excerpts are written in (Spanish or English).",
  "- Format in Markdown: one short opening paragraph (2–3 sentences) that answers \"what do my notes say about this?\", then 3–8 bullet points grouped by theme, each starting with the theme in **bold**. No headings, no preface, no closing remarks.",
  "- If the excerpts are too short to say much, say so in one sentence.",
].join("\n");

export function summaryPrompt(query: string, found: number, evidence: { text: string; sources: Source[] }): string {
  return `SEARCH: ${query}\nNOTES FOUND: ${found}${evidence.sources.length < found ? ` (excerpts of the best ${evidence.sources.length} below)` : ""}\n\n${evidence.text}`;
}

export type Piece = { text: string } | { cite: number[] };

/** "Plans [2][5] and [1, 3]." → text and citation pieces (only numbers that exist). */
export function splitCitations(line: string, max: number): Piece[] {
  const out: Piece[] = [];
  const re = /(?:\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\])+/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const nums = [...m[0].matchAll(/\d+/g)].map((x) => Number(x[0])).filter((x) => x >= 1 && x <= max);
    if (!nums.length) continue;
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    out.push({ cite: [...new Set(nums)] });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}
