// Server-only: the AI of Personal OS = Groq (free key from console.groq.com → GROQ_API_KEY in Vercel).
// Groq's free plan: no card, it doesn't train on what you send, ~1,000 requests a day per model and
// ~8,000 tokens a minute. Used for: the ✨ AI in notes, Telegram voice notes (Whisper), receipt
// photos (a vision model) and messages the bot's rules can't understand.
// Groq changes its free models now and then, so the models are picked from the list your key can use
// (asked once and remembered for an hour); AI_MODEL / AI_VISION_MODEL in Vercel can force one.

const API = "https://api.groq.com/openai/v1";

export type AiPart = { text: string } | { image: { mime: string; base64: string } };
export type AiKind = "write" | "fast" | "vision";

export function hasAi() {
  return Boolean(process.env.GROQ_API_KEY);
}

// Preferred models, best first. Only the ones your key really has are used.
const PREFER: Record<AiKind, string[]> = {
  write: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
  fast: ["openai/gpt-oss-20b", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile", "qwen/qwen3-32b"],
  vision: ["qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"],
};
const WHISPER = ["whisper-large-v3-turbo", "whisper-large-v3"];
const NOT_CHAT = /whisper|guard|tts|playai|orpheus|compound|distil|embed|safeguard/i;

let cache: { at: number; ids: string[] } | null = null;

/** The models this key can use right now (null = couldn't ask; then the preferred list is tried as is). */
export async function availableModels(): Promise<string[] | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  if (cache && Date.now() - cache.at < 3600_000) return cache.ids;
  try {
    const res = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { id: string; active?: boolean }[] };
    const ids = (json.data ?? []).filter((m) => m.active !== false).map((m) => m.id);
    if (!ids.length) return null;
    cache = { at: Date.now(), ids };
    return ids;
  } catch {
    return null;
  }
}

export async function modelsFor(kind: AiKind): Promise<string[]> {
  const forced = (kind === "vision" ? process.env.AI_VISION_MODEL : process.env.AI_MODEL)?.trim();
  const have = await availableModels();
  const prefer = PREFER[kind];
  let list: string[];
  if (!have) list = prefer;
  else {
    list = prefer.filter((m) => have.includes(m));
    // New models Groq added that aren't in the list yet: use them after the known ones
    if (kind === "vision") list.push(...have.filter((m) => /vision|scout|maverick|qwen3\.\d+-\d+b|vl\b/i.test(m) && !list.includes(m)));
    else list.push(...have.filter((m) => !NOT_CHAT.test(m) && !list.includes(m)));
  }
  return [...new Set([forced, ...list].filter((m): m is string => Boolean(m)))].slice(0, 5);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Reasoning models write their thinking in <think>…</think>; only the answer is kept. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

function toMessages(system: string, parts: AiPart[]) {
  const hasImage = parts.some((p) => "image" in p);
  const content = hasImage
    ? parts.map((p) => ("image" in p ? { type: "image_url", image_url: { url: `data:${p.image.mime};base64,${p.image.base64}` } } : { type: "text", text: p.text }))
    : parts.map((p) => ("text" in p ? p.text : "")).join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content },
  ];
}

export type AiResult = { text: string; model?: string } | { error: string };

/**
 * One answer from the AI. Busy (5xx) → one more try; out of quota (429) or a model that's gone → the next
 * model; all inside one time limit so nothing waits forever. Returns the text or a clear reason.
 */
export async function aiChat(
  system: string,
  parts: AiPart[],
  opts: { kind?: AiKind; json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<AiResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const kind = opts.kind ?? "write";
  const deadline = Date.now() + (opts.timeoutMs ?? 45000);
  const messages = toMessages(system, parts);
  let quota = false;
  let busy = false;
  let slow = false;
  let tooBig = false;
  for (const model of await modelsFor(kind)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 2500) return { error: busy ? "The AI is busy right now. Try again in a minute." : "The AI took too long. Try again." };
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: opts.temperature ?? 0.6,
        max_completion_tokens: opts.maxTokens ?? 2500,
      };
      if (opts.json) body.response_format = { type: "json_object" };
      if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
      try {
        const res = await fetch(`${API}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(left, 30000)),
        });
        if (res.status === 401 || res.status === 403) return { error: "Groq refused the key. Create a new one at console.groq.com and paste it in Vercel (GROQ_API_KEY)." };
        if (res.status === 429) {
          quota = true;
          break; // this model's free limit is used up for now: next model
        }
        if (res.status === 413) {
          tooBig = true;
          break;
        }
        if (res.status >= 500) {
          busy = true;
          if (attempt === 0) await wait(1000);
          continue;
        }
        if (!res.ok) {
          // 400/404: this model doesn't take this request (gone, no JSON mode, no images…): next model
          const why = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
          if (/context|too long|maximum|tokens/i.test(why)) tooBig = true;
          break;
        }
        const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
        const text = stripThinking(json.choices?.[0]?.message?.content ?? "");
        if (text) return { text, model };
        break;
      } catch {
        slow = true;
        break;
      }
    }
  }
  if (tooBig) return { error: "That's too much text for the free AI at once. Select a smaller part (or fewer notes) and try again." };
  if (quota) return { error: "The free AI limit is used up for now. Try again in a minute (or tomorrow)." };
  if (busy) return { error: "The AI is busy right now. Try again in a minute." };
  if (slow) return { error: "The AI took too long. Try again." };
  return { error: "No AI model answered. Check GROQ_API_KEY in Vercel, or ask the bot /ai." };
}

/** Same, expecting one JSON object back (null on any problem: callers fall back to the rules). */
export async function aiJson(system: string, parts: AiPart[], kind: AiKind = "fast"): Promise<unknown | null> {
  const out = await aiChat(`${system}\nReply with ONE JSON object only.`, parts, { kind, json: true, temperature: 0, maxTokens: 800, timeoutMs: 20000 });
  if (!("text" in out)) return null;
  const start = out.text.indexOf("{");
  const end = out.text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(out.text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Voice note → text with Whisper (Spanish or English, as spoken). */
export async function transcribe(audioBase64: string, mimeType: string): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const ext = /mpeg|mp3/.test(mimeType) ? "mp3" : /mp4|m4a|aac/.test(mimeType) ? "m4a" : /wav/.test(mimeType) ? "wav" : /webm/.test(mimeType) ? "webm" : "ogg";
  const bytes = Buffer.from(audioBase64, "base64");
  for (const model of WHISPER) {
    try {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: mimeType || "audio/ogg" }), `voice.${ext}`);
      form.append("model", model);
      form.append("response_format", "json");
      form.append("temperature", "0");
      const res = await fetch(`${API}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { text?: string };
      const text = json.text?.trim();
      if (text) return text;
    } catch {
      // next model
    }
  }
  return null;
}

/** For the bot's /ai command: is the key set, does it work, which models answer. */
export async function aiCheck(): Promise<string> {
  if (!hasAi()) return "✨ The AI is not connected: GROQ_API_KEY is not set in Vercel (then publish again). Guide: ACTIVAR-GROQ.md.";
  const have = await availableModels();
  if (!have) {
    const res = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` } }).catch(() => null);
    if (res && (res.status === 401 || res.status === 403)) return "✨ Groq refused the key. Create a new one at console.groq.com and paste it in Vercel (GROQ_API_KEY).";
    return "✨ Groq didn't answer right now. Try /ai again in a minute.";
  }
  const out = await aiChat("Reply with the word OK.", [{ text: "Say OK" }], { kind: "fast", maxTokens: 200, timeoutMs: 15000 });
  const write = (await modelsFor("write"))[0] ?? "—";
  const vision = (await modelsFor("vision"))[0] ?? "none";
  const voice = WHISPER.find((m) => have.includes(m)) ?? "none";
  if (!("text" in out)) return `✨ Groq is connected but didn't answer: ${out.error}`;
  return `✨ The AI (Groq) is connected and answering.\n• Notes and text: ${write}\n• Receipt photos: ${vision}\n• Voice notes: ${voice}`;
}
