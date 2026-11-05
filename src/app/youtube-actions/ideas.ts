"use server";
// YouTube add-on (Worker A) — idea bank, capture, ideation (Topic → Format → Angle → Criteria), approve,
// stage moves from the board, manual references, ✨ suggestions. Every write goes through RLS ("own rows").
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionState } from "@/app/actions";
import { aiChat, hasAi } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { ytServer, isMissingTable, withSettingsDefaults } from "@/lib/youtube/db";
import { AI_PROMPT_MAX, ANGLES, FORMATS, IDEA_STEPS, MIGRATION_FILE, SHORT_ROLES, isStage, stageLabel, videoHref } from "@/lib/youtube/constants";
import { addsToWip, canApprove, cleanRatings, dataScore, gateStatus, ideaFromText, ideaScore, parseCapture, parseCount, parseYoutubeLinks, wipStatus, ytThumb } from "@/lib/youtube/scoring";
import type { Gates, IdeaStep, YtReference, YtSettings, YtStage, YtVideo } from "@/lib/youtube/types";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const fail = (e: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again.") =>
  isMissingTable(e) ? MISSING : e?.message || fallback;

function refresh(id?: string) {
  revalidatePath("/youtube", "layout");
  if (id) revalidatePath(videoHref(id), "layout");
}

async function ctx() {
  const { supabase, userId } = await ytServer();
  return { sb: supabase, userId };
}

async function settingsOf(sb: SupabaseClient, userId: string): Promise<YtSettings> {
  const { data } = await sb.from("yt_settings").select("*").maybeSingle();
  return withSettingsDefaults(userId, data as Partial<YtSettings> | null);
}

/** Recomputes data score, view potential (refs, or the manual guess when there are no numbers) and the idea score. */
async function rescore(sb: SupabaseClient, userId: string, videoId: string, manualVp?: number | null) {
  const [{ data: v }, { data: refs }, s] = await Promise.all([
    sb.from("yt_videos").select("ratings,view_potential,data_score").eq("id", videoId).maybeSingle(),
    sb.from("yt_references").select("views,channel_median,outlier_score,is_short").eq("video_id", videoId),
    settingsOf(sb, userId),
  ]);
  if (!v) return null;
  const ds = dataScore((refs ?? []) as YtReference[], s.view_goal);
  const prevManual = v.data_score == null ? (v.view_potential as number | null) : null;
  const vp = ds.score ?? (manualVp !== undefined ? manualVp : prevManual);
  const { score } = ideaScore(v.ratings as YtVideo["ratings"], vp, s.score_weights);
  await sb.from("yt_videos").update({ data_score: ds.score, view_potential: vp, priority: score ?? 0 }).eq("id", videoId);
  return { dataScore: ds, viewPotential: vp, score };
}

// ----- Capture ---------------------------------------------------------------------------------------
/** "New idea" box (board): one line → the idea bank. "#shorts" / "short:" → a Short; YouTube links → references. */
export async function createIdea(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = String(form.get("idea") ?? "").slice(0, 2000);
  const cap = parseCapture(raw);
  if (!cap) return { error: "Write the idea first." };
  const kind = form.get("kind") === "short" || cap.kind === "short" ? "short" : "long";
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const metas = cap.links.length ? await Promise.all(cap.links.slice(0, 5).map((l) => oembed(l.url))) : [];
  const name = cap.idea_name || (metas.find((m) => m?.title)?.title ? `Like “${metas.find((m) => m?.title)!.title!.slice(0, 100)}”` : "Idea from a YouTube video");
  const { data, error } = await sb
    .from("yt_videos")
    .insert({ idea_name: name, topic: cap.topic || name, kind, stage: "bank", step: "topic", source: "web", source_quote: cap.quote })
    .select("id")
    .single();
  if (error || !data) return { error: fail(error, "Couldn't save the idea.") };
  let refs = 0;
  if (cap.links.length) {
    const rows = cap.links.slice(0, 5).map((l, i) => ({
      video_id: data.id,
      yt_id: l.yt_id,
      url: l.url,
      title: metas[i]?.title?.slice(0, 300) || l.url,
      channel_title: metas[i]?.author_name?.slice(0, 200) ?? null,
      thumbnail_url: ytThumb(l.yt_id),
      is_short: l.is_short,
      source: "manual",
      position: i + 1,
    }));
    const { error: rErr } = await sb.from("yt_references").insert(rows);
    if (!rErr) refs = rows.length;
  }
  refresh();
  return { ok: true, at: Date.now(), info: `Saved “${name}”${kind === "short" ? " (Short)" : ""} to the idea bank${refs ? ` with ${refs} reference${refs === 1 ? "" : "s"}` : ""}.` };
}

/** Notes → "Turn into video idea": the whole note (title + start) or the selected text, linked to the note. */
export async function createIdeaFromNote(noteId: string, quote?: string | null): Promise<{ id?: string; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: note, error: nErr } = await sb.from("notes").select("id,title,content").eq("id", noteId).is("deleted_at", null).maybeSingle();
  if (nErr || !note) return { error: nErr?.message ?? "Note not found." };
  const q = (quote ?? "").trim().slice(0, 2000);
  const title = String(note.title ?? "").trim();
  const fromQuote = q ? ideaFromText(q) : null;
  const idea = fromQuote ?? ideaFromText(title || String(note.content ?? "")) ?? { idea_name: "Idea from a note", topic: "" };
  const topic = q ? q.replace(/\s+/g, " ") : [title, String(note.content ?? "").replace(/\s+/g, " ").slice(0, 600)].filter(Boolean).join(" — ");
  const { data, error } = await sb
    .from("yt_videos")
    .insert({ idea_name: idea.idea_name, topic: topic.slice(0, 1000) || idea.topic, stage: "bank", step: "topic", source: "note", note_id: noteId, source_quote: q || null })
    .select("id")
    .single();
  if (error || !data) return { error: fail(error, "Couldn't create the idea.") };
  refresh();
  return { id: data.id as string };
}

/** Videos that use a note (research cards) or came from it — for the note page. */
export async function videosForNote(noteId: string): Promise<{ usedIn: { id: string; label: string; stage: string }[]; ideas: { id: string; label: string; stage: string }[]; missing?: boolean }> {
  const { sb, userId } = await ctx();
  if (!userId || !/^[0-9a-f-]{36}$/i.test(noteId)) return { usedIn: [], ideas: [] };
  const [cards, ideas] = await Promise.all([
    sb.from("yt_cards").select("video_id").eq("note_id", noteId).not("video_id", "is", null).limit(200),
    sb.from("yt_videos").select("id,code,idea_name,stage").eq("note_id", noteId).limit(50),
  ]);
  if (cards.error && isMissingTable(cards.error)) return { usedIn: [], ideas: [], missing: true };
  const ids = [...new Set(((cards.data ?? []) as { video_id: string }[]).map((c) => c.video_id))];
  let used: { id: string; label: string; stage: string }[] = [];
  if (ids.length) {
    const { data } = await sb.from("yt_videos").select("id,code,idea_name,stage").in("id", ids);
    used = ((data ?? []) as Pick<YtVideo, "id" | "code" | "idea_name" | "stage">[]).map((v) => ({ id: v.id, label: v.code ? `${v.code} · ${v.idea_name}` : v.idea_name, stage: stageLabel(v.stage) }));
  }
  const from = ((ideas.data ?? []) as Pick<YtVideo, "id" | "code" | "idea_name" | "stage">[]).map((v) => ({ id: v.id, label: v.code ? `${v.code} · ${v.idea_name}` : v.idea_name, stage: stageLabel(v.stage) }));
  return { usedIn: used, ideas: from };
}

// ----- Ideation fields -------------------------------------------------------------------------------
export type IdeaPatch = Partial<{
  idea_name: string;
  topic: string | null;
  base_idea: string | null;
  formats: string[];
  angles: string[];
  angle_notes: string | null;
  step: IdeaStep;
  kind: "long" | "short";
  short_role: string | null;
  quick_notes: string | null;
  tags: string[];
}>;

const FORMAT_IDS = FORMATS.map((f) => f.id as string);
const ANGLE_IDS = ANGLES.map((a) => a.id as string);
const STEP_IDS = IDEA_STEPS.map((s) => s.id as string);

/** Saves ideation fields (whitelisted + checked). Starting the stepper moves a bank idea to "Ideation". */
export async function updateIdea(id: string, patch: IdeaPatch): Promise<{ ok?: boolean; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  const txt = (v: unknown, max: number) => {
    const s = String(v ?? "").trim();
    return s ? s.slice(0, max) : null;
  };
  if ("idea_name" in patch) {
    const n = txt(patch.idea_name, 200);
    if (!n) return { error: "The idea name can't be empty." };
    row.idea_name = n;
  }
  if ("topic" in patch) row.topic = txt(patch.topic, 2000);
  if ("base_idea" in patch) row.base_idea = txt(patch.base_idea, 2000);
  if ("angle_notes" in patch) row.angle_notes = txt(patch.angle_notes, 4000);
  if ("quick_notes" in patch) row.quick_notes = txt(patch.quick_notes, 20000);
  if ("formats" in patch) row.formats = [...new Set((patch.formats ?? []).filter((f) => FORMAT_IDS.includes(f)))];
  if ("angles" in patch) row.angles = [...new Set((patch.angles ?? []).filter((a) => ANGLE_IDS.includes(a)))];
  if ("tags" in patch) row.tags = [...new Set((patch.tags ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  if ("step" in patch) {
    if (!STEP_IDS.includes(patch.step as string)) return { error: "Unknown step." };
    row.step = patch.step;
  }
  if ("kind" in patch) row.kind = patch.kind === "short" ? "short" : "long";
  if ("short_role" in patch) row.short_role = SHORT_ROLES.some((r) => r.id === patch.short_role) ? patch.short_role : null;
  if (!Object.keys(row).length) return { ok: true };
  const { data: cur, error: e0 } = await sb.from("yt_videos").select("stage").eq("id", id).maybeSingle();
  if (e0 || !cur) return { error: fail(e0, "Video not found.") };
  if (cur.stage === "bank" && (row.step && row.step !== "topic")) row.stage = "idea";
  const { error } = await sb.from("yt_videos").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  refresh(id);
  return { ok: true };
}

/** Criteria step: gates + ratings (+ a manual view-potential guess when there are no reference numbers) → score. */
export async function saveCriteria(id: string, input: { gates: Gates; ratings: Record<string, unknown>; manualViewPotential?: number | null }): Promise<{ ok?: boolean; error?: string; score?: number | null; viewPotential?: number | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const gates: Gates = {};
  for (const k of ["feasibility", "brand", "packageability"] as const) {
    const v = input.gates?.[k];
    gates[k] = v === true ? true : v === false ? false : null;
  }
  if (input.gates?.notes) gates.notes = String(input.gates.notes).slice(0, 2000);
  const ratings = cleanRatings(input.ratings);
  const { data: cur } = await sb.from("yt_videos").select("stage").eq("id", id).maybeSingle();
  const row: Record<string, unknown> = { gates, ratings, step: "criteria" };
  if (cur?.stage === "bank") row.stage = "idea";
  const { error } = await sb.from("yt_videos").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  const mv = input.manualViewPotential;
  const r = await rescore(sb, userId, id, typeof mv === "number" && mv >= 1 && mv <= 10 ? Math.round(mv) : mv === null ? null : undefined);
  refresh(id);
  return { ok: true, score: r?.score ?? null, viewPotential: r?.viewPotential ?? null };
}

/** Hard gate (a): all 3 gates yes → stage Package; the database gives the V-number. */
export async function approveIdea(id: string): Promise<{ ok?: boolean; error?: string; code?: string | null; wipWarning?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: v, error: e0 } = await sb.from("yt_videos").select("id,stage,gates,idea_name").eq("id", id).maybeSingle();
  if (e0 || !v) return { error: fail(e0, "Video not found.") };
  const check = canApprove(v as Pick<YtVideo, "stage" | "gates" | "idea_name">);
  if (!check.ok) return { error: check.reason };
  const { data, error } = await sb.from("yt_videos").update({ stage: "package", approved_at: new Date().toISOString() }).eq("id", id).select("code").single();
  if (error) return { error: fail(error) };
  const wip = await wipWarning(sb, userId);
  refresh(id);
  return { ok: true, code: (data?.code as string | null) ?? null, wipWarning: wip };
}

async function wipWarning(sb: SupabaseClient, userId: string) {
  const [{ data }, s] = await Promise.all([sb.from("yt_videos").select("stage").neq("stage", "archived"), settingsOf(sb, userId)]);
  const w = wipStatus(((data ?? []) as { stage: string }[]).map((r) => r.stage), s.wip_limit);
  return w.over ? `You now have ${w.count} videos in progress (your limit is ${w.limit}). Consider finishing one first.` : null;
}

/**
 * Board "Move to…": any stage, with the 3 hard gates checked: (a) leaving the bank needs the 3 gates,
 * (b) Script needs a climax in the outline, (c) Published needs the intro Final + Filmed. Archive = park.
 */
export async function moveVideo(id: string, to: string, reason?: string | null): Promise<{ ok?: boolean; error?: string; code?: string | null; wipWarning?: string | null }> {
  if (!isStage(to)) return { error: "Unknown stage." };
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: v, error: e0 } = await sb.from("yt_videos").select("id,stage,gates,idea_name,approved_at,code").eq("id", id).maybeSingle();
  if (e0 || !v) return { error: fail(e0, "Video not found.") };
  const from = v.stage as YtStage;
  if (from === to) return { ok: true };
  const target = to as YtStage;
  const bankish = (s: string) => s === "bank" || s === "idea";
  if (bankish(from) && !bankish(target) && target !== "archived" && gateStatus(v.gates as Gates) !== "pass") {
    return { error: "Hard gate: answer Feasibility, Brand and Packageability with “yes” in Criteria first." };
  }
  const order = ["outline", "script", "shots", "filming", "edit", "publish", "published"];
  if (order.indexOf(target) >= 1 && order.indexOf(from as string) < 1) {
    const { data: climax, error } = await sb.from("yt_sections").select("id").eq("video_id", id).eq("is_climax", true).limit(1);
    if (!error && !(climax ?? []).length) return { error: "Hard gate: mark the climax in the outline before the script." };
  }
  if (target === "published") {
    const { data: intro, error } = await sb.from("yt_sections").select("intro_status").eq("video_id", id).eq("kind", "intro").maybeSingle();
    if (!error && intro?.intro_status !== "filmed") return { error: "Hard gate: the intro must be Final + Filmed before publishing." };
  }
  const row: Record<string, unknown> = { stage: target };
  if (target === "archived") row.archived_reason = (reason ?? "").trim().slice(0, 500) || null;
  if (!bankish(target) && target !== "archived" && !v.approved_at) row.approved_at = new Date().toISOString();
  const { data, error } = await sb.from("yt_videos").update(row).eq("id", id).select("code").single();
  if (error) return { error: fail(error) };
  const wip = addsToWip(from, target) ? await wipWarning(sb, userId) : null;
  refresh(id);
  return { ok: true, code: (data?.code as string | null) ?? null, wipWarning: wip };
}

// ----- References (Topic step, manual) ---------------------------------------------------------------
async function oembed(url: string): Promise<{ title?: string; author_name?: string; author_url?: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as { title?: string; author_name?: string; author_url?: string };
  } catch {
    return null;
  }
}

/** Paste YouTube links → saved references of this idea (title/channel from YouTube when reachable). */
export async function addReferences(videoId: string, text: string): Promise<{ ok?: boolean; error?: string; added?: number; skipped?: number }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const links = parseYoutubeLinks(String(text ?? "").slice(0, 10_000)).slice(0, 20);
  if (!links.length) return { error: "Paste one or more YouTube video links." };
  const { data: have, error: e0 } = await sb.from("yt_references").select("yt_id,position").eq("video_id", videoId);
  if (e0) return { error: fail(e0) };
  const taken = new Set(((have ?? []) as { yt_id: string | null }[]).map((r) => r.yt_id));
  const fresh = links.filter((l) => !taken.has(l.yt_id));
  if (!fresh.length) return { ok: true, added: 0, skipped: links.length };
  let pos = Math.max(0, ...((have ?? []) as { position: number }[]).map((r) => r.position ?? 0));
  const metas = await Promise.all(fresh.map((l) => oembed(l.url)));
  const rows = fresh.map((l, i) => ({
    video_id: videoId,
    yt_id: l.yt_id,
    url: l.url,
    title: metas[i]?.title?.slice(0, 300) || l.url,
    channel_title: metas[i]?.author_name?.slice(0, 200) ?? null,
    thumbnail_url: ytThumb(l.yt_id),
    is_short: l.is_short,
    source: "manual",
    position: ++pos,
  }));
  const { error } = await sb.from("yt_references").insert(rows);
  if (error) return { error: fail(error) };
  await rescore(sb, userId, videoId);
  refresh(videoId);
  return { ok: true, added: rows.length, skipped: links.length - rows.length };
}

/** Numbers of a reference (views, channel median, subscribers) → outlier score → view potential. */
export async function updateReference(id: string, input: { views?: string; channel_median?: string; channel_subs?: string; note?: string; title?: string }): Promise<{ ok?: boolean; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  for (const k of ["views", "channel_median", "channel_subs"] as const) {
    if (!(k in input)) continue;
    const n = parseCount(input[k]);
    if (n !== null && Number.isNaN(n)) return { error: "Numbers like 120000, 120K or 1.2M." };
    row[k] = n;
  }
  if ("note" in input) row.note = (input.note ?? "").trim().slice(0, 1000) || null;
  if ("title" in input && input.title?.trim()) row.title = input.title.trim().slice(0, 300);
  const { data: cur, error: e0 } = await sb.from("yt_references").select("video_id,views,channel_median,source").eq("id", id).maybeSingle();
  if (e0 || !cur) return { error: fail(e0, "Reference not found.") };
  const views = ("views" in row ? row.views : cur.views) as number | null;
  const med = ("channel_median" in row ? row.channel_median : cur.channel_median) as number | null;
  if ("views" in row || "channel_median" in row) row.outlier_score = views && med ? Math.round((views / med) * 100) / 100 : null;
  const { error } = await sb.from("yt_references").update(row).eq("id", id);
  if (error) return { error: fail(error) };
  if (cur.video_id) {
    await rescore(sb, userId, cur.video_id as string);
    refresh(cur.video_id as string);
  }
  return { ok: true };
}

export async function deleteReference(id: string): Promise<{ ok?: boolean; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: cur } = await sb.from("yt_references").select("video_id").eq("id", id).maybeSingle();
  const { error } = await sb.from("yt_references").delete().eq("id", id);
  if (error) return { error: fail(error) };
  if (cur?.video_id) {
    await rescore(sb, userId, cur.video_id as string);
    refresh(cur.video_id as string);
  }
  return { ok: true };
}

// ----- ✨ AI suggestions (always on a button; the page shows a preview to accept or discard) ------------
export type FormatSuggestion = { format: string; base_idea: string };
export type AngleSuggestion = { angle: string; idea: string; titles: string[] };

async function ideaContext(sb: SupabaseClient, id: string) {
  const [{ data: v }, { data: refs }] = await Promise.all([
    sb.from("yt_videos").select("idea_name,topic,base_idea,formats,angles,angle_notes,kind").eq("id", id).maybeSingle(),
    sb.from("yt_references").select("title,views,outlier_score").eq("video_id", id).order("position").limit(10),
  ]);
  if (!v) return null;
  const lines = [
    `Idea name: ${v.idea_name}`,
    v.topic ? `Topic: ${String(v.topic).slice(0, 1500)}` : "",
    v.base_idea ? `Base idea: ${String(v.base_idea).slice(0, 800)}` : "",
    (v.formats as string[])?.length ? `Formats chosen: ${(v.formats as string[]).join(", ")}` : "",
    (v.angles as string[])?.length ? `Angles chosen: ${(v.angles as string[]).join(", ")}` : "",
    v.kind === "short" ? "This is a YouTube Short (vertical, under 60 s)." : "",
    (refs ?? []).length ? `Outlier references:\n${((refs ?? []) as { title: string; outlier_score: number | null }[]).map((r) => `- ${r.title}${r.outlier_score ? ` (${r.outlier_score}×)` : ""}`).join("\n")}` : "",
  ].filter(Boolean);
  return lines.join("\n").slice(0, AI_PROMPT_MAX - 2500);
}

async function runAi(sb: SupabaseClient, userId: string, feature: string, system: string, prompt: string) {
  let usage: string | null = null;
  const out = await withAiUsage(
    feature,
    async () => {
      const o = await aiChat(system, [{ text: prompt }], { kind: "write", json: true, temperature: 0.8, maxTokens: 1800, timeoutMs: 40000 });
      const { timezone } = await getSettings(sb);
      usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb, userId },
  );
  if (!("text" in out)) return { error: out.error, usage };
  const s = out.text.indexOf("{");
  const e = out.text.lastIndexOf("}");
  try {
    return { json: JSON.parse(out.text.slice(s, e + 1)) as Record<string, unknown>, usage };
  } catch {
    return { error: "The AI answered in a strange way. Try again.", usage };
  }
}

const SYSTEM_BASE =
  "You help a YouTuber (one channel: long videos about building his own 'Personal OS' app, productivity, and teaching English as a second language) turn ideas into videos, using Aprilynne Alter's framework: Topic + Format = Base idea, then Angle. Write in English. Be concrete and remarkable (better or different), never generic.";

export async function aiSuggestFormats(id: string): Promise<{ items?: FormatSuggestion[]; error?: string; usage?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const c = await ideaContext(sb, id);
  if (!c) return { error: "Video not found." };
  const r = await runAi(
    sb,
    userId,
    "youtube-ideation",
    `${SYSTEM_BASE}\nReply with JSON: {"items":[{"format":"<one of: ${FORMATS.map((f) => f.id).join(", ")}>","base_idea":"<one sentence: the topic done in that format>"}]} — one item per format (6 items).`,
    c,
  );
  if ("error" in r) return { error: r.error, usage: r.usage };
  const items = (Array.isArray(r.json.items) ? r.json.items : [])
    .map((x: unknown) => x as Record<string, unknown>)
    .filter((x) => FORMAT_IDS.includes(String(x.format)) && String(x.base_idea ?? "").trim())
    .map((x) => ({ format: String(x.format), base_idea: String(x.base_idea).trim().slice(0, 400) }));
  if (!items.length) return { error: "The AI didn't suggest anything useful. Try again.", usage: r.usage };
  return { items, usage: r.usage };
}

export async function aiSuggestAngles(id: string): Promise<{ items?: AngleSuggestion[]; error?: string; usage?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const c = await ideaContext(sb, id);
  if (!c) return { error: "Video not found." };
  const r = await runAi(
    sb,
    userId,
    "youtube-ideation",
    `${SYSTEM_BASE}\nAngles: ${ANGLES.map((a) => `${a.id} (${a.example})`).join("; ")}.\nReply with JSON: {"items":[{"angle":"<angle id>","idea":"<the video with that angle, one sentence>","titles":["<clickable title, idea in the first 4 words, ≤ 60 chars>","<another>"]}]} — 5 to 7 items with the most promising angles for this idea.`,
    c,
  );
  if ("error" in r) return { error: r.error, usage: r.usage };
  const items = (Array.isArray(r.json.items) ? r.json.items : [])
    .map((x: unknown) => x as Record<string, unknown>)
    .filter((x) => ANGLE_IDS.includes(String(x.angle)) && String(x.idea ?? "").trim())
    .map((x) => ({
      angle: String(x.angle),
      idea: String(x.idea).trim().slice(0, 400),
      titles: (Array.isArray(x.titles) ? x.titles : []).map((t) => String(t).trim().slice(0, 120)).filter(Boolean).slice(0, 3),
    }));
  if (!items.length) return { error: "The AI didn't suggest anything useful. Try again.", usage: r.usage };
  return { items, usage: r.usage };
}

/** Accepting a ✨ title from an angle suggestion: becomes a title candidate of the package (max 3). */
export async function addTitleCandidate(videoId: string, title: string): Promise<{ ok?: boolean; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const t = title.trim().slice(0, 150);
  if (!t) return { error: "Empty title." };
  const { data: have, error: e0 } = await sb.from("yt_variants").select("id,value,position").eq("video_id", videoId).eq("kind", "title").eq("archived", false);
  if (e0) return { error: fail(e0) };
  const list = (have ?? []) as { value: string; position: number }[];
  if (list.some((x) => x.value.trim().toLowerCase() === t.toLowerCase())) return { ok: true };
  if (list.length >= 3) return { error: "There are already 3 titles in the package. Remove one there first." };
  const { error } = await sb.from("yt_variants").insert({ video_id: videoId, kind: "title", value: t, position: list.length + 1 });
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { ok: true };
}
