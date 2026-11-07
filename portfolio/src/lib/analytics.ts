// Analytics: Vercel Web Analytics (no cookies, no personal data). Loaded only in production and only when the owner has it on.
export const ANALYTICS_SRC = "/_vercel/insights/script.js";
export function analyticsOn(site: { analytics_enabled: boolean }, env: Record<string, string | undefined> = process.env): boolean {
  return site.analytics_enabled === true && env.VERCEL_ENV === "production";
}
