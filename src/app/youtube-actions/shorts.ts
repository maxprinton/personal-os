"use server";
// YouTube add-on (Worker C) — Shorts: create a Short "child" of a long video (Teaser / Standalone / Test,
// optional time range of the long), change its role and range. A Short is a yt_videos row with kind 'short',
// parent_id = the long video. Clips cut from the long start in Edit; made-on-purpose Shorts start in Script
// (Hook · Body · Payoff/Loop, Worker B's outline with the Shorts template).
import { revalidatePath } from "next/cache";
import { MIGRATION_FILE, SHORT_ROLES, videoHref } from "@/lib/youtube/constants";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { shortName, shortRangeProblems, shortStartStage, type ShortRoleId } from "@/lib/youtube/publish-rules";
import type { ShortRole, YtVideo } from "@/lib/youtube/types";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
type PgErr = { code?: string; message?: string } | null | undefined;
const dbFail = (e: PgErr) => (isMissingTable(e) ? MISSING : e?.message || "Something went wrong. Try again.");
const isRole = (r: unknown): r is ShortRole => SHORT_ROLES.some((x) => x.id === r);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : NaN);

export type NewShort = { role: ShortRoleId; name?: string; hook?: string; start_s?: number | null; end_s?: number | null };

/** Creates a Short from a long video. Returns its id (the page then opens it). */
export async function createShort(parentId: string, s: NewShort): Promise<{ id?: string; code?: string | null; error?: string }> {
  const { supabase: sb, userId } = await ytServer();
  if (!userId) return { error: "Sign in again." };
  if (!isRole(s.role)) return { error: "Pick a role: Teaser, Standalone or Test." };
  const { data: p, error: e0 } = await sb.from("yt_videos").select("*").eq("id", parentId).maybeSingle();
  if (e0) return { error: dbFail(e0) };
  const parent = p as YtVideo | null;
  if (!parent) return { error: "Long video not found." };
  if (parent.kind !== "long") return { error: "Shorts are made from a long video." };
  const start = num(s.start_s);
  const end = num(s.end_s);
  if (Number.isNaN(start) || Number.isNaN(end)) return { error: "Times must be numbers of seconds (or m:ss)." };
  const uploaded = await sb.from("yt_publish").select("post_plan").eq("video_id", parentId).maybeSingle();
  const parentDur = ((uploaded.data?.post_plan as { uploaded?: { duration_s?: number | null } } | undefined)?.uploaded?.duration_s ?? null) as number | null;
  const problems = shortRangeProblems(start, end, parentDur);
  if (problems.length) return { error: problems.join(" ") };
  if (s.role === "teaser" && start == null) return { error: "A teaser is cut from the long video: give the start and end of the clip." };
  const { count } = await sb.from("yt_videos").select("id", { count: "exact", head: true }).eq("parent_id", parentId).eq("short_role", s.role);
  const name = (s.name ?? "").trim().slice(0, 200) || shortName(parent.idea_name, s.role, (count ?? 0) + 1);
  const hook = (s.hook ?? "").trim().slice(0, 300);
  const stage = shortStartStage({ hasRange: start != null });
  const { data, error } = await sb
    .from("yt_videos")
    .insert({
      idea_name: name,
      topic: parent.topic,
      kind: "short",
      parent_id: parentId,
      short_role: s.role,
      source_start_s: start,
      source_end_s: end,
      stage,
      step: "criteria",
      source: s.role === "test" ? "short_test" : "web",
      origin_video_id: parentId,
      formats: parent.formats ?? [],
      tags: parent.tags ?? [],
      quick_notes: hook ? `Hook: ${hook}` : null,
      approved_at: new Date().toISOString(),
    })
    .select("id,code")
    .single();
  if (error) return { error: dbFail(error) };
  revalidatePath(videoHref(parentId, "publish"));
  revalidatePath("/youtube");
  return { id: (data as { id: string }).id, code: (data as { code: string | null }).code };
}

/** Changes a Short's role and/or source range (seconds; null = not cut from the long). */
export async function updateShort(id: string, patch: { role?: ShortRoleId; start_s?: number | null; end_s?: number | null; hook?: string | null }): Promise<{ ok?: boolean; error?: string }> {
  const { supabase: sb, userId } = await ytServer();
  if (!userId) return { error: "Sign in again." };
  const { data: cur, error: e0 } = await sb.from("yt_videos").select("id,kind,parent_id,source_start_s,source_end_s,quick_notes").eq("id", id).maybeSingle();
  if (e0) return { error: dbFail(e0) };
  if (!cur || cur.kind !== "short") return { error: "Short not found." };
  const row: Record<string, unknown> = {};
  if (patch.role !== undefined) {
    if (!isRole(patch.role)) return { error: "Unknown role." };
    row.short_role = patch.role;
  }
  if ("start_s" in patch || "end_s" in patch) {
    const start = "start_s" in patch ? num(patch.start_s) : (cur.source_start_s as number | null);
    const end = "end_s" in patch ? num(patch.end_s) : (cur.source_end_s as number | null);
    if (Number.isNaN(start) || Number.isNaN(end)) return { error: "Times must be numbers of seconds (or m:ss)." };
    let parentDur: number | null = null;
    if (cur.parent_id) {
      const { data } = await sb.from("yt_publish").select("post_plan").eq("video_id", cur.parent_id).maybeSingle();
      parentDur = ((data?.post_plan as { uploaded?: { duration_s?: number | null } } | undefined)?.uploaded?.duration_s ?? null) as number | null;
    }
    const problems = shortRangeProblems(start, end, parentDur);
    if (problems.length) return { error: problems.join(" ") };
    row.source_start_s = start;
    row.source_end_s = end;
  }
  if (patch.hook !== undefined) {
    const rest = String(cur.quick_notes ?? "").replace(/^Hook:.*(\r?\n)?/, "").trim();
    const h = (patch.hook ?? "").trim().slice(0, 300);
    row.quick_notes = [h ? `Hook: ${h}` : "", rest].filter(Boolean).join("\n") || null;
  }
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await sb.from("yt_videos").update(row).eq("id", id);
  if (error) return { error: dbFail(error) };
  revalidatePath(videoHref(id, "publish"));
  if (cur.parent_id) revalidatePath(videoHref(cur.parent_id as string, "publish"));
  return { ok: true };
}
