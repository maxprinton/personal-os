"use server";
// YouTube add-on (Worker B) — Music Lab: saves a generated track's recipe (all inputs + seed) in yt_music
// (source "music_lab"), so it can be regenerated exactly, and lists it in the video's music (Edit → Music).
import { revalidatePath } from "next/cache";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { MIGRATION_FILE, videoHref } from "@/lib/youtube/constants";

/** The Music Lab add-on's own page; tracks without a video live there. */
const LAB_HREF = "/music-lab";
function refresh(videoId: string | null) {
  revalidatePath(LAB_HREF);
  if (videoId) revalidatePath(videoHref(videoId), "layout");
}
import { normalizeRecipe } from "@/lib/youtube/music";
import { cleanText } from "@/components/youtube/shots/logic";

export type MusicResult = { error?: string; ok?: boolean; id?: string };
const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const LICENSE = "Own music — generated in Music Lab (no third-party license)";

export async function saveLabTrack(
  videoId: string | null,
  input: { id?: string | null; track: string; recipe: unknown; file_name: string; section_id: string | null; start_s: number | null; end_s: number | null },
): Promise<MusicResult> {
  const { supabase: sb, userId } = await ytServer();
  if (!userId) return { error: "Sign in again." };
  const recipe = normalizeRecipe(input.recipe);
  const track = cleanText(input.track, 200) ?? "Music Lab track";
  const t = (v: number | null) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 10) / 10));
  const row = {
    track,
    source: "music_lab" as const,
    license: LICENSE,
    file_name: cleanText(input.file_name, 200),
    section_id: input.section_id || null,
    recipe: recipe as unknown as Record<string, unknown>,
    start_s: t(input.start_s),
    end_s: t(input.end_s),
  };
  if (input.id) {
    let uq = sb.from("yt_music").update(row).eq("id", input.id);
    uq = videoId ? uq.eq("video_id", videoId) : uq.is("video_id", null);
    const { error } = await uq;
    if (error) return { error: isMissingTable(error) ? MISSING : error.message };
    refresh(videoId);
    return { ok: true, id: input.id };
  }
  let lq = sb.from("yt_music").select("position");
  lq = videoId ? lq.eq("video_id", videoId) : lq.is("video_id", null);
  const { data: last } = await lq.order("position", { ascending: false }).limit(1);
  const position = (((last ?? [])[0] as { position?: number } | undefined)?.position ?? 0) + 1;
  const { data, error } = await sb.from("yt_music").insert({ ...row, video_id: videoId, position }).select("id").single();
  if (error) return { error: isMissingTable(error) ? MISSING : error.message };
  refresh(videoId);
  return { ok: true, id: data.id as string };
}

export async function deleteLabTrack(videoId: string | null, id: string): Promise<MusicResult> {
  const { supabase: sb, userId } = await ytServer();
  if (!userId) return { error: "Sign in again." };
  let dq = sb.from("yt_music").delete().eq("id", id).eq("source", "music_lab");
  dq = videoId ? dq.eq("video_id", videoId) : dq.is("video_id", null);
  const { error } = await dq;
  if (error) return { error: isMissingTable(error) ? MISSING : error.message };
  refresh(videoId);
  return { ok: true };
}
