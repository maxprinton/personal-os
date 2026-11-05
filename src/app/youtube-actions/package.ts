"use server";
// YouTube add-on (Worker A) — Package step: curiosity gap, title candidates, thumbnail concepts,
// title + thumbnail pairs (A/B/C + primary), final tests and the "package ready" flag. ✨ titles.
// Every write goes through RLS ("own rows"). Variants are archived, never deleted.
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, hasAi } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { ytServer, isMissingTable } from "@/lib/youtube/db";
import {
  AI_PROMPT_MAX, ANGLES, COMPOSITIONS, CONTRAST_KINDS, GAP_TYPES, MAX_THUMBNAILS, MAX_TITLES, MIGRATION_FILE, SCROLL_STOPPERS, THUMB_TESTS, TITLE_FIRST_WORDS, TITLE_SOFT_LIMIT, videoHref,
} from "@/lib/youtube/constants";
import { isImageUrl, nextPairLabel, packageMissing, suggestPairs } from "@/lib/youtube/package";
import type { ThumbTests, VariantKind, YtPair, YtVariant } from "@/lib/youtube/types";

type Res = { ok?: boolean; error?: string };
const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const fail = (e: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again.") =>
  isMissingTable(e) ? MISSING : e?.message || fallback;

function refresh(id: string) {
  revalidatePath("/youtube", "layout");
  revalidatePath(videoHref(id), "layout");
}
async function ctx() {
  const { supabase, userId } = await ytServer();
  return { sb: supabase, userId };
}
const txt = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Variants' video (checks it is yours through RLS). */
async function variantVideo(sb: SupabaseClient, id: string) {
  const { data, error } = await sb.from("yt_variants").select("id,video_id,kind").eq("id", id).maybeSingle();
  return { row: data as { id: string; video_id: string; kind: VariantKind } | null, error };
}

/** "Package ready" is only kept while nothing is missing: any edit re-checks it (turns it off if broken). */
async function recheckReady(sb: SupabaseClient, videoId: string) {
  const { data: v } = await sb.from("yt_videos").select("package_ready").eq("id", videoId).maybeSingle();
  if (!v?.package_ready) return;
  const missing = await missingOf(sb, videoId);
  if (missing.length) await sb.from("yt_videos").update({ package_ready: false }).eq("id", videoId);
}

async function missingOf(sb: SupabaseClient, videoId: string): Promise<string[]> {
  const [{ data: v }, { data: vars }, { data: pairs }] = await Promise.all([
    sb.from("yt_videos").select("gap_known,gap_want").eq("id", videoId).maybeSingle(),
    sb.from("yt_variants").select("id,kind,value,tests,image_url").eq("video_id", videoId).eq("archived", false),
    sb.from("yt_pairs").select("title_id,thumbnail_id,is_primary").eq("video_id", videoId),
  ]);
  const list = (vars ?? []) as Pick<YtVariant, "id" | "kind" | "value" | "tests" | "image_url">[];
  return packageMissing({
    gapKnown: (v?.gap_known as string | null) ?? null,
    gapWant: (v?.gap_want as string | null) ?? null,
    titles: list.filter((x) => x.kind === "title").map((x) => ({ id: x.id, value: x.value })),
    thumbs: list.filter((x) => x.kind === "thumbnail").map((x) => ({ id: x.id, tests: x.tests, image_url: x.image_url })),
    pairs: (pairs ?? []) as Pick<YtPair, "title_id" | "thumbnail_id" | "is_primary">[],
  });
}

// ----- Curiosity gap --------------------------------------------------------------------------------
export async function saveGap(videoId: string, input: { gap_known?: string; gap_want?: string }): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if ("gap_known" in input) row.gap_known = txt(input.gap_known, 1000);
  if ("gap_want" in input) row.gap_want = txt(input.gap_want, 1000);
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await sb.from("yt_videos").update(row).eq("id", videoId);
  if (error) return { error: fail(error) };
  await recheckReady(sb, videoId);
  refresh(videoId);
  return { ok: true };
}

// ----- Titles + thumbnail concepts ------------------------------------------------------------------
/** New title (with text) or new thumbnail concept (with a short name). Max 3 of each. */
export async function addVariant(videoId: string, kind: VariantKind, value: string): Promise<Res & { id?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (kind !== "title" && kind !== "thumbnail") return { error: "Unknown kind." };
  const max = kind === "title" ? MAX_TITLES : MAX_THUMBNAILS;
  const { data: have, error: e0 } = await sb.from("yt_variants").select("id,value,position").eq("video_id", videoId).eq("kind", kind).eq("archived", false);
  if (e0) return { error: fail(e0) };
  const list = (have ?? []) as { id: string; value: string; position: number }[];
  if (list.length >= max) return { error: `Up to ${max} ${kind === "title" ? "titles" : "thumbnail concepts"}. Remove one first.` };
  const v = txt(value, kind === "title" ? 150 : 120) ?? (kind === "thumbnail" ? `Concept ${list.length + 1}` : null);
  if (!v) return { error: "Write the title first." };
  if (kind === "title" && list.some((x) => x.value.trim().toLowerCase() === v.toLowerCase())) return { error: "That title is already there." };
  const position = Math.max(0, ...list.map((x) => x.position ?? 0)) + 1;
  const { data, error } = await sb.from("yt_variants").insert({ video_id: videoId, kind, value: v, position }).select("id").single();
  if (error || !data) return { error: fail(error) };
  refresh(videoId);
  return { ok: true, id: data.id as string };
}

export type VariantPatch = Partial<{
  value: string;
  gap_type: string | null;
  focal: string | null;
  supporting: string | null;
  composition: string | null;
  contrast: string[];
  stoppers: string[];
  thumb_text: string | null;
  image_url: string | null;
  tests: ThumbTests;
}>;

const GAP_IDS = GAP_TYPES.map((g) => g.id as string);
const STOPPER_IDS = SCROLL_STOPPERS.map((s) => s.id as string);
const CONTRAST_IDS = CONTRAST_KINDS.map((c) => c.id as string);
const TEST_IDS = THUMB_TESTS.map((t) => t.id as string);

export async function updateVariant(id: string, patch: VariantPatch): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { row: cur, error: e0 } = await variantVideo(sb, id);
  if (e0 || !cur) return { error: fail(e0, "Not found.") };
  const row: Record<string, unknown> = {};
  if ("value" in patch) {
    const v = txt(patch.value, cur.kind === "title" ? 150 : 120);
    if (!v) return { error: cur.kind === "title" ? "The title can't be empty (remove it instead)." : "Give the concept a short name." };
    row.value = v;
  }
  if ("gap_type" in patch) row.gap_type = GAP_IDS.includes(String(patch.gap_type)) ? patch.gap_type : null;
  if ("focal" in patch) row.focal = txt(patch.focal, 500);
  if ("supporting" in patch) row.supporting = txt(patch.supporting, 500);
  if ("composition" in patch) row.composition = (COMPOSITIONS as readonly string[]).includes(String(patch.composition)) ? patch.composition : txt(patch.composition, 200);
  if ("contrast" in patch) row.contrast = [...new Set((patch.contrast ?? []).filter((c) => CONTRAST_IDS.includes(c)))];
  if ("stoppers" in patch) row.stoppers = [...new Set((patch.stoppers ?? []).filter((s) => STOPPER_IDS.includes(s)))];
  if ("thumb_text" in patch) row.thumb_text = txt(patch.thumb_text, 80);
  if ("image_url" in patch) {
    const u = txt(patch.image_url, 2000);
    if (u && !isImageUrl(u)) return { error: "Paste an image link that starts with https://" };
    row.image_url = u;
  }
  if ("tests" in patch) {
    const t: ThumbTests = {};
    for (const k of TEST_IDS) if (patch.tests?.[k as keyof ThumbTests]) (t as Record<string, boolean>)[k] = true;
    if (patch.tests?.notes) t.notes = String(patch.tests.notes).slice(0, 1000);
    row.tests = t;
  }
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await sb.from("yt_variants").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  await recheckReady(sb, cur.video_id);
  refresh(cur.video_id);
  return { ok: true };
}

/** Removes a title / concept from the package (archived: kept for the learning library). Its pairs lose it. */
export async function archiveVariant(id: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { row: cur, error: e0 } = await variantVideo(sb, id);
  if (e0 || !cur) return { error: fail(e0, "Not found.") };
  const { error } = await sb.from("yt_variants").update({ archived: true }).eq("id", id);
  if (error) return { error: fail(error) };
  const col = cur.kind === "title" ? "title_id" : "thumbnail_id";
  await sb.from("yt_pairs").update({ [col]: null }).eq("video_id", cur.video_id).eq(col, id);
  await recheckReady(sb, cur.video_id);
  refresh(cur.video_id);
  return { ok: true };
}

// ----- Pairs ----------------------------------------------------------------------------------------
async function pairsOf(sb: SupabaseClient, videoId: string) {
  const { data, error } = await sb.from("yt_pairs").select("*").eq("video_id", videoId).order("position");
  return { pairs: (data ?? []) as YtPair[], error };
}

/** New pair (next free letter). Without ids it starts empty; the first pair becomes primary. */
export async function addPair(videoId: string, titleId?: string | null, thumbId?: string | null): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { pairs, error: e0 } = await pairsOf(sb, videoId);
  if (e0) return { error: fail(e0) };
  const max = Math.max(MAX_TITLES, MAX_THUMBNAILS);
  const label = pairs.length < max ? nextPairLabel(pairs.map((p) => p.label)) : null;
  if (!label) return { error: `Up to ${max} pairs (A, B, C).` };
  const { error } = await sb.from("yt_pairs").insert({
    video_id: videoId,
    label,
    title_id: titleId || null,
    thumbnail_id: thumbId || null,
    position: Math.max(0, ...pairs.map((p) => p.position ?? 0)) + 1,
    is_primary: !pairs.some((p) => p.is_primary),
  });
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { ok: true };
}

/** Builds A = title 1 + thumbnail 1, B = 2 + 2… when there are no pairs yet. */
export async function autoPairs(videoId: string): Promise<Res & { made?: number }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const [{ pairs, error: e0 }, { data: vars }] = await Promise.all([
    pairsOf(sb, videoId),
    sb.from("yt_variants").select("id,kind,position").eq("video_id", videoId).eq("archived", false).order("position"),
  ]);
  if (e0) return { error: fail(e0) };
  if (pairs.length) return { error: "There are pairs already — edit them below." };
  const list = (vars ?? []) as { id: string; kind: string }[];
  const rows = suggestPairs(list.filter((x) => x.kind === "title").map((x) => x.id), list.filter((x) => x.kind === "thumbnail").map((x) => x.id)).map((p, i) => ({
    video_id: videoId,
    label: p.label,
    title_id: p.title_id,
    thumbnail_id: p.thumbnail_id,
    position: i + 1,
    is_primary: i === 0,
  }));
  if (!rows.length) return { error: "Write at least 1 title and 1 thumbnail concept first." };
  const { error } = await sb.from("yt_pairs").insert(rows);
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { ok: true, made: rows.length };
}

export async function updatePair(id: string, patch: { title_id?: string | null; thumbnail_id?: string | null; notes?: string | null }): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: cur, error: e0 } = await sb.from("yt_pairs").select("video_id").eq("id", id).maybeSingle();
  if (e0 || !cur) return { error: fail(e0, "Pair not found.") };
  const row: Record<string, unknown> = {};
  if ("title_id" in patch) row.title_id = patch.title_id || null;
  if ("thumbnail_id" in patch) row.thumbnail_id = patch.thumbnail_id || null;
  if ("notes" in patch) row.notes = txt(patch.notes, 1000);
  const { error } = await sb.from("yt_pairs").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  await recheckReady(sb, cur.video_id as string);
  refresh(cur.video_id as string);
  return { ok: true };
}

/** Only one primary pair per video: clear the old one first (unique index). */
export async function setPrimaryPair(id: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: cur, error: e0 } = await sb.from("yt_pairs").select("video_id").eq("id", id).maybeSingle();
  if (e0 || !cur) return { error: fail(e0, "Pair not found.") };
  const { error: e1 } = await sb.from("yt_pairs").update({ is_primary: false }).eq("video_id", cur.video_id).neq("id", id);
  if (e1) return { error: fail(e1) };
  const { error } = await sb.from("yt_pairs").update({ is_primary: true }).eq("id", id);
  if (error) return { error: fail(error) };
  await recheckReady(sb, cur.video_id as string);
  refresh(cur.video_id as string);
  return { ok: true };
}

/** Removes a pair (titles and thumbnails stay). If it was primary, the next pair becomes primary. */
export async function deletePair(id: string): Promise<Res> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: cur, error: e0 } = await sb.from("yt_pairs").select("video_id,is_primary,active_from").eq("id", id).maybeSingle();
  if (e0 || !cur) return { error: fail(e0, "Pair not found.") };
  if (cur.active_from) return { error: "This pair was already used on YouTube — it stays for the A/B history." };
  const { error } = await sb.from("yt_pairs").delete().eq("id", id);
  if (error) return { error: fail(error) };
  if (cur.is_primary) {
    const { pairs } = await pairsOf(sb, cur.video_id as string);
    if (pairs[0]) await sb.from("yt_pairs").update({ is_primary: true }).eq("id", pairs[0].id);
  }
  await recheckReady(sb, cur.video_id as string);
  refresh(cur.video_id as string);
  return { ok: true };
}

// ----- Ready ----------------------------------------------------------------------------------------
/** Marks the package ready (only when nothing is missing) or not ready. */
export async function setPackageReady(videoId: string, ready: boolean): Promise<Res & { missing?: string[] }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (ready) {
    const missing = await missingOf(sb, videoId);
    if (missing.length) return { error: `Still missing: ${missing.join(" · ")}`, missing };
  }
  const { error } = await sb.from("yt_videos").update({ package_ready: ready }).eq("id", videoId);
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { ok: true };
}

// ----- ✨ Titles -----------------------------------------------------------------------------------
export type TitleSuggestion = { title: string; why: string };

export async function aiSuggestTitles(videoId: string): Promise<{ items?: TitleSuggestion[]; error?: string; usage?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const [{ data: v }, { data: vars }, { data: refs }] = await Promise.all([
    sb.from("yt_videos").select("idea_name,topic,base_idea,angles,angle_notes,gap_known,gap_want,kind").eq("id", videoId).maybeSingle(),
    sb.from("yt_variants").select("kind,value,thumb_text,gap_type,focal").eq("video_id", videoId).eq("archived", false),
    sb.from("yt_references").select("title,outlier_score").eq("video_id", videoId).order("position").limit(8),
  ]);
  if (!v) return { error: "Video not found." };
  const list = (vars ?? []) as Pick<YtVariant, "kind" | "value" | "thumb_text" | "gap_type" | "focal">[];
  const angles = ((v.angles as string[]) ?? []).map((a) => ANGLES.find((x) => x.id === a)?.label ?? a);
  const prompt = [
    `Idea name (plain description, NOT a title): ${v.idea_name}`,
    v.topic ? `Topic: ${String(v.topic).slice(0, 1200)}` : "",
    v.base_idea ? `Base idea: ${String(v.base_idea).slice(0, 600)}` : "",
    angles.length ? `Angle: ${angles.join(", ")}` : "",
    v.angle_notes ? `Angle notes: ${String(v.angle_notes).slice(0, 800)}` : "",
    v.gap_known ? `Viewer already knows: ${v.gap_known}` : "",
    v.gap_want ? `Viewer wants to know: ${v.gap_want}` : "",
    ...list.filter((x) => x.kind === "title").map((x) => `Existing title: ${x.value}`),
    ...list.filter((x) => x.kind === "thumbnail").map((x) => `Thumbnail concept: ${x.value}${x.focal ? ` — focal: ${x.focal}` : ""}${x.thumb_text ? ` — text on it: "${x.thumb_text}"` : ""}`),
    (refs ?? []).length ? `Outlier references:\n${((refs ?? []) as { title: string; outlier_score: number | null }[]).map((r) => `- ${r.title}${r.outlier_score ? ` (${r.outlier_score}×)` : ""}`).join("\n")}` : "",
    v.kind === "short" ? "This is a YouTube Short." : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, AI_PROMPT_MAX - 2000);
  const system = `You write YouTube titles using Aprilynne Alter's packaging framework. The title is for the viewer: clickable, never boring, and it carries the idea in the FIRST ${TITLE_FIRST_WORDS} words. Keep it ≤ ${TITLE_SOFT_LIMIT} characters. Title + thumbnail together open a curiosity gap; the title must NOT repeat the thumbnail text and must not just restate the idea name. No clickbait lies, no ALL CAPS sentences, no emojis. Write in English.
Reply with JSON: {"items":[{"title":"<title>","why":"<what curiosity gap it opens, ≤ 15 words>"}]} — 6 different titles.`;
  let usage: string | null = null;
  const out = await withAiUsage(
    "youtube-package",
    async () => {
      const o = await aiChat(system, [{ text: prompt }], { kind: "write", json: true, temperature: 0.9, maxTokens: 1200, timeoutMs: 40000 });
      const { timezone } = await getSettings(sb);
      usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb, userId },
  );
  if (!("text" in out)) return { error: out.error, usage };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1)) as Record<string, unknown>;
  } catch {
    return { error: "The AI answered in a strange way. Try again.", usage };
  }
  const have = new Set(list.filter((x) => x.kind === "title").map((x) => x.value.trim().toLowerCase()));
  const items = (Array.isArray(json.items) ? json.items : [])
    .map((x: unknown) => x as Record<string, unknown>)
    .map((x) => ({ title: String(x.title ?? "").trim().replace(/^["“]|["”]$/g, "").slice(0, 150), why: String(x.why ?? "").trim().slice(0, 200) }))
    .filter((x) => x.title && !have.has(x.title.toLowerCase()));
  if (!items.length) return { error: "The AI didn't suggest anything useful. Try again.", usage };
  return { items, usage };
}

