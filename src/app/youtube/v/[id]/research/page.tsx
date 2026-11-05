// /youtube/v/[id]/research — Research Laboratory of one video (Worker A): notes drawer, buckets, cards,
// topic shelves to copy from, linked videos. The default buckets and the outlier reference cards are
// created on the first visit.
import { notFound } from "next/navigation";
import Link from "next/link";
import { hasAi } from "@/lib/ai";
import { getVideo } from "@/lib/youtube/db";
import { keywords } from "@/lib/youtube/research";
import { ensureResearch } from "@/app/youtube-actions/research";
import { loadLab } from "@/components/youtube/research/load";
import ResearchLab from "@/components/youtube/research/ResearchLab";
import VideoLinks from "@/components/youtube/research/VideoLinks";

export const dynamic = "force-dynamic";

export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { video, missing } = await getVideo(id);
  if (missing) return null;
  if (!video) notFound();
  await ensureResearch(video.id).catch(() => false);
  const lab = await loadLab({ videoId: video.id });
  const buckets = lab.buckets.filter((b) => b.video_id === video.id);
  const shelves = lab.buckets.filter((b) => b.video_id === null);
  const shelfIds = new Set(shelves.map((s) => s.id));
  const terms = keywords([video.idea_name, video.topic, video.base_idea, (video.tags ?? []).join(" ")].filter(Boolean).join(" "), 12);
  const cardCount = lab.cards.filter((c) => c.video_id === video.id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Research Laboratory</h2>
          <p className="text-xs text-muted">
            Collect notes, quotes, links and thoughts in buckets ({cardCount} card{cardCount === 1 ? "" : "s"}). Cards point to your notes — edit a note and it changes everywhere.
          </p>
        </div>
        <Link href="/youtube/lab" className="text-xs text-accent hover:underline">
          All research & topic shelves →
        </Link>
      </div>
      <ResearchLab
        videoId={video.id}
        terms={terms}
        notes={lab.notes}
        typeOptions={lab.typeOptions}
        areaOptions={lab.areaOptions}
        buckets={buckets}
        cards={lab.cards.filter((c) => c.video_id === video.id)}
        shelves={shelves}
        shelfCards={lab.cards.filter((c) => shelfIds.has(c.bucket_id))}
        references={lab.references}
        usedIn={lab.usedIn}
        aiReady={hasAi()}
      />
      <VideoLinks videoId={video.id} links={lab.links} videos={lab.videos} />
    </div>
  );
}
