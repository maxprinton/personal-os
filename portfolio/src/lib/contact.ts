// The site's side of the contact form: checks the request, verifies Turnstile, then forwards a SIGNED message to the OS.
// Pure function over (request data, env, fetch) so it is tested without a network. The route file is a thin wrapper.
import { createHash } from "node:crypto";
import { validateContact } from "./contact-validate";
import { signBody, SIGNATURE_HEADER } from "./sign";
import { verifyTurnstile } from "./turnstile";

export const MIN_FILL_MS = 2000;
export const MAX_BODY = 12_000;
export type ContactEnv = Record<string, string | undefined>;
export type SiteReply = { status: number; body: { ok?: true; error?: "invalid" | "verify" | "too_many" | "unavailable" | "failed"; fields?: Record<string, string> } };

const hashIp = (ip: string, secret: string) => createHash("sha256").update(`${ip}|${secret}`).digest("hex").slice(0, 32);

export async function handleSiteContact(
  req: { body: string; ip: string | null; origin: string | null; host: string | null },
  env: ContactEnv,
  fetcher: typeof fetch = fetch,
): Promise<SiteReply> {
  const { TURNSTILE_SECRET_KEY: ts, PORTFOLIO_REVALIDATE_SECRET: secret, PORTFOLIO_OS_URL: os } = env;
  if (!ts || !secret || !os) return { status: 503, body: { error: "unavailable" } };
  // a browser form on another website cannot post here
  if (req.origin) {
    try {
      if (new URL(req.origin).host !== req.host) return { status: 403, body: { error: "invalid" } };
    } catch {
      return { status: 403, body: { error: "invalid" } };
    }
  }
  if (req.body.length > MAX_BODY) return { status: 413, body: { error: "invalid" } };
  let raw: Record<string, unknown>;
  try {
    const p = JSON.parse(req.body);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("shape");
    raw = p as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "invalid" } };
  }
  // honeypot: a person never sees this field. Pretend it worked, send nothing.
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { status: 200, body: { ok: true } };
  const v = validateContact(raw);
  if (!v.ok) return { status: 400, body: { error: "invalid", fields: v.errors } };
  const token = typeof raw.token === "string" ? raw.token : "";
  if (!(await verifyTurnstile(ts, token, req.ip, fetcher))) return { status: 400, body: { error: "verify" } };
  const elapsed = typeof raw.elapsed === "number" && Number.isFinite(raw.elapsed) ? raw.elapsed : null;
  const payload = JSON.stringify({ ...v.value, ip_hash: hashIp(req.ip ?? "unknown", secret), fast: elapsed !== null && elapsed < MIN_FILL_MS });
  try {
    const res = await fetcher(`${os.replace(/\/+$/, "")}/api/portfolio/contact`, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signBody(secret, payload) },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) return { status: 429, body: { error: "too_many" } };
    if (!res.ok) return { status: 502, body: { error: "failed" } };
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 502, body: { error: "failed" } };
  }
}
