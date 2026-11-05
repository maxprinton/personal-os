// /youtube/v/[id]/idea — ideation stepper (Worker A).
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { getVideo, getYtSettings, ytServer } from "@/lib/youtube/db";
import { cleanWeights } from "@/lib/youtube/scoring";
import type { YtReference } from "@/lib/youtube/types";
import IdeaStepper from "@/components/youtube/idea/IdeaStepper";
import OutlierFinder from "@/components/youtube/finder/OutlierFinder";

export const dynamic = "force-dynamic";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ video, missing }, { settings }] = await Promise.all([getVideo(id), getYtSettings()]);
  if (missing) return null;
  if (!video) notFound();
  const { supabase } = await ytServer();
  const [refsRes, titlesRes, noteRes] = await Promise.all([
    supabase.from("yt_references").select("*").eq("video_id", video.id).order("position").order("created_at"),
    supabase.from("yt_variants").select("id", { count: "exact", head: true }).eq("video_id", video.id).eq("kind", "title").eq("archived", false),
    video.note_id ? supabase.from("notes").select("id,title").eq("id", video.note_id).is("deleted_at", null).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const refs = (refsRes.data ?? []) as YtReference[];
  const topic = video.topic || video.idea_name;
  return (
    <IdeaStepper
      data={{
        video,
        refs,
        weights: cleanWeights(settings?.score_weights),
        viewGoal: settings?.view_goal ?? null,
        titles: titlesRes.count ?? 0,
        note: (noteRes.data as { id: string; title: string } | null) ?? null,
        aiReady: hasAi(),
        finder: <OutlierFinder videoId={video.id} topic={topic} savedYtIds={refs.map((r) => r.yt_id).filter((x): x is string => !!x)} />,
      }}
    />
  );
}
