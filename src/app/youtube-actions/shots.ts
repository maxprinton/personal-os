"use server";
// YouTube add-on (Worker B) — shot list, filming mode, missing-shots backlog, moments.
// Rules (spec §4): every script paragraph = one shot (A-roll by default); ✨ suggests B-roll / screen /
// graphics per line (accept/discard); when the script changes, shots of changed lines are flagged
// "script changed" (never deleted automatically). Shots added once filming started are pickups.
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionState } from "@/app/actions";
import { aiChat, hasAi } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { AI_PROMPT_MAX, MIGRATION_FILE, MOMENT_KINDS, sectionCode, videoHref } from "@/lib/youtube/constants";
import { orderSections, paragraphs, reconcileShots } from "@/lib/youtube/outline";
import type { MomentKind, ShotKind, YtSection, YtShot, YtStage } from "@/lib/youtube/types";
import { AI_KINDS, PICKUP_STAGES, aiLinesText, cleanSeconds, cleanText, isShotKind, nextShotNum, parseAiShots, type AiLine, type ShotSuggestion } from "@/components/youtube/shots/logic";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const fail = (e: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again.") =>
  isMissingTable(e) ? MISSING : e?.message || fallback;

function refresh(videoId: string) {
  revalidatePath(videoHref(videoId), "layout");
  revalidatePath("/youtube/shots");
  revalidatePath("/youtube");
}

async function ctx() {
  const { supabase, userId } = await ytServer();
  return { sb: supabase, userId };
}

type VideoRow = { id: string; stage: YtStage; idea_name: string; code: string | null; kind: string };
async function videoOf(sb: SupabaseClient, videoId: string): Promise<VideoRow | null> {
  const { data } = await sb.from("yt_videos").select("id,stage,idea_name,code,kind").eq("id", videoId).maybeSingle();
  return (data as VideoRow | null) ?? null;
}
async function sectionsOf(sb: SupabaseClient, videoId: string): Promise<YtSection[]> {
  const { data } = await sb.from("yt_sections").select("*").eq("video_id", videoId);
  return orderSections((data ?? []) as YtSection[]);
}
async function shotsOf(sb: SupabaseClient, videoId: string): Promise<YtShot[]> {
  const { data } = await sb.from("yt_shots").select("*").eq("video_id", videoId).order("position");
  return (data ?? []) as YtShot[];
}
async function advanceStage(sb: SupabaseClient, v: VideoRow, to: YtStage, from: YtStage[]) {
  if (from.includes(v.stage)) await sb.from("yt_videos").update({ stage: to }).eq("id", v.id);
}
const isPickupTime = (v: VideoRow, shots: Pick<YtShot, "done">[]) => (PICKUP_STAGES as readonly string[]).includes(v.stage) || shots.some((s) => s.done);

// ----- Sync with the script --------------------------------------------------------------------------------
export type SyncResult = { created?: number; flagged?: number; cleared?: number; error?: string };

/**
 * Brings the shot list in line with the script: a new A-roll shot for every paragraph without a shot,
 * "script changed" on shots whose line was edited or removed, flag cleared when the line is back as it was.
 */
export async function syncShots(videoId: string): Promise<SyncResult> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const [secs, shots] = await Promise.all([sectionsOf(sb, videoId), shotsOf(sb, videoId)]);
  const rec = reconcileShots(
    secs.map((s) => ({ sectionId: s.id, paragraphs: paragraphs(s.content ?? "") })),
    shots.map((s) => ({ id: s.id, section_id: s.section_id, para_hash: s.para_hash, block_id: s.block_id, position: s.position })),
  );
  const pickup = isPickupTime(v, shots);
  const nums = shots.map((s) => ({ section_id: s.section_id, num: s.num }));
  const rows = rec.create.map((c) => {
    const num = nextShotNum(nums, c.sectionId);
    nums.push({ section_id: c.sectionId, num });
    return {
      video_id: videoId,
      section_id: c.sectionId,
      block_id: c.paragraph.blockId,
      para_hash: c.paragraph.hash,
      line_text: c.paragraph.text.slice(0, 2000),
      num,
      kind: "AR" as ShotKind,
      position: (c.paragraph.idx + 1) * 100,
      is_pickup: pickup,
    };
  });
  if (rows.length) {
    const { error } = await sb.from("yt_shots").insert(rows);
    if (error) return { error: fail(error) };
  }
  const byId = new Map(shots.map((s) => [s.id, s]));
  const toFlag = [...rec.edited.map((e) => e.shotId), ...rec.removed].filter((id) => byId.get(id) && !byId.get(id)!.script_changed);
  const toClear = rec.ok.filter((id) => byId.get(id)?.script_changed);
  if (toFlag.length) {
    const { error } = await sb.from("yt_shots").update({ script_changed: true }).in("id", toFlag);
    if (error) return { error: fail(error) };
  }
  if (toClear.length) {
    const { error } = await sb.from("yt_shots").update({ script_changed: false }).in("id", toClear);
    if (error) return { error: fail(error) };
  }
  if (rows.length) await advanceStage(sb, v, "shots", ["outline", "script"]);
  if (rows.length || toFlag.length || toClear.length) refresh(videoId);
  return { created: rows.length, flagged: toFlag.length, cleared: toClear.length };
}

/** "Still fine": the shot now covers the line's new text (or, when the line is gone, it stays as a free shot). */
export async function keepShot(id: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: s } = await sb.from("yt_shots").select("*").eq("id", id).maybeSingle();
  if (!s) return { error: "Shot not found." };
  const shot = s as YtShot;
  const [secs, shots] = await Promise.all([sectionsOf(sb, shot.video_id), shotsOf(sb, shot.video_id)]);
  const rec = reconcileShots(
    secs.map((x) => ({ sectionId: x.id, paragraphs: paragraphs(x.content ?? "") })),
    shots.map((x) => ({ id: x.id, section_id: x.section_id, para_hash: x.para_hash, block_id: x.block_id, position: x.position })),
  );
  const edited = rec.edited.find((e) => e.shotId === id);
  const row: Record<string, unknown> = { script_changed: false };
  if (edited) {
    row.para_hash = edited.paragraph.hash;
    row.block_id = edited.paragraph.blockId;
    row.line_text = edited.paragraph.text.slice(0, 2000);
  } else if (rec.removed.includes(id)) {
    row.para_hash = null; // free shot: no longer tied to a line
  }
  const { error } = await sb.from("yt_shots").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  refresh(shot.video_id);
  return { ok: true, at: Date.now() };
}

// ----- Edit shots ---------------------------------------------------------------------------------------------
export type ShotPatch = Partial<
  Pick<YtShot, "kind" | "description" | "framing" | "angle" | "movement" | "location" | "setup" | "props" | "lighting" | "outfit" | "duration_s" | "audio" | "edit_notes" | "is_pickup" | "matches_thumbnail">
>;
const TEXT_FIELDS = ["description", "framing", "angle", "movement", "location", "setup", "props", "lighting", "outfit", "audio", "edit_notes"] as const;

export async function updateShot(id: string, patch: ShotPatch): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) {
    if (!isShotKind(patch.kind)) return { error: "Unknown shot type." };
    row.kind = patch.kind;
  }
  for (const f of TEXT_FIELDS) if (patch[f] !== undefined) row[f] = cleanText(patch[f], f === "edit_notes" || f === "description" ? 2000 : 300);
  if (patch.duration_s !== undefined) row.duration_s = cleanSeconds(patch.duration_s);
  if (patch.is_pickup !== undefined) row.is_pickup = !!patch.is_pickup;
  if (patch.matches_thumbnail !== undefined) row.matches_thumbnail = !!patch.matches_thumbnail;
  if (!Object.keys(row).length) return { ok: true };
  const { data, error } = await sb.from("yt_shots").update(row).eq("id", id).select("video_id").maybeSingle();
  if (error) return { error: fail(error) };
  if (!data) return { error: "Shot not found." };
  refresh(data.video_id as string);
  return { ok: true, at: Date.now() };
}

/** Same setup fields on several shots at once (filming mode / shot list "Set setup"). */
export async function setShotsSetup(ids: string[], patch: Pick<ShotPatch, "setup" | "location">): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const list = [...new Set(ids)].slice(0, 500);
  if (!list.length) return { ok: true };
  const row: Record<string, unknown> = {};
  if (patch.setup !== undefined) row.setup = cleanText(patch.setup, 300);
  if (patch.location !== undefined) row.location = cleanText(patch.location, 300);
  const { data, error } = await sb.from("yt_shots").update(row).in("id", list).select("video_id");
  if (error) return { error: fail(error) };
  for (const vid of new Set(((data ?? []) as { video_id: string }[]).map((d) => d.video_id))) refresh(vid);
  return { ok: true, at: Date.now() };
}

/** ✓ Filmed (or not). The first filmed shot moves the video to "Filming". */
export async function setShotDone(id: string, done: boolean): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data, error } = await sb
    .from("yt_shots")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .select("video_id")
    .maybeSingle();
  if (error) return { error: fail(error) };
  if (!data) return { error: "Shot not found." };
  const vid = data.video_id as string;
  if (done) {
    const v = await videoOf(sb, vid);
    if (v) await advanceStage(sb, v, "filming", ["script", "shots"]);
  }
  refresh(vid);
  return { ok: true, at: Date.now() };
}

/** A new shot by hand: under another shot (same line) or at the end of a section (or with no section). */
export async function addShot(videoId: string, opts: { sectionId?: string | null; afterId?: string | null; kind?: ShotKind; description?: string | null }): Promise<{ id?: string; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const shots = await shotsOf(sb, videoId);
  const after = opts.afterId ? shots.find((s) => s.id === opts.afterId) ?? null : null;
  const sectionId = after ? after.section_id : opts.sectionId ?? null;
  const kind = isShotKind(opts.kind) ? opts.kind : after ? "BR" : "AR";
  const position = after ? after.position + 1 : shots.filter((s) => s.section_id === sectionId).reduce((m, s) => Math.max(m, s.position), 0) + 100;
  const { data, error } = await sb
    .from("yt_shots")
    .insert({
      video_id: videoId,
      section_id: sectionId,
      block_id: after?.block_id ?? null,
      para_hash: after?.para_hash ?? null,
      line_text: after?.line_text ?? null,
      num: nextShotNum(shots, sectionId),
      kind,
      description: cleanText(opts.description, 2000),
      setup: after?.setup ?? null,
      location: after?.location ?? null,
      position,
      is_pickup: isPickupTime(v, shots),
    })
    .select("id")
    .single();
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { id: data.id as string };
}

/** Deletes a shot. The only shot of a line that is still in the script can't go (it would come back): change its type. */
export async function deleteShot(id: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: s } = await sb.from("yt_shots").select("*").eq("id", id).maybeSingle();
  if (!s) return { error: "Shot not found." };
  const shot = s as YtShot;
  if (shot.para_hash && shot.section_id && !shot.script_changed) {
    const { data: same } = await sb.from("yt_shots").select("id").eq("video_id", shot.video_id).eq("section_id", shot.section_id).eq("para_hash", shot.para_hash);
    const { data: sec } = await sb.from("yt_sections").select("content").eq("id", shot.section_id).maybeSingle();
    const lineAlive = !!sec && paragraphs(String(sec.content ?? "")).some((p) => p.hash === shot.para_hash);
    if (lineAlive && (same ?? []).length <= 1) return { error: "This is the only shot of its line, so it would come back. Change its type instead, or remove the line from the script." };
  }
  const { error } = await sb.from("yt_shots").delete().eq("id", id);
  if (error) return { error: fail(error) };
  refresh(shot.video_id);
  return { ok: true, at: Date.now() };
}

// ----- ✨ AI suggestions --------------------------------------------------------------------------------------
/** ✨ Suggests B-roll, screen recordings, graphics (and vertical shots for Shorts) per line. Nothing is saved: accept/discard. */
export async function aiSuggestShots(videoId: string, sectionId: string | null): Promise<{ suggestions?: ShotSuggestion[]; error?: string; usage?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const [secs, shots] = await Promise.all([sectionsOf(sb, videoId), shotsOf(sb, videoId)]);
  const lines: AiLine[] = [];
  for (const s of secs) {
    if (sectionId && s.id !== sectionId) continue;
    for (const p of paragraphs(s.content ?? "")) lines.push({ key: `p${lines.length + 1}`, section_id: s.id, para_hash: p.hash, block_id: p.blockId, text: p.text, code: sectionCode(s.num) });
  }
  if (!lines.length) return { error: "There is no script text yet. Write the script first." };
  const have = shots
    .filter((s) => s.kind !== "AR" && s.para_hash && lines.some((l) => l.para_hash === s.para_hash))
    .map((s) => `- ${lines.find((l) => l.para_hash === s.para_hash)!.key}: ${s.kind} ${s.description ?? ""}`)
    .join("\n")
    .slice(0, 2000);
  const isShort = v.kind === "short";
  const prompt = [
    `Video: ${v.idea_name}${isShort ? " (YouTube Short, vertical 9:16)" : ""}`,
    "Script lines (each line already has a talking-head A-roll shot):",
    aiLinesText(lines, AI_PROMPT_MAX - 3500),
    have ? `Shots already planned (don't repeat):\n${have}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const kinds = isShort ? AI_KINDS : AI_KINDS.filter((k) => k !== "VT");
  const system =
    `You plan shots for a YouTube video. For the lines that need visuals, suggest extra shots: BR = B-roll / filmed scene, SC = screen recording, GR = graphics & text on screen (diagram, zoom, meme, text), ST = stock footage${isShort ? ", VT = vertical phone shot" : ""}. ` +
    "Show, don't tell: the video should work without sound. Concrete and easy to film at home. 0–2 per line, skip lines that are fine as talking head. English. " +
    `Answer ONLY JSON: {"shots":[{"p":"p3","kind":one of ${JSON.stringify(kinds)},"description":"what to film or show (max 20 words)","duration_s":number}]}`;
  let usage: string | null = null;
  const out = await withAiUsage(
    "youtube-shots",
    async () => {
      const o = await aiChat(system, [{ text: prompt }], { kind: "write", json: true, temperature: 0.6, maxTokens: 2000, timeoutMs: 40000 });
      const { timezone } = await getSettings(sb);
      usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb, userId },
  );
  if (!("text" in out)) return { error: out.error, usage };
  let json: unknown;
  try {
    json = JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1));
  } catch {
    return { error: "The AI answered in a strange way. Try again.", usage };
  }
  const suggestions = parseAiShots(json, lines, shots).filter((s) => kinds.includes(s.kind));
  if (!suggestions.length) return { error: "The AI had no new shot ideas for these lines.", usage };
  return { suggestions, usage };
}

/** Saves the accepted ✨ suggestions as shots (right under the shots of their line). */
export async function acceptShotSuggestions(videoId: string, items: ShotSuggestion[]): Promise<{ added?: number; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const [secs, shots] = await Promise.all([sectionsOf(sb, videoId), shotsOf(sb, videoId)]);
  const secIds = new Set(secs.map((s) => s.id));
  const pickup = isPickupTime(v, shots);
  const nums = shots.map((s) => ({ section_id: s.section_id, num: s.num }));
  const posTaken = shots.map((s) => ({ section_id: s.section_id, para_hash: s.para_hash, position: s.position }));
  const rows = [];
  for (const it of (items ?? []).slice(0, 60)) {
    if (!it || !secIds.has(it.section_id) || !isShotKind(it.kind)) continue;
    const num = nextShotNum(nums, it.section_id);
    nums.push({ section_id: it.section_id, num });
    const same = posTaken.filter((p) => p.section_id === it.section_id && p.para_hash === it.para_hash);
    const position = same.length ? Math.max(...same.map((p) => p.position)) + 1 : posTaken.filter((p) => p.section_id === it.section_id).reduce((m, p) => Math.max(m, p.position), 0) + 100;
    posTaken.push({ section_id: it.section_id, para_hash: it.para_hash, position });
    rows.push({
      video_id: videoId,
      section_id: it.section_id,
      block_id: it.block_id ?? null,
      para_hash: String(it.para_hash ?? "").slice(0, 40) || null,
      line_text: cleanText(it.line_text, 2000),
      num,
      kind: it.kind,
      description: cleanText(it.description, 2000),
      duration_s: cleanSeconds(it.duration_s),
      position,
      ai_suggested: true,
      is_pickup: pickup,
    });
  }
  if (!rows.length) return { added: 0 };
  const { error } = await sb.from("yt_shots").insert(rows);
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { added: rows.length };
}

// ----- Moments (filming mode) --------------------------------------------------------------------------------
/** Logs a moment while filming (funny, fail, reveal, effort…) — it feeds the intro (input bias, open loop). */
export async function addMoment(videoId: string, text: string, kind: MomentKind, shotId: string | null): Promise<{ id?: string; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const t = cleanText(text, 1000);
  if (!t) return { error: "Write what happened first." };
  const k: MomentKind = MOMENT_KINDS.some((m) => m.id === kind) ? kind : "other";
  const { data, error } = await sb
    .from("yt_moments")
    .insert({ video_id: videoId, shot_id: shotId || null, text: t, kind: k, at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { id: data.id as string };
}

export async function deleteMoment(id: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data, error } = await sb.from("yt_moments").delete().eq("id", id).select("video_id").maybeSingle();
  if (error) return { error: fail(error) };
  if (data) refresh(data.video_id as string);
  return { ok: true, at: Date.now() };
}
