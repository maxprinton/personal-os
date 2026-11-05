"use server";
// YouTube add-on (Worker B) — Edit tab: clips per shot, extra clips, ingest, edit passes, cuts with
// timestamped review notes, section start times (chapters), script cues (music/sfx/cut/zoom), music list.
// Where Publish reads from (for Worker C): final cut length = yt_cuts.duration_s of the cut whose label
// contains "final"; section starts = yt_sections.start_s (seconds from the start of the final cut).
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { CUE_KINDS, EDIT_PASSES, MIGRATION_FILE, videoHref } from "@/lib/youtube/constants";
import type { ClipLocation, ClipStatus, CueKind, EditPass, MusicSource, YtStage } from "@/lib/youtube/types";
import { cleanText } from "@/components/youtube/shots/logic";
import { isClipLocation, isClipStatus, passCheck } from "@/components/youtube/edit/logic";
import { safePart } from "@/lib/youtube/naming";

export type EditResult = { error?: string; ok?: boolean; id?: string; count?: number };

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const fail = (e: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again."): EditResult => ({
  error: isMissingTable(e) ? MISSING : e?.message || fallback,
});
const refresh = (videoId: string) => {
  revalidatePath(videoHref(videoId), "layout");
  revalidatePath("/youtube");
};
async function ctx() {
  const { supabase, userId } = await ytServer();
  return { sb: supabase, userId };
}
const num = (v: unknown, lo: number, hi: number): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const SEC_MAX = 6 * 3600;

/** Footage collected or a pass done → the video is in editing (from shots/filming). */
async function toEdit(sb: SupabaseClient, videoId: string) {
  const { data } = await sb.from("yt_videos").select("stage").eq("id", videoId).maybeSingle();
  const stage = (data as { stage: YtStage } | null)?.stage;
  if (stage && (["outline", "script", "shots", "filming"] as YtStage[]).includes(stage)) await sb.from("yt_videos").update({ stage: "edit" }).eq("id", videoId);
}
async function nextPos(sb: SupabaseClient, table: string, videoId: string): Promise<number> {
  const { data } = await sb.from(table).select("position").eq("video_id", videoId).order("position", { ascending: false }).limit(1);
  return (((data ?? [])[0] as { position?: number } | undefined)?.position ?? 0) + 1;
}

// ----- Footage folder ------------------------------------------------------------------------------------
export async function setFootageFolder(videoId: string, folder: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_videos").update({ footage_folder: cleanText(folder, 1000) }).eq("id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

// ----- Clips ---------------------------------------------------------------------------------------------
export type ClipInput = {
  shot_id?: string | null;
  file_name?: string;
  original_name?: string | null;
  location?: ClipLocation;
  url_or_path?: string | null;
  take?: number;
  is_best?: boolean;
  status?: ClipStatus;
  kind?: string | null;
  source?: string | null;
  license?: string | null;
  notes?: string | null;
};
function clipRow(i: ClipInput, partial: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (!partial || "shot_id" in i) row.shot_id = i.shot_id || null;
  if (!partial || "file_name" in i) row.file_name = cleanText(i.file_name, 300) ?? "";
  if ("original_name" in i) row.original_name = cleanText(i.original_name, 300);
  if (!partial || "location" in i) row.location = isClipLocation(i.location) ? i.location : "pc";
  if ("url_or_path" in i) row.url_or_path = cleanText(i.url_or_path, 2000);
  if (!partial || "take" in i) row.take = Math.round(num(i.take, 1, 999) ?? 1);
  if ("is_best" in i) row.is_best = !!i.is_best;
  if (!partial || "status" in i) row.status = isClipStatus(i.status) ? i.status : "recorded";
  if ("kind" in i) row.kind = cleanText(i.kind, 40);
  if ("source" in i) row.source = cleanText(i.source, 500);
  if ("license" in i) row.license = cleanText(i.license, 300);
  if ("notes" in i) row.notes = cleanText(i.notes, 2000);
  return row;
}

export async function addClip(videoId: string, input: ClipInput): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row = clipRow(input, false);
  if (!row.file_name && !input.url_or_path) return { error: "Give the clip a file name or a link." };
  if (!row.file_name) row.file_name = String(input.url_or_path).split(/[\\/]/).pop()?.slice(0, 300) || "clip";
  const { data, error } = await sb.from("yt_clips").insert({ ...row, video_id: videoId, position: await nextPos(sb, "yt_clips", videoId) }).select("id").single();
  if (error) return fail(error);
  if (row.is_best && row.shot_id) await sb.from("yt_clips").update({ is_best: false }).eq("shot_id", row.shot_id as string).neq("id", data.id);
  await toEdit(sb, videoId);
  refresh(videoId);
  return { ok: true, id: data.id as string };
}

export async function updateClip(videoId: string, clipId: string, input: ClipInput): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row = clipRow(input, true);
  if ("file_name" in row && !row.file_name) return { error: "The file name can't be empty." };
  const { data, error } = await sb.from("yt_clips").update(row).eq("id", clipId).eq("video_id", videoId).select("shot_id").single();
  if (error) return fail(error);
  // one best take per shot
  if (input.is_best && data?.shot_id) await sb.from("yt_clips").update({ is_best: false }).eq("shot_id", data.shot_id).neq("id", clipId);
  refresh(videoId);
  return { ok: true };
}

export async function deleteClip(videoId: string, clipId: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_clips").delete().eq("id", clipId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

/** Moves every clip of the video from one status to the next one (e.g. all "recorded" → "imported"). */
export async function bulkClipStatus(videoId: string, from: ClipStatus, to: ClipStatus, onlyPhone = false): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!isClipStatus(from) || !isClipStatus(to)) return { error: "Unknown status." };
  let q = sb.from("yt_clips").update(onlyPhone ? { status: to, location: "pc" } : { status: to }).eq("video_id", videoId).eq("status", from);
  if (onlyPhone) q = q.eq("location", "phone");
  const { error } = await q;
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

export type IngestInsert = { shot_id: string | null; original: string; file_name: string; take: number; kind: string | null };
/** Saves an ingest: one clip per renamed file (status "recorded"). Unmatched files can come as extras (shot_id null). */
export async function ingestClips(videoId: string, rows: IngestInsert[], location: ClipLocation, folder: string | null): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const list = (Array.isArray(rows) ? rows : []).slice(0, 500).filter((r) => r && (r.file_name || r.original));
  if (!list.length) return { error: "Nothing to save." };
  const loc: ClipLocation = isClipLocation(location) ? location : "pc";
  let pos = await nextPos(sb, "yt_clips", videoId);
  const ins = list.map((r) => ({
    video_id: videoId,
    shot_id: r.shot_id || null,
    file_name: (cleanText(r.file_name || r.original, 300) ?? "clip"),
    original_name: cleanText(r.original, 300),
    location: loc,
    url_or_path: cleanText(folder, 2000),
    take: Math.round(num(r.take, 1, 999) ?? 1),
    status: "recorded" as ClipStatus,
    kind: cleanText(r.kind, 40) ?? (r.shot_id ? null : "other"),
    position: pos++,
  }));
  const { error } = await sb.from("yt_clips").insert(ins);
  if (error) return fail(error);
  await toEdit(sb, videoId);
  refresh(videoId);
  return { ok: true, count: ins.length };
}

// ----- Edit passes ---------------------------------------------------------------------------------------
const isPass = (p: unknown): p is EditPass => EDIT_PASSES.some((x) => x.id === p);

export async function setPass(videoId: string, pass: EditPass, patch: { done?: boolean; link?: string | null; notes?: string | null }): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!isPass(pass)) return { error: "Unknown pass." };
  const { data: cur, error: e1 } = await sb.from("yt_edit_passes").select("id,link,done_at").eq("video_id", videoId).eq("pass", pass).maybeSingle();
  if (e1) return fail(e1);
  const row: Record<string, unknown> = {};
  if ("link" in patch) row.link = cleanText(patch.link, 2000);
  if ("notes" in patch) row.notes = cleanText(patch.notes, 4000);
  if ("done" in patch) {
    const link = ("link" in row ? row.link : cur?.link) as string | null;
    if (patch.done) {
      const why = passCheck(pass, link);
      if (why) return { error: why };
    }
    row.done_at = patch.done ? new Date().toISOString() : null;
  }
  const res = cur ? await sb.from("yt_edit_passes").update(row).eq("id", cur.id) : await sb.from("yt_edit_passes").insert({ video_id: videoId, pass, ...row });
  if (res.error) return fail(res.error);
  if (patch.done) await toEdit(sb, videoId);
  refresh(videoId);
  return { ok: true };
}

// ----- Cuts + review notes --------------------------------------------------------------------------------
export async function addCut(videoId: string, input: { label: string; url?: string | null; duration_s?: number | null; notes?: string | null }): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const label = cleanText(input.label, 60);
  if (!label) return { error: "Name the cut (rough, v2, final…)." };
  const { data, error } = await sb
    .from("yt_cuts")
    .insert({ video_id: videoId, label, url: cleanText(input.url, 2000), duration_s: num(input.duration_s, 0, SEC_MAX), notes: cleanText(input.notes, 2000) })
    .select("id")
    .single();
  if (error) return fail(error);
  // a rough cut link also fills the rough-cut pass link (so it can be ticked)
  if (/rough/i.test(label) && input.url) {
    const { data: p } = await sb.from("yt_edit_passes").select("id,link").eq("video_id", videoId).eq("pass", "rough_cut").maybeSingle();
    if (!p) await sb.from("yt_edit_passes").insert({ video_id: videoId, pass: "rough_cut", link: cleanText(input.url, 2000) });
    else if (!p.link) await sb.from("yt_edit_passes").update({ link: cleanText(input.url, 2000) }).eq("id", p.id);
  }
  await toEdit(sb, videoId);
  refresh(videoId);
  return { ok: true, id: data.id as string };
}

export async function updateCut(videoId: string, cutId: string, input: { label?: string; url?: string | null; duration_s?: number | null; notes?: string | null }): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if ("label" in input) {
    const l = cleanText(input.label, 60);
    if (!l) return { error: "The cut needs a name." };
    row.label = l;
  }
  if ("url" in input) row.url = cleanText(input.url, 2000);
  if ("duration_s" in input) row.duration_s = num(input.duration_s, 0, SEC_MAX);
  if ("notes" in input) row.notes = cleanText(input.notes, 2000);
  const { error } = await sb.from("yt_cuts").update(row).eq("id", cutId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

export async function deleteCut(videoId: string, cutId: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_cuts").delete().eq("id", cutId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

export async function addReviewNote(videoId: string, cutId: string, at_seconds: number, text: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const t = cleanText(text, 1000);
  if (!t) return { error: "Write the note." };
  const at = num(at_seconds, 0, SEC_MAX);
  if (at == null) return { error: "Give a time like 2:13." };
  const { error } = await sb.from("yt_review_notes").insert({ video_id: videoId, cut_id: cutId, at_seconds: Math.round(at), text: t });
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
export async function setReviewNoteResolved(videoId: string, noteId: string, resolved: boolean): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_review_notes").update({ resolved: !!resolved }).eq("id", noteId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
export async function deleteReviewNote(videoId: string, noteId: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_review_notes").delete().eq("id", noteId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

// ----- Section start times (chapters) -------------------------------------------------------------------
/** Saves yt_sections.start_s (seconds in the final cut; null = unknown → Publish estimates it). */
export async function setSectionStarts(videoId: string, starts: { id: string; start_s: number | null }[]): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  for (const s of (starts ?? []).slice(0, 200)) {
    const v = s.start_s == null ? null : num(s.start_s, 0, SEC_MAX);
    const { error } = await sb.from("yt_sections").update({ start_s: v == null ? null : Math.round(v) }).eq("id", s.id).eq("video_id", videoId);
    if (error) return fail(error);
  }
  refresh(videoId);
  return { ok: true };
}

// ----- Script cues (annotations on script lines; never part of the exported script) ----------------------
const isCue = (k: unknown): k is CueKind => CUE_KINDS.some((c) => c.id === k);
export async function addCue(
  videoId: string,
  input: { section_id: string; block_id: string; anchor_text?: string | null; kind: CueKind; text?: string | null; mood?: string | null; energy?: number | null; at_s?: number | null },
): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!isCue(input.kind)) return { error: "Unknown cue type." };
  const { error } = await sb.from("yt_cues").insert({
    video_id: videoId,
    section_id: input.section_id,
    block_id: cleanText(input.block_id, 80),
    anchor_text: cleanText(input.anchor_text, 200),
    kind: input.kind,
    text: cleanText(input.text, 300),
    mood: input.kind === "music" ? cleanText(input.mood, 40) : null,
    energy: input.kind === "music" && input.energy != null ? Math.round(num(input.energy, 1, 5) ?? 3) : null,
    at_s: num(input.at_s, 0, SEC_MAX),
    position: await nextPos(sb, "yt_cues", videoId),
  });
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
export async function updateCue(videoId: string, cueId: string, input: { text?: string | null; at_s?: number | null; energy?: number | null; mood?: string | null }): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if ("text" in input) row.text = cleanText(input.text, 300);
  if ("at_s" in input) row.at_s = num(input.at_s, 0, SEC_MAX);
  if ("energy" in input) row.energy = input.energy == null ? null : Math.round(num(input.energy, 1, 5) ?? 3);
  if ("mood" in input) row.mood = cleanText(input.mood, 40);
  const { error } = await sb.from("yt_cues").update(row).eq("id", cueId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
export async function deleteCue(videoId: string, cueId: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_cues").delete().eq("id", cueId).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}

// ----- Music list (yt_music; Music Lab tracks are saved by youtube-actions/music.ts) ---------------------
const isSource = (s: unknown): s is MusicSource => s === "music_lab" || s === "library" || s === "other";
export async function addMusicTrack(
  videoId: string,
  input: { track: string; source: MusicSource; license?: string | null; file_name?: string | null; section_id?: string | null; start_s?: number | null; end_s?: number | null },
): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const track = cleanText(input.track, 200);
  if (!track) return { error: "Name the track." };
  const { error } = await sb.from("yt_music").insert({
    video_id: videoId,
    track,
    source: isSource(input.source) ? input.source : "library",
    license: cleanText(input.license, 300),
    file_name: cleanText(input.file_name ? safeFile(input.file_name) : null, 200),
    section_id: input.section_id || null,
    start_s: num(input.start_s, 0, SEC_MAX),
    end_s: num(input.end_s, 0, SEC_MAX),
    position: await nextPos(sb, "yt_music", videoId),
  });
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
const safeFile = (s: string) => {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(s.trim());
  return (safePart(m?.[1] ?? s, 150) || "track") + (m?.[2] ?? "");
};
export async function updateMusicTrack(videoId: string, id: string, input: { track?: string; license?: string | null; section_id?: string | null }): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if ("track" in input) {
    const t = cleanText(input.track, 200);
    if (!t) return { error: "Name the track." };
    row.track = t;
  }
  if ("license" in input) row.license = cleanText(input.license, 300);
  if ("section_id" in input) row.section_id = input.section_id || null;
  const { error } = await sb.from("yt_music").update(row).eq("id", id).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
export async function deleteMusicTrack(videoId: string, id: string): Promise<EditResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_music").delete().eq("id", id).eq("video_id", videoId);
  if (error) return fail(error);
  refresh(videoId);
  return { ok: true };
}
