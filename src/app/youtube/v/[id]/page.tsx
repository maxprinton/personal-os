// /youtube/v/<id> (or /youtube/v/V012): opens the tab of the stage the video is in (Lead).
import { notFound, redirect } from "next/navigation";
import { getVideo } from "@/lib/youtube/db";
import { stageInfo, videoHref } from "@/lib/youtube/constants";

export default async function VideoIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { video } = await getVideo(id);
  if (!video) notFound();
  redirect(videoHref(video.id, stageInfo(video.stage).tab));
}
