// Portfolio — request signing between the OS and the public site (HMAC-SHA256 over "timestamp.body").
// Used for: OS → site revalidate/preview calls, and site → OS contact-form calls. The secret never leaves the servers.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-portfolio-signature";
export const TOLERANCE_SECONDS = 300;

const mac = (secret: string, ts: number, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

/** Value of the signature header: "t=<unix seconds>,v1=<hex>". */
export function signBody(secret: string, body: string, nowMs = Date.now()): string {
  const ts = Math.floor(nowMs / 1000);
  return `t=${ts},v1=${mac(secret, ts, body)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

export function verifySignature(secret: string, body: string, header: string | null | undefined, nowMs = Date.now(), tolerance = TOLERANCE_SECONDS): VerifyResult {
  if (!secret || !header) return { ok: false, reason: "missing" };
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return { ok: false, reason: "malformed" };
  const ts = Number(m[1]);
  if (Math.abs(Math.floor(nowMs / 1000) - ts) > tolerance) return { ok: false, reason: "expired" };
  const a = Buffer.from(mac(secret, ts, body), "hex");
  const b = Buffer.from(m[2], "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}
