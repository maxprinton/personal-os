// YouTube add-on (Worker C) — Telegram texts for YouTube notices (check-ins, Google reconnect, watchlist).
// Round 1: only the Google reconnect text (used by src/lib/youtube/server/yt-oauth.ts). Check-in and weekly
// nudges arrive with the cron work (round 3).
import { OAUTH_TESTING_DAYS } from "@/lib/youtube/constants";

const SETTINGS_PATH = "/youtube/settings";

function appUrl() {
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
