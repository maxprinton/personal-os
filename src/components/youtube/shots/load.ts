// Server loader shared by the Shots tab, Filming mode and Teleprompter (Worker B). Server only.
import { getVideo, getYtSettings, ytServer } from "@/lib/youtube/db";
import { DEFAULT_WORDS_PER_MIN, sectionCode } from "@/lib/youtube/constants";
import { displayCode, orderSections, paragraphs, reconcileShots } from "@/lib/youtube/outline";
import type { YtMoment, YtPair, YtSection, YtShot, YtVariant, YtVideo } from "@/lib/youtube/types";
import type { PinnedPair } from "@/components/youtube/script/ScriptWorkspace";
import { sortShots } from "./logic";

/** What the shot screens need of a section (paragraphs = spoken lines, Source blocks removed). */
export type ShotSection = {
  id: string;
  kind: YtSection["kind"];
  num: number | null;
  /** "S03" when the outline is locked, else the provisional code */
  code: string;
  title: string;
  is_climax: boolean;
  paragraphs: { idx: number; hash: string; blockId: string | null; text: string }[];
};

export type ShotData = {
  video: YtVideo;
  sections: ShotSection[];
  rawSections: YtSection[];
  shots: YtShot[];
  moments: YtMoment[];
  wpm: number;
  /** true when the shot list is out of date with the script (new lines, changed lines, restored lines) */
  drift: boolean;
};

export async function loadShotData(id: string): Promise<{ data: ShotData | null; missing: boolean }> {
  const [{ video, missing }, { settings }] = await Promise.all([getVideo(id), getYtSettings()]);
  if (missing || !video) return { data: null, missing };
  const { supabase } = await ytServer();
  const [secRes, shotRes, momRes] = await Promise.all([
    supabase.from("yt_sections").select("*").eq("video_id", video.id),
    supabase.from("yt_shots").select("*").eq("video_id", video.id).order("position"),
    supabase.from("yt_moments").select("*").eq("video_id", video.id).order("at"),
  ]);
  const rawSections = orderSections((secRes.data ?? []) as YtSection[]);
  const sections: ShotSection[] = rawSections.map((s, i) => ({
    id: s.id,
    kind: s.kind,
    num: s.num,
    code: s.num != null ? sectionCode(s.num) : displayCode(s, i),
    title: s.title,
    is_climax: s.is_climax,
    paragraphs: paragraphs(s.content ?? "").map((p) => ({ idx: p.idx, hash: p.hash, blockId: p.blockId, text: p.text })),
  }));
  const shotsRaw = (shotRes.data ?? []) as YtShot[];
  const shots = sortShots(shotsRaw, sections);
  const rec = reconcileShots(
    sections.map((s) => ({ sectionId: s.id, paragraphs: s.paragraphs })),
    shotsRaw.map((s) => ({ id: s.id, section_id: s.section_id, para_hash: s.para_hash, block_id: s.block_id, position: s.position })),
  );
  const flagged = new Set(shotsRaw.filter((s) => s.script_changed).map((s) => s.id));
  const drift =
    rec.create.length > 0 ||
    rec.edited.some((e) => !flagged.has(e.shotId)) ||
    rec.removed.some((x) => !flagged.has(x)) ||
    rec.ok.some((x) => flagged.has(x));
  return {
    data: { video, sections, rawSections, shots, moments: (momRes.data ?? []) as YtMoment[], wpm: settings?.words_per_min || DEFAULT_WORDS_PER_MIN, drift },
    missing: false,
  };
}

/** The package's pinned pair (primary pair → first pair → first title / thumbnail), for the intro assistant. */
export async function loadPinnedPair(videoId: string): Promise<PinnedPair> {
  const { supabase } = await ytServer();
  const [pairRes, varRes] = await Promise.all([
    supabase.from("yt_pairs").select("*").eq("video_id", videoId).order("position"),
    supabase.from("yt_variants").select("id,kind,value,image_url,thumb_text,focal,archived,position").eq("video_id", videoId),
  ]);
  type V = Pick<YtVariant, "id" | "kind" | "value" | "image_url" | "thumb_text" | "focal" | "archived" | "position">;
  const variants = ((varRes.data ?? []) as V[]).sort((a, b) => a.position - b.position);
  const pairs = (pairRes.data ?? []) as YtPair[];
  const pair = pairs.find((p) => p.is_primary) ?? pairs[0] ?? null;
  const byId = (vId: string | null) => (vId ? variants.find((v) => v.id === vId) ?? null : null);
  const t = byId(pair?.title_id ?? null) ?? variants.find((v) => v.kind === "title" && !v.archived) ?? null;
  const th = byId(pair?.thumbnail_id ?? null) ?? variants.find((v) => v.kind === "thumbnail" && !v.archived) ?? null;
  return {
    label: pair?.label ?? null,
    primary: !!pair?.is_primary,
    title: t?.value ?? null,
    thumbnail: th ? { concept: th.value, image: th.image_url, text: th.thumb_text, focal: th.focal } : null,
  };
}
