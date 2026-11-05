// /youtube/v/[id]/music — the video's Music tab. Music Lab is its own add-on (/music-lab); this tab opens it
// already loaded with this video's energy curve, and its tracks stay in the video's music list (Edit → Music).
import Link from "next/link";
import VideoMusicLab from "@/components/youtube/music/VideoMusicLab";

export const dynamic = "force-dynamic";

export default async function MusicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Music Lab is its own add-on.{" "}
        <Link href={`/music-lab?video=${encodeURIComponent(id)}`} className="text-accent underline">
          Open this video in Music Lab ↗
        </Link>
      </p>
      <VideoMusicLab id={id} />
    </div>
  );
}
