// Portfolio publishing — tells the public site to refresh the pages that changed (signed request). SERVER only.
import { SIGNATURE_HEADER, signBody } from "@/lib/portfolio/sign";
import type { Affected } from "./engine";

export type NotifyResult = { ok: boolean; skipped?: boolean; error?: string };

/** Needs PORTFOLIO_SITE_URL and PORTFOLIO_REVALIDATE_SECRET. Without them it does nothing (the site refreshes by itself within minutes). */
export async function notifySite(items: Affected[], env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<NotifyResult> {
  const base = env.PORTFOLIO_SITE_URL?.replace(/\/+$/, "");
  const secret = env.PORTFOLIO_REVALIDATE_SECRET;
  if (!base || !secret) return { ok: true, skipped: true };
  const body = JSON.stringify({ items });
  try {
    const res = await fetcher(`${base}/api/revalidate`, { method: "POST", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signBody(secret, body) }, body, signal: AbortSignal.timeout(8000) });
    return res.ok ? { ok: true } : { ok: false, error: `Site answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the site" };
  }
}
