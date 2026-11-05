// /youtube/weekly (Worker C) — the weekly channel review: on demand ("Run now") and automatic on the day/time
// chosen in YouTube → Settings (Telegram message + note "YouTube weekly"). Shows past reviews.
import Link from "next/link";
import { DEFAULT_WEEKLY } from "@/lib/youtube/constants";
import { getYtSettings, isMissingTable, ytServer } from "@/lib/youtube/db";
import { weekdayName } from "@/lib/youtube/weekly";
import type { YtWeekly } from "@/lib/youtube/types";
import WeeklyView from "@/components/youtube/results/WeeklyView";

export const metadata = { title: "Weekly review · YouTube · Personal OS" };
export const dynamic = "force-dynamic";

export default async function WeeklyPage() {
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  const [{ settings }, rows, us] = await Promise.all([
    getYtSettings(),
    supabase.from("yt_weekly").select("*").eq("user_id", userId).order("week_start", { ascending: false }).limit(12),
    supabase.from("user_settings").select("telegram_chat_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (isMissingTable(rows.error)) return null;
  const prefs = settings?.weekly_review ?? DEFAULT_WEEKLY;
  const where = [prefs.telegram ? "Telegram" : null, prefs.note ? "a note" : null].filter(Boolean).join(" + ");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Weekly review</h2>
        <p className="text-sm text-muted">
          {where ? (
            <>
              Automatic every <b>{weekdayName(prefs.day)}</b> at <b>{prefs.time}</b> → {where}.{" "}
            </>
          ) : (
            <>Automatic review is off. </>
          )}
          <Link className="text-accent underline" href="/youtube/settings">
            Change in Settings
          </Link>
          .
        </p>
      </div>
      <WeeklyView rows={(rows.data ?? []) as YtWeekly[]} telegram={!!us.data?.telegram_chat_id} />
    </div>
  );
}
