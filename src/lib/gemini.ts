// Server-only: Google Gemini (free API key from Google AI Studio → GEMINI_API_KEY in Vercel).
// Used only when the rules can't understand a message, for voice notes and for receipt photos.
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
