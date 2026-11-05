// Server loader of the Edit tab and the Music Lab (Worker B). Server only.
import { loadShotData, type ShotSection } from "@/components/youtube/shots/load";
import { ytServer, getYtSettings } from "@/lib/youtube/db";
import type { SonicIdentity, YtClip, YtCue, YtCut, YtEditPass, YtMusic, YtReviewNote, YtSection, YtShot, YtVideo } from "@/lib/youtube/types";

export type EditData = {
  video: YtVideo;
  sections: ShotSection[];
  rawSections: YtSection[];
  shots: YtShot[];
  clips: YtClip[];
  passes: YtEditPass[];
  cuts: YtCut[];
  notes: YtReviewNote[];
  cues: YtCue[];
  music: YtMusic[];
  wpm: number;
  sonic: SonicIdentity | null;
};

export async function loadEditData(id: string): Promise<{ data: EditData | null; missing: boolean }> {
  const [{ data: base, missing }, { settings }] = await Promise.all([loadShotData(id), getYtSettings()]);
  if (missing || !base) return { data: null, missing };
  const { supabase } = await ytServer();
  const vid = base.video.id;
  const [clips, passes, cuts, notes, cues, music] = await Promise.all([
    supabase.from("yt_clips").select("*").eq("video_id", vid).order("position"),
    supabase.from("yt_edit_passes").select("*").eq("video_id", vid),
    supabase.from("yt_cuts").select("*").eq("video_id", vid).order("created_at"),
    supabase.from("yt_review_notes").select("*").eq("video_id", vid).order("at_seconds"),
    supabase.from("yt_cues").select("*").eq("video_id", vid).order("position"),
    supabase.from("yt_music").select("*").eq("video_id", vid).order("position"),
  ]);
  return {
    data: {
      video: base.video,
      sections: base.sections,
      rawSections: base.rawSections,
      shots: base.shots,
      clips: (clips.data ?? []) as YtClip[],
      passes: (passes.data ?? []) as YtEditPass[],
      cuts: (cuts.data ?? []) as YtCut[],
      notes: (notes.data ?? []) as YtReviewNote[],
      cues: (cues.data ?? []) as YtCue[],
      music: (music.data ?? []) as YtMusic[],
      wpm: base.wpm,
      sonic: (settings?.sonic_identity as SonicIdentity | null) ?? null,
    },
    missing: false,
  };
}
