// Image model for covers: Cloudflare Workers AI, FLUX.1 [schnell] (free plan: 10,000 "Neurons" a day, about 50 pictures,
// resets at 00:00 UTC). Needs CF_ACCOUNT_ID and CF_API_TOKEN (permission "Workers AI: Run") in Vercel. Guide: ACTIVAR-PORTADAS-IA.md
const MODEL = "@cf/black-forest-labs/flux-1-schnell";

export function hasImageAi() {
  return !!(process.env.CF_ACCOUNT_ID?.trim() && process.env.CF_API_TOKEN?.trim());
}

export type ImageResult = { bytes: Uint8Array; mime: string } | { error: string; quota?: boolean };

/** Reads the answer of a failed call into a clear sentence (and says if it is the daily limit). */
export function imageErrorFrom(status: number, body: unknown): { error: string; quota?: boolean } {
  const errs = (body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors) ? (body as { errors: { code?: number; message?: string }[] }).errors : []) as { code?: number; message?: string }[];
  const msg = errs.map((e) => e?.message ?? "").join(" ").trim();
  if (status === 429 || errs.some((e) => e?.code === 4006) || /neurons|daily free allocation|rate limit/i.test(msg)) {
    return { error: "Today's free picture quota on Cloudflare is used up (it resets at 00:00 UTC). Try again later.", quota: true };
  }
  if (status === 401 || status === 403 || errs.some((e) => e?.code === 10000)) {
    return { error: "Cloudflare didn't accept the token. Check CF_API_TOKEN (permission “Workers AI: Run”) and CF_ACCOUNT_ID in Vercel." };
  }
  if (/flagged|nsfw|safety/i.test(msg)) return { error: "Cloudflare refused that picture. Try again for a different one." };
  return { error: msg ? `Cloudflare: ${msg.slice(0, 200)}` : `Cloudflare answered ${status}. Try again.` };
}

export async function generateImage(prompt: string, timeoutMs = 40000): Promise<ImageResult> {
  const account = process.env.CF_ACCOUNT_ID?.trim();
  const token = process.env.CF_API_TOKEN?.trim();
  if (!account || !token) return { error: "Pictures aren't connected: CF_ACCOUNT_ID and CF_API_TOKEN are missing in Vercel (see ACTIVAR-PORTADAS-IA.md)." };
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${MODEL}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 4 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) {
      if (!res.ok) return imageErrorFrom(res.status, null);
      return { bytes: new Uint8Array(await res.arrayBuffer()), mime: type.split(";")[0] };
    }
    const json = (await res.json().catch(() => null)) as { result?: { image?: string }; success?: boolean } | null;
    const b64 = json?.result?.image;
    if (!res.ok || !b64) return imageErrorFrom(res.status, json);
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    if (bytes.length < 500) return { error: "Cloudflare sent an empty picture. Try again." };
    return { bytes, mime: bytes[0] === 0x89 ? "image/png" : "image/jpeg" };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { error: timeout ? "Cloudflare took too long. Try again." : "Couldn't reach Cloudflare. Try again." };
  }
}
