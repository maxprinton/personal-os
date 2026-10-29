// ✨ AI summary of one note (pure helpers; the server action is src/app/notes-ai-actions.ts):
// what is sent to the AI and how its answer is cleaned into one short line.

/** Characters of the note sent to the free AI (keeps the request small). */
export const SUMMARY_INPUT_LIMIT = 12_000;
/** The line is asked to be ≤ 160 characters; anything longer than this is cut. */
export const SUMMARY_MAX = 200;

export const SUMMARY_SYSTEM = [
  "You write a one-line summary of a note from the user's personal notes app.",
  "Reply with ONE sentence of at most 160 characters that says what the note is about and its key point.",
  "Write it in the same language as the note (Spanish note → Spanish summary).",
  "No preface (no “This note…”, “Summary:”, “Resumen:”), no quotes, no Markdown, no line breaks.",
].join("\n");

/** The text for the AI, or null when the note is empty. */
export function summaryInput(title: string, plainText: string): string | null {
  const body = plainText.replace(/\n{3,}/g, "\n\n").trim();
  if (body.replace(/[\s•☐☑▸-]/g, "").length < 3) return null;
  const cut = body.length > SUMMARY_INPUT_LIMIT ? `${body.slice(0, SUMMARY_INPUT_LIMIT)}\n…(rest of the note not shown)` : body;
  return `TITLE: ${(title || "Untitled").slice(0, 300)}\n\nNOTE:\n${cut}`;
}

/** The AI's answer → one clean line (no fences, prefaces, quotes or Markdown), cut to SUMMARY_MAX. */
export function cleanSummary(raw: string): string {
  let s = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?|```/gi, "")
    .trim();
  // First non-empty line only
  s = s.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  s = s
    .replace(/^(?:[-*•]\s+|#{1,6}\s+)/, "")
    .replace(/^(?:here(?:'s| is) (?:the |a |your )?(?:one[- ]line )?summary|one[- ]line summary|summary|resumen(?: en una l[ií]nea)?|aqu[ií] (?:tienes|est[aá]) (?:el|un) resumen)\s*[:：-]\s*/i, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^["“”«'‘’]+|["“”»'‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > SUMMARY_MAX) {
    const cut = s.slice(0, SUMMARY_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    s = `${(sp > SUMMARY_MAX * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "")}…`;
  }
  return s;
}
