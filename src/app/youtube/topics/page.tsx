// /youtube/topics — every topic, its status on YOUR channel, and which formats you've tried (Topic + Format = Idea).
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { loadTopics } from "@/lib/youtube/server/topics";
import TopicsView from "@/components/youtube/topics/TopicsView";

export const metadata = { title: "Topics · YouTube · Personal OS" };
export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  const r = await loadTopics(supabase, userId);
  if (r.missing) {
    return (
      <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
        Topics need one more migration: run <b>MIGRACION-0051-youtube-topics.sql</b> in Supabase (SQL Editor), then reload.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Topics</h2>
        <p className="text-sm text-muted">
          A topic with a format is an idea, and the pair is used once. Test a topic in other formats to learn if it works on your channel: “Works” means a published
          idea beat your usual views at 30 days.
        </p>
      </div>
      <TopicsView topics={r.topics} channelVideos={r.channelVideos} error={isMissingTable({ message: r.error }) ? null : (r.error ?? null)} />
    </div>
  );
}
