// Server only — everything the Publish step needs about one video, read with the user's client (RLS):
// publish row, primary pair (title + thumbnail), all pairs (Test & compare), sections (chapters, intro gate,
// captions), music credits, the watch-next video, the final cut length, Shorts parent/children, check-ins.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/agenda";
import { withSettingsDefaults, isMissingTable } from "@/lib/youtube/db";
import { orderSections } from "@/lib/youtube/outline";
import type { IntroStatus, YtCheckin, YtKind, YtMusic, YtPair, YtPublish, YtSection, YtSettings, YtVariant, YtVideo } from "@/lib/youtube/types";

export type PairView = { id: string; label: string; is_primary: boolean; title: string | null; thumb: string | null; thumbName: string | null };
export type LinkedVideo = { id: string; code: string | null; idea_name: string; youtube_video_id: string | null; stage: string; kind: YtKind; short_role: string | null; source_start_s: number | null; source_end_s: number | null; published_at: string | null };
export type SectionLite = Pick<YtSection, "id" | "kind" | "num" | "title" | "position" | "content" | "words" | "start_s" | "intro_status">;

export type PublishData = {
  video: YtVideo;
  settings: YtSettings;
  timezone: string;
  publish: YtPublish | null;
  pairs: PairView[];
  primary: PairView | null;
  sections: SectionLite[];
  introStatus: IntroStatus | null;
  music: Pick<YtMusic, "track" | "source" | "license" | "position">[];
  watchNext: LinkedVideo | null;
  cutSeconds: number | null;
  parent: LinkedVideo | null;
  children: LinkedVideo[];
  checkins: YtCheckin[];
  /** bank ideas with low confidence (for the Test vs Standalone suggestion) */
  doubtfulIdeas: number;
  missing: boolean;
};

const LINKED_COLS = "id,code,idea_name,youtube_video_id,stage,kind,short_role,source_start_s,source_end_s,published_at";

export async function loadPublishData(sb: SupabaseClient, userId: string, video: YtVideo): Promise<PublishData> {
  const vid = video.id;
  const [setRes, tz, pubRes, pairRes, varRes, secRes, musRes, linkRes, cutRes, kidsRes, parentRes, chkRes, bankRes] = await Promise.all([
    sb.from("yt_settings").select("*").eq("user_id", userId).maybeSingle(),
    getSettings(sb).catch(() => ({ timezone: "America/Guayaquil" })),
    sb.from("yt_publish").select("*").eq("video_id", vid).maybeSingle(),
    sb.from("yt_pairs").select("*").eq("video_id", vid).order("position"),
    sb.from("yt_variants").select("id,kind,value,image_url").eq("video_id", vid),
    sb.from("yt_sections").select("id,kind,num,title,position,content,words,start_s,intro_status").eq("video_id", vid),
    sb.from("yt_music").select("track,source,license,position").eq("video_id", vid).order("position"),
    sb.from("yt_video_links").select("to_id,position").eq("from_id", vid).eq("kind", "watch_next").order("position").limit(1),
    sb.from("yt_cuts").select("label,duration_s,created_at").eq("video_id", vid).order("created_at", { ascending: false }).limit(20),
    video.kind === "long" ? sb.from("yt_videos").select(LINKED_COLS).eq("parent_id", vid).neq("stage", "archived").order("created_at") : Promise.resolve({ data: [], error: null }),
    video.parent_id ? sb.from("yt_videos").select(LINKED_COLS).eq("id", video.parent_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb.from("yt_checkins").select("*").eq("video_id", vid).order("due_at"),
    sb.from("yt_videos").select("ratings,gates").in("stage", ["bank", "idea"]).limit(300),
  ]);
  const missing = isMissingTable(pubRes.error) || isMissingTable(pairRes.error);
  const vars = (varRes.data ?? []) as Pick<YtVariant, "id" | "kind" | "value" | "image_url">[];
  const byId = new Map(vars.map((v) => [v.id, v]));
  const pairs: PairView[] = ((pairRes.data ?? []) as YtPair[]).map((p) => {
    const t = p.title_id ? byId.get(p.title_id) : undefined;
    const th = p.thumbnail_id ? byId.get(p.thumbnail_id) : undefined;
    return { id: p.id, label: p.label, is_primary: p.is_primary, title: t?.value ?? null, thumb: th?.image_url ?? null, thumbName: th?.value ?? null };
  });
  const sections = orderSections((secRes.data ?? []) as SectionLite[]);
  const intro = sections.find((s) => s.kind === "intro");
  let watchNext: LinkedVideo | null = null;
  const toId = (linkRes.data?.[0] as { to_id?: string } | undefined)?.to_id;
  if (toId) {
    const { data } = await sb.from("yt_videos").select(LINKED_COLS).eq("id", toId).maybeSingle();
    watchNext = (data as LinkedVideo | null) ?? null;
  }
  const cuts = (cutRes.data ?? []) as { label: string; duration_s: number | null }[];
  const finalCut = cuts.find((c) => /final/i.test(c.label) && c.duration_s) ?? cuts.find((c) => c.duration_s);
  const doubtfulIdeas = ((bankRes.data ?? []) as Pick<YtVideo, "ratings" | "gates">[]).filter((v) => {
    const c = v.ratings?.confidence;
    return (typeof c === "number" && c <= 5) || v.gates?.packageability === false;
  }).length;
  return {
    video,
    settings: withSettingsDefaults(userId, setRes.data as Partial<YtSettings> | null),
    timezone: tz.timezone || "America/Guayaquil",
    publish: (pubRes.data as YtPublish | null) ?? null,
    pairs,
    primary: pairs.find((p) => p.is_primary) ?? pairs[0] ?? null,
    sections,
    introStatus: intro ? intro.intro_status : null,
    music: (musRes.data ?? []) as PublishData["music"],
    watchNext,
    cutSeconds: finalCut?.duration_s ?? null,
    parent: (parentRes.data as LinkedVideo | null) ?? null,
    children: (kidsRes.data ?? []) as LinkedVideo[],
    checkins: (chkRes.data ?? []) as YtCheckin[],
    doubtfulIdeas,
    missing,
  };
}
