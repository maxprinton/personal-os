// /youtube/v/[id]/package — Package step (Worker A): curiosity gap, titles, thumbnail concepts, pairs,
// realistic preview, final tests and "package ready".
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { getVideo, getYtSettings, ytServer } from "@/lib/youtube/db";
import type { YtPair, YtReference, YtVariant } from "@/lib/youtube/types";
import PackageEditor, { type CrowdItem } from "@/components/youtube/package/PackageEditor";

export const dynamic = "force-dynamic";

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ video, missing }, { settings }] = await Promise.all([getVideo(id), getYtSettings()]);
  if (missing) return null;
  if (!video) notFound();
  const { supabase } = await ytServer();
  const [varsRes, pairsRes, refsRes] = await Promise.all([
    supabase.from("yt_variants").select("*").eq("video_id", video.id).eq("archived", false).order("position").order("created_at"),
    supabase.from("yt_pairs").select("*").eq("video_id", video.id).order("position"),
    supabase.from("yt_references").select("id,title,channel_title,views,thumbnail_url,published_at,is_short").eq("video_id", video.id).not("thumbnail_url", "is", null).order("position").limit(12),
  ]);
  const vars = (varsRes.data ?? []) as YtVariant[];
  let refs = (refsRes.data ?? []) as Pick<YtReference, "id" | "title" | "channel_title" | "views" | "thumbnail_url" | "published_at" | "is_short">[];
  if (refs.length < 4) {
    // Too few references of this idea: fill the crowd with your other saved references.
    const { data } = await supabase
      .from("yt_references")
      .select("id,title,channel_title,views,thumbnail_url,published_at,is_short")
      .neq("video_id", video.id)
      .not("thumbnail_url", "is", null)
      .eq("is_short", false)
      .order("created_at", { ascending: false })
      .limit(8 - refs.length);
    refs = [...refs, ...((data ?? []) as typeof refs)];
  }
  const crowd: CrowdItem[] = refs
    .filter((r) => !r.is_short && r.thumbnail_url)
    .map((r) => ({ id: r.id, title: r.title, channel: r.channel_title ?? "", views: r.views, image: r.thumbnail_url as string, published_at: r.published_at }));
  return (
    <PackageEditor
      video={video}
      titles={vars.filter((v) => v.kind === "title")}
      thumbs={vars.filter((v) => v.kind === "thumbnail")}
      pairs={(pairsRes.data ?? []) as YtPair[]}
      crowd={crowd}
      channel={settings?.channel_title || settings?.channel_handle || "Your channel"}
      aiReady={hasAi()}
    />
  );
}
