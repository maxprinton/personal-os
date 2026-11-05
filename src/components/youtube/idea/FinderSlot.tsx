// Topic step: where Worker C's outlier finder mounts (src/components/youtube/finder/OutlierFinder.tsx).
// Until it exists (or without YOUTUBE_API_KEY) this explains how to check a topic by hand.
import Link from "next/link";

export default function FinderSlot({ topic }: { videoId: string; topic: string; savedYtIds: string[] }) {
  const q = encodeURIComponent(topic.slice(0, 120));
  return (
    <div className="space-y-2 text-sm text-muted">
      <p>
        The automatic outlier finder (YouTube Data API) appears here once it is set up. Meanwhile, search by hand and paste the best links below:
      </p>
      <a href={`https://www.youtube.com/results?search_query=${q}`} target="_blank" rel="noreferrer" className="inline-block rounded-md border border-line-strong px-2.5 py-1 text-fg hover:bg-subtle">
        Search “{topic.slice(0, 50)}{topic.length > 50 ? "…" : ""}” on YouTube ↗
      </a>
      <p className="text-xs text-faint">
        Look for videos with ≥ 3× the usual views of their channel, &gt; 100K views, from channels under 500K subscribers, older than 2 weeks. Filters live in{" "}
        <Link href="/youtube/settings" className="underline">Settings</Link>.
      </p>
    </div>
  );
}
