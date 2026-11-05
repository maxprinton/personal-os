// YouTube add-on (Worker C) — Telegram texts for YouTube notices (check-ins, Google reconnect, watchlist).
// Used by src/lib/youtube/server/yt-oauth.ts (reconnect) and src/lib/youtube/server/cron.ts (check-ins,
// watchlist, Google consent ending soon). The weekly review text comes from src/lib/youtube/weekly.ts.
import { OAUTH_TESTING_DAYS } from "@/lib/youtube/constants";

const SETTINGS_PATH = "/youtube/settings";

export function appUrl() {
  const u = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/+$/, "");
}

/** "lost" = Google refused the refresh (consent ended); "soon" = the ~7-day consent ends within a day. */
export function reconnectText(kind: "lost" | "soon", base = appUrl()): string {
  const link = base ? `\n${base}${SETTINGS_PATH}` : "";
  if (kind === "soon")
    return `🔑 YouTube: your Google sign-in ends soon (test apps last about ${OAUTH_TESTING_DAYS} days). Open YouTube → Settings and press "Reconnect Google".${link}`;
  return `🔑 YouTube: Google sign-in expired, so publishing, A/B swaps and analytics are paused. Open YouTube → Settings and press "Reconnect Google" (about 30 seconds).${link}`;
}

/** Watchlist: "3 new outliers in watched channels". */
export function watchText(items: { title: string; score: number | null; channel?: string | null }[], base = appUrl()): string {
  const lines = items.slice(0, 5).map((o) => `• ${o.title}${o.score ? ` (${o.score}×)` : ""}${o.channel ? ` — ${o.channel}` : ""}`);
  const more = items.length > 5 ? `\n• …and ${items.length - 5} more` : "";
  return `👀 ${items.length} new outlier${items.length === 1 ? "" : "s"} in watched channels:\n${lines.join("\n")}${more}${base ? `\n${base}/youtube/watchlist` : ""}`;
}

/** Check-in nudge: "📈 V012 · name — 7 days: 1.2K views · CTR 5 % · 1.3× the usual". */
export function checkinText(o: { video: string; checkin: string; line: string | null; verdict: string | null; videoId: string; extra?: string | null; error?: string | null }, base = appUrl()): string {
  const icon = o.verdict === "above" ? "🟢" : o.verdict === "below" ? "🔴" : o.verdict === "normal" ? "⚪" : "📈";
  const lines = [`${icon} YouTube check-in · ${o.video} — ${o.checkin}`];
  if (o.line) lines.push(o.line);
  if (o.error) lines.push(`Could not read the numbers: ${o.error}`);
  if (o.extra) lines.push(o.extra);
  if (base) lines.push(`${base}/youtube/v/${o.videoId}/follow-up`);
  return lines.join("\n");
}
