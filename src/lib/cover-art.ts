// ✨ AI cover art (pure helpers; the server part is src/lib/cover-gen.ts, the route is /api/cover).
// Two steps so every cover is about the note AND looks like the same family:
//   1) Groq reads the note and thinks: what is it about → what idea → what simple object/scene stands for it → the scene.
//   2) The scene + ONE fixed style (COVER_STYLE below) go to the image model (Cloudflare FLUX).
// Want another look for all covers? Change COVER_STYLE only.
import { COVERS } from "@/lib/covers";

/** The "brand" of every cover. Colors are named (image models follow names better than hex codes). */
export const COVER_STYLE = [
  "Flat minimalist vector illustration in a calm editorial style:",
  "soft rounded geometric shapes, a limited palette of warm cream background, deep teal, dusty coral and a touch of mustard,",
  "subtle paper grain, soft gentle shadows, lots of empty space.",
  "Wide banner composition: the main subject centered in the middle band, with plain empty space above and below so it survives a wide crop.",
  "No text, no letters, no numbers, no logos, no watermark, no border, no human faces.",
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

/** A cover made of colors, a gradient, nothing, or an earlier AI picture may be replaced by the bulk button; the user's own pictures never. */
export function isReplaceableCover(cover: string | null | undefined): boolean {
  if (!cover) return true;
  if (COVERS.some((c) => c.id === cover)) return true;
  return /\/covers\/ai-/.test(cover);
}
