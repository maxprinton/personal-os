// Server-only: Google Gemini (free API key from Google AI Studio → GEMINI_API_KEY in Vercel).
// Telegram: only when the rules can't understand a message, for voice notes and for receipt photos.
// Web: the ✨ AI in notes (summaries, writing help) through /api/ai.
// Note: on the free tier Google may use what is sent to improve its products.

const API = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Models tried in order (GEMINI_MODEL first if set). Free models change names now and then: if one is
 * gone (404) or out of free quota (429), the next one is tried.
 */
function models() {
  const list = [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
  return [...new Set(list.filter((m): m is string => Boolean(m && m.trim())).map((m) => m.trim()))];
}

export function hasGemini() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

/** One request; returns the model's text, or null on any problem (the caller falls back). */
export async function gemini(system: string, parts: GeminiPart[], opts: { json?: boolean; timeoutMs?: number } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
  });
  for (const model of models()) {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      });
      if (res.status === 404 || res.status === 429 || res.status === 400) {
        // 400 is also what an unknown model name gives; try the next model
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      return text || null;
    } catch {
      return null; // timeout or network: don't hold the bot up trying more models
    }
  }
  return null;
}

/** Same, expecting one JSON object back. */
export async function geminiJson(system: string, parts: GeminiPart[]): Promise<unknown | null> {
  const out = await gemini(system, parts, { json: true });
  if (!out) return null;
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(out.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Voice note → text (Spanish or English, as spoken). */
export async function transcribe(audioBase64: string, mimeType: string) {
  const out = await gemini(
    "Transcribe this voice note exactly as spoken (Spanish or English). Return only the transcript, no quotes, no comments. If there is no speech, return an empty line.",
    [{ inline_data: { mime_type: mimeType, data: audioBase64 } }],
    { timeoutMs: 20000 }
  );
  return out?.replace(/^["“]|["”]$/g, "").trim() || null;
}

/** For the bot's /ai command: is the key set, does it work, which model answers (or why not). */
export async function geminiCheck(): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "✨ Gemini is not connected: GEMINI_API_KEY is not set in Vercel (then publish again).";
  const problems: string[] = [];
  for (const model of models()) {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the word OK." }] }] }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return `✨ Gemini is connected and answering (model: ${model}). Voice notes, receipt photos and free text are on.`;
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      const why = body?.error?.message?.slice(0, 120) ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) return `✨ Gemini refused the key: ${why}. Create a new key in Google AI Studio and paste it in Vercel.`;
      problems.push(`${model}: ${res.status === 429 ? "free quota used up for now" : why}`);
    } catch {
      problems.push(`${model}: no answer (timeout)`);
    }
  }
  return `✨ Gemini didn't answer with any model:\n${problems.map((p) => `• ${p}`).join("\n")}\nSet GEMINI_MODEL in Vercel to a current Flash model name from ai.google.dev/models.`;
}

/**
 * For writing help in notes: like gemini() but with some creativity and a reason when it fails.
 * Gemini's free models are often busy (503) or briefly out of quota (429): each model gets a second
 * try after a short pause, then the next model is tried, all inside one time limit so the note never
 * waits forever.
 */
export async function geminiWrite(
  system: string,
  parts: GeminiPart[],
  opts: { temperature?: number; timeoutMs?: number } = {}
): Promise<{ text: string } | { error: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "Gemini is not connected: GEMINI_API_KEY is missing in Vercel." };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: opts.temperature ?? 0.7 },
  });
  const deadline = Date.now() + (opts.timeoutMs ?? 50000);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let busy = false;
  let quota = false;
  let slow = false;
  for (const model of models()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) return { error: slow ? "Gemini took too long. Try again." : busy ? "Gemini is busy right now (too many people using it). Try again in a minute." : "Gemini took too long. Try again." };
      try {
        const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
          signal: AbortSignal.timeout(Math.min(left, 30000)),
        });
        if (res.status === 404 || res.status === 400) break; // this model name doesn't exist: next model
        if (res.status === 401 || res.status === 403) return { error: "Gemini refused the key. Create a new one in Google AI Studio and paste it in Vercel." };
        if (res.status === 429 || res.status >= 500) {
          // Busy / overloaded / out of quota for a moment: one more try, then the next model
          if (res.status === 429) quota = true;
          else busy = true;
          if (attempt === 0) await wait(1200);
          continue;
        }
        if (!res.ok) return { error: `Gemini had a problem (HTTP ${res.status}). Try again.` };
        const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
        const c = json.candidates?.[0];
        const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
        if (text) return { text };
        if (c?.finishReason === "SAFETY") return { error: "Gemini declined to write that." };
        break; // empty answer: try the next model
      } catch {
        slow = true; // timeout or network: try the next model while there is time
        break;
      }
    }
  }
  if (busy) return { error: "Gemini is busy right now (too many people using it). Try again in a minute." };
  if (quota) return { error: "Gemini's free quota is used up for now. Try again in a minute (or tomorrow)." };
  if (slow) return { error: "Gemini took too long. Try again." };
  return { error: "No Gemini model answered. Set GEMINI_MODEL in Vercel to a current Flash model." };
}
