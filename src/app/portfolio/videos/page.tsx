// /portfolio/videos — pick finished long videos from the YouTube add-on, order them, feature them, refresh them.
import VideosPanel from "@/components/portfolio/VideosPanel";
import { portfolioServer } from "@/lib/portfolio/db";
import { listVideos, pickable } from "@/lib/portfolio/videos";

export const metadata = { title: "Portfolio videos · Personal OS" };

export default async function PortfolioVideos() {
  const { supabase, userId } = await portfolioServer();
  if (!userId) return null;
  const [rows, picks] = await Promise.all([listVideos(supabase, userId), pickable(supabase, userId)]);
  return (
    <div className="max-w-4xl">
      <VideosPanel rows={rows} picks={picks} />
    </div>
  );
}
