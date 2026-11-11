// The AI in practice mode (server only): nothing is sent to Groq. It gives plausible answers built from the
// text the bot would have sent, so follow-ups, replies and buttons can be practiced. It is clearly marked as practice.
import type { AiPart } from "@/lib/ai";

type Out = { text: string; model?: string } | { error: string };

const textOf = (parts: AiPart[]) => parts.map((p) => ("text" in p ? p.text : "")).join("\n\n");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "### NOTE 1: Title (edited …)\n…text…" blocks, as ask.ts writes them. */
function notesIn(prompt: string): { name: string; body: string }[] {
  return [...prompt.matchAll(/### NOTE \d+: (.+?) \(edited [^)]*\)\n([\s\S]*?)(?=\n### NOTE \d+:|\nNOTES:|$)/g)].map((m) => ({
    name: m[1].trim(),
    body: m[2].replace(/^PROPERTIES:[\s\S]*?\nTEXT:\n/, "").replace(/\s+/g, " ").trim(),
  }));
}

export function fakeAiChat(system: string, parts: AiPart[], opts: { json?: boolean } = {}): Out {
  const prompt = textOf(parts);
  if (opts.json) {
    // "Which notes answer this?" → the first ones. Anything else: no JSON, so the callers use their own rules.
    if (/choose the notes most likely/i.test(system)) return { text: '{"notes":[1,2]}', model: "practice" };
    return { text: "null", model: "practice" };
  }
  const notes = notesIn(prompt);
  const follow = /EARLIER QUESTION:/.test(prompt);
  const mark = "(Practice answer: the real bot writes this with the AI.)";
  if (/^You summarize/i.test(system)) {
    if (!notes.length) return { text: `${mark}\nNothing to summarize.`, model: "practice" };
    return { text: `${mark}\n${notes.map((n) => `${notes.length > 1 ? `${n.name}: ` : ""}${clip(n.body || "(empty note)", 220)}`).join("\n")}`, model: "practice" };
  }
  if (!notes.length) return { text: `${mark}\n(Not in your notes) I found no note about that, so the real bot would answer from general knowledge here.`, model: "practice" };
  const lines = notes.slice(0, 3).map((n) => `- In “${n.name}”: ${clip(n.body || "(only a title)", 200)}`);
  return { text: `${follow ? "Following up on that: " : ""}${mark}\n${lines.join("\n")}`, model: "practice" };
}

export const FAKE_AI_CHECK = "✨ (Practice) The AI is connected. Practice answers are made up from your notes; nothing is sent to Groq and nothing is counted.";
