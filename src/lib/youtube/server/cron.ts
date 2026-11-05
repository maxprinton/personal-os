// YouTube add-on work done by the 5-minute cron (server only). STUB by the Lead — Worker C owns this file
// and fills it: check-ins (48h/7d/30d/90d, reminder_log kind "ytcheck"), stats refresh, watched channels
// (weekly), weekly review ("ytweekly"), Google reconnect notice ("ytoauth").
// Called ONCE per cron run from src/app/api/cron/reminders/route.ts, for all users. Keep the signature.
// Rules: the admin client skips RLS → filter every query by user_id; one user's error must not stop the others;
// stay under `budgetMs` (the cron has other work); never throw (the route also wraps it in try/catch).
import type { SupabaseClient } from "@supabase/supabase-js";

export type YoutubeCronOpts = {
  /** TELEGRAM_BOT_TOKEN is set (messages can be sent) */
  botReady: boolean;
  /** time this function may use, in ms */
  budgetMs: number;
};
export type YoutubeCronResult = { sent: number; refreshed: number };

export async function runYoutubeCron(admin: SupabaseClient, opts: YoutubeCronOpts): Promise<YoutubeCronResult> {
  void admin;
  void opts;
  return { sent: 0, refreshed: 0 };
}
