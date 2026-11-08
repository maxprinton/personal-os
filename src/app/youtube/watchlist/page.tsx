// /youtube/watchlist (Worker C) — channels to watch + the "New outliers" inbox.
// Each active channel is checked once a week (cron, round 3) or with "Check now"; uploads with ≥ 3× the
// channel's usual views land in the inbox → save as reference, turn into an idea, or dismiss.
import { WATCH_CHECK_DAYS, WATCH_OUTLIER_MIN } from "@/lib/youtube/constants";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import type { YtWatchChannel, YtWatchOutlier } from "@/lib/youtube/types";
import WatchlistView from "@/components/youtube/finder/WatchlistView";

export const metadata = { title: "Watchlist · YouTube · Personal OS" };
export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  const [ch, out] = await Promise.all([
    supabase.from("yt_watch_channels").select("*").eq("user_id", userId).order("title"),
    supabase.from("yt_watch_outliers").select("*").eq("user_id", userId).order("found_at", { ascending: false }).limit(200),
  ]);
  if (isMissingTable(ch.error) || isMissingTable(out.error)) return null; // the layout shows the migration panel
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-lg font-semibold">Watchlist</h2>
        <p className="text-sm text-muted">
          Channels in your niche. Once a day their new uploads are checked; videos with ≥ {WATCH_OUTLIER_MIN}× the channel’s usual views show up in “New outliers”
          (every {WATCH_CHECK_DAYS === 1 ? "day" : `${WATCH_CHECK_DAYS} days`}, or press Check now).
        </p>
      </div>
      <WatchlistView
        channels={(ch.data ?? []) as YtWatchChannel[]}
        outliers={(out.data ?? []) as YtWatchOutlier[]}
        apiKey={!!process.env.YOUTUBE_API_KEY?.trim()}
        error={ch.error?.message ?? out.error?.message ?? null}
      />
    </div>
  );
}
