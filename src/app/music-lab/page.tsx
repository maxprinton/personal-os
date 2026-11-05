// /music-lab — the Music Lab add-on: algorithmic background music (no AI). Two modes:
//  · free tracks (no video): any music you want, saved as recipes with video_id null;
//  · ?video=<id>: loaded with that YouTube video's energy curve; tracks go to the video's music list.
// Connected to the YouTube Pipeline add-on (sonic identity in /youtube/settings, the video's Music tab links here).
import Link from "next/link";
import { getYtSettings, listVideos, ytServer, isMissingTable } from "@/lib/youtube/db";
import type { SonicIdentity, YtMusic } from "@/lib/youtube/types";
import MigrationPanel from "@/components/youtube/shell/MigrationPanel";
import MusicLab from "@/components/youtube/music/MusicLab";
import VideoMusicLab from "@/components/youtube/music/VideoMusicLab";
import VideoPicker from "@/components/youtube/music/VideoPicker";

export const metadata = { title: "Music Lab · Personal OS" };
export const dynamic = "force-dynamic";

export default async function MusicLabPage({ searchParams }: { searchParams: Promise<{ video?: string }> }) {
  const sp = await searchParams;
  const videoId = sp.video?.trim() || null;
  const [{ settings, missing }, { videos }] = await Promise.all([getYtSettings(), listVideos()]);

  let free: YtMusic[] = [];
  let tableMissing = missing;
  if (!missing && !videoId) {
    const { supabase } = await ytServer();
    const { data, error } = await supabase.from("yt_music").select("*").is("video_id", null).eq("source", "music_lab").order("position");
    if (error && isMissingTable(error)) tableMissing = true;
    free = (data ?? []) as YtMusic[];
  }
  const current = videoId ? videos.find((v) => v.id === videoId || v.code === videoId) : null;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Music Lab</h1>
          <p className="text-sm text-muted">Your own background music, made by rules (no AI). Same seed = same track.</p>
        </div>
        <VideoPicker videos={videos.map((v) => ({ id: v.id, label: `${v.code ? `${v.code} · ` : ""}${v.idea_name}` }))} current={current?.id ?? null} />
      </div>

      {tableMissing ? (
        <MigrationPanel what="Music Lab" />
      ) : videoId ? (
        <>
          <p className="text-sm">
            For video{" "}
            <Link href={`/youtube/v/${encodeURIComponent(current?.id ?? videoId)}`} className="font-medium text-accent underline">
              {current ? `${current.code ? `${current.code} · ` : ""}${current.idea_name}` : videoId}
            </Link>{" "}
            · uses its outline, climax and 🎵 cues · <Link href="/music-lab" className="text-muted underline">switch to a free track</Link>
          </p>
          <VideoMusicLab id={current?.id ?? videoId} />
        </>
      ) : (
        <MusicLab
          video={null}
          sections={[]}
          cues={[]}
          finalLength={null}
          wpm={settings?.words_per_min ?? 150}
          sonic={(settings?.sonic_identity as SonicIdentity | null) ?? null}
          saved={free}
        />
      )}
    </main>
  );
}
