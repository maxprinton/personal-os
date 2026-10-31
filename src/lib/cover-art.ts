// ✨ AI cover art (pure helpers; the server part is src/lib/cover-gen.ts, the route is /api/cover).
// Two steps so every cover is about the note AND looks like the same family:
//   1) Groq reads the note and thinks: what is it about → what idea → what simple object/scene stands for it → the scene.
//   2) The scene + ONE fixed style (COVER_STYLE below) go to the image model (Cloudflare FLUX).
// Want another look for all covers? Change COVER_STYLE only.
import { COVERS } from "@/lib/covers";

/** The "brand" of every cover. Colors are named (image models follow names better than hex codes).
 *  The background must be ONE flat color and nothing may touch the edges: that is what lets src/lib/cover-fit.ts cut the picture
 *  tight around the subject and blend it into any frame (page cover, gallery cards of every size). */
export const COVER_STYLE = [
  "Flat minimalist vector illustration in a calm editorial style:",
  "soft rounded geometric shapes in a limited palette of deep teal, dusty coral and a touch of mustard,",
  "on a plain solid flat warm cream background: one single color, no gradient, no vignette, no texture, no grain, no shadows on the background.",
  "Centered composition with generous empty margins on all sides: nothing touches or crosses the edges of the picture.",
  "No text, no letters, no numbers, no logos, no watermark, no border, no frame, no human faces.",
].join(" ");

/** Characters of the note sent to the AI (a cover only needs the gist). */
export const COVER_INPUT_LIMIT = 6000;
/** Longest scene kept (the image model reads about 2,000 characters). */
export const SCENE_MAX = 420;
export const IDEA_MAX = 300;

export const COVER_SYSTEM = [
  "You are the art director of a personal notes app. You design the cover picture of one note.",
  "Think in this order and reply with ONLY a JSON object (no Markdown, no comments) with these keys in this exact order:",
  '"about": one short sentence saying what the note is really about (its purpose, not its format),',
  '"idea": the single idea or feeling a reader should get at a glance,',
  '"metaphor": ONE simple, concrete object or scene that stands for that idea. Prefer a clear everyday object over an abstract concept. Never a screenshot of the text, never anything with writing on it,',
  '"scene": what the picture shows, max 45 words: the main subject in the center plus one to three small supporting elements. Only what is visible. Do not mention style, colors, mood words or the medium (those are added separately).',
  "Prefer a horizontal arrangement (elements side by side) over a tall stack: the picture is shown in a wide frame.",
  "Write every value in English, even if the note is in another language.",
  "If the user gives a DIRECTION, follow it for the metaphor and scene.",
].join("\n");

/** What goes to the AI, or null when there is nothing to go on. */
export function coverInput(title: string, plainText: string, idea?: string | null): string | null {
  const body = (plainText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  const t = (title ?? "").trim();
  const hint = (idea ?? "").replace(/\s+/g, " ").trim().slice(0, IDEA_MAX);
  if (!hint && !t && body.replace(/[\s•☐☑▸-]/g, "").length < 3) return null;
  const cut = body.length > COVER_INPUT_LIMIT ? `${body.slice(0, COVER_INPUT_LIMIT)}\n…(rest of the note not shown)` : body;
  return [`TITLE: ${(t || "Untitled").slice(0, 300)}`, cut ? `NOTE:\n${cut}` : "NOTE: (empty)", hint ? `DIRECTION FROM THE USER: ${hint}` : ""].filter(Boolean).join("\n\n");
}

export type CoverPlan = { about: string; idea: string; metaphor: string; scene: string };

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\s+/g, " ").replace(/^["“”']+|["“”']+$/g, "").trim().slice(0, max) : "";

/** The AI's answer → the plan, or null when there is no usable scene. */
export function parseCoverPlan(raw: string): CoverPlan | null {
  const s = String(raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?|```/gi, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  let scene = clean(o.scene, SCENE_MAX);
  const metaphor = clean(o.metaphor, 200);
  if (scene.length < 8) scene = metaphor;
  if (scene.length < 8) return null;
  // Text inside the picture is the thing image models get wrong: keep only the scene, never "a sign that says…"
  scene = scene.replace(/\b(?:that|which) (?:says|reads|spells)\b[^.,;]*/gi, "").replace(/\s+/g, " ").trim();
  return { about: clean(o.about, 200), idea: clean(o.idea, 200), metaphor, scene };
}

/** The scene + the one house style → the prompt for the image model. */
export function buildImagePrompt(scene: string): string {
  const s = clean(scene, SCENE_MAX).replace(/[.!\s]+$/, "");
  return `${s}. ${COVER_STYLE}`;
}

/** What is kept in the note about its last AI picture: the prompt, whoever wrote it (the AI's scene, your idea, or both). */
export type CoverPromptRecord = { prompt: string; scene: string; idea: string; at: string };

export function promptRecord(scene: string, idea?: string | null, at = new Date().toISOString()): CoverPromptRecord {
  return { prompt: buildImagePrompt(scene), scene: clean(scene, SCENE_MAX), idea: (idea ?? "").replace(/\s+/g, " ").trim().slice(0, IDEA_MAX), at };
}

// ---- how an AI cover is marked in the note: ".../covers/ai-xxxx.webp#bg=f3ebdd" (the "#bg" is the picture's background color)
const AI_COVER = /\/covers\/ai-/;
export const isAiCover = (cover: string | null | undefined) => !!cover && AI_COVER.test(cover);
/** The background color (6 hex digits) of a fitted AI cover, or null. */
export const coverBg = (cover: string | null | undefined): string | null => /#bg=([0-9a-f]{6})$/i.exec(cover ?? "")?.[1]?.toLowerCase() ?? null;
export const withCoverBg = (url: string, hex: string) => `${url.replace(/#.*$/, "")}#bg=${hex}`;
/** An AI cover made before fitting existed (no background color): it can be fitted again without asking the AI. */
export const needsFit = (cover: string | null | undefined) => isAiCover(cover) && !coverBg(cover);

/** The bulk button may put a new picture on a note with no cover, or with a color or gradient. Its own pictures and AI covers are never replaced (an AI cover is changed from the note: “Try another”). */
export function isReplaceableCover(cover: string | null | undefined): boolean {
  if (!cover) return true;
  return COVERS.some((c) => c.id === cover);
}
