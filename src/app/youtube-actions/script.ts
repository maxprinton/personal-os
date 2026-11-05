"use server";
// YouTube add-on (Worker B) — outline, script by sections, research Sources, export to Notes, intro assistant.
// Rules: intro (S00) + closing (S99) always exist and can't be deleted; exactly one climax before the script
// (not for Shorts); locking the outline gives every section a FIXED number; no text outside sections.
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionState } from "@/app/actions";
import { aiChat, hasAi } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { isMissingTable, ytServer } from "@/lib/youtube/db";
import { AI_PROMPT_MAX, CLOSING_NUM, FORMATS, INTRO_NUM, INTRO_STATUSES, INTRO_WATCH_TARGET, MIGRATION_FILE, NOTE_TYPES, sectionCode, videoHref } from "@/lib/youtube/constants";
import {
  assignNumbers, clampEnergy, exportTitle, fullScriptMarkdown, nextExportVersion, normalizeTemplate, orderSections, scriptPlainText, sectionWords, templateFor, validateOutline,
} from "@/lib/youtube/outline";
import type { IntroGuides, IntroStatus, OutlineTemplateSection, VideoFormat, YtKind, YtSection, YtStage } from "@/lib/youtube/types";

const MISSING = `Run ${MIGRATION_FILE} in Supabase first, then try again.`;
const fail = (e: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again.") =>
  isMissingTable(e) ? MISSING : e?.message || fallback;

function refresh(videoId: string) {
  revalidatePath(videoHref(videoId), "layout");
  revalidatePath("/youtube");
}

async function ctx() {
  const { supabase, userId } = await ytServer();
  return { sb: supabase, userId };
}

type VideoRow = { id: string; kind: YtKind; stage: YtStage; idea_name: string; code: string | null; outline_locked_at: string | null; formats: string[] | null };
async function videoOf(sb: SupabaseClient, videoId: string): Promise<VideoRow | null> {
  const { data } = await sb.from("yt_videos").select("id,kind,stage,idea_name,code,outline_locked_at,formats").eq("id", videoId).maybeSingle();
  return (data as VideoRow | null) ?? null;
}
async function sectionsOf(sb: SupabaseClient, videoId: string): Promise<YtSection[]> {
  const { data } = await sb.from("yt_sections").select("*").eq("video_id", videoId);
  return orderSections((data ?? []) as YtSection[]);
}
/** Moves the video forward to `to` only from the stages just before it (never backwards, never out of the bank). */
async function advanceStage(sb: SupabaseClient, v: VideoRow, to: YtStage, from: YtStage[]) {
  if (from.includes(v.stage)) await sb.from("yt_videos").update({ stage: to }).eq("id", v.id);
}

// ----- Outline -----------------------------------------------------------------------------------------
export type OutlineSource = { builtin: VideoFormat | "short" } | { templateId: string };

/** Creates the outline from a template (built-in per format, Shorts = Hook · Body · Payoff, or one of yours). */
export async function createOutline(videoId: string, source: OutlineSource): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const { count, error: cErr } = await sb.from("yt_sections").select("id", { count: "exact", head: true }).eq("video_id", videoId);
  if (cErr) return { error: fail(cErr) };
  if (count) return { error: "This video already has an outline." };
  let raw: OutlineTemplateSection[];
  let name: string;
  if ("templateId" in source) {
    const { data: t } = await sb.from("yt_outline_templates").select("name,sections").eq("id", source.templateId).maybeSingle();
    if (!t) return { error: "Template not found." };
    raw = (t.sections ?? []) as OutlineTemplateSection[];
    name = String(t.name);
  } else if (source.builtin === "short" || v.kind === "short") {
    raw = templateFor(null, "short");
    name = "Short";
  } else {
    raw = templateFor(source.builtin, "long");
    name = FORMATS.find((f) => f.id === source.builtin)?.label ?? "Tutorial";
  }
  const secs = normalizeTemplate(raw, v.kind);
  let bodyPos = 0;
  const rows = secs.map((s) => ({
    video_id: videoId,
    kind: s.kind,
    title: s.title.slice(0, 200),
    description: s.description?.slice(0, 1000) ?? null,
    position: s.kind === "intro" ? 0 : s.kind === "closing" ? 1000 : ++bodyPos,
    is_climax: v.kind === "short" ? false : !!s.is_climax,
    energy: clampEnergy(s.energy),
    content: "",
    words: 0,
  }));
  const { error } = await sb.from("yt_sections").insert(rows);
  if (error) return { error: fail(error, "Couldn't create the outline.") };
  await sb.from("yt_videos").update({ outline_template: name }).eq("id", videoId);
  await advanceStage(sb, v, "outline", ["package", "research"]);
  refresh(videoId);
  return { ok: true, at: Date.now(), info: `Outline created from “${name}”.` };
}

/** Adds a body part after `afterId` (or at the end). Once locked, it gets the next free number right away. */
export async function addSection(videoId: string, afterId: string | null, title = "New part"): Promise<{ id?: string; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const secs = await sectionsOf(sb, videoId);
  const body = secs.filter((s) => s.kind === "body");
  let position: number;
  const at = afterId ? secs.findIndex((s) => s.id === afterId) : -1;
  const after = at >= 0 ? secs[at] : null;
  if (!after || after.kind === "closing") position = (body.at(-1)?.position ?? 0) + 1;
  else {
    const next = body.find((s) => s.position > (after.kind === "intro" ? -Infinity : after.position));
    const prevPos = after.kind === "intro" ? (body[0]?.position ?? 1) - 1 : after.position;
    position = next && next.id !== after.id ? (prevPos + next.position) / 2 : prevPos + 1;
  }
  let num: number | null = null;
  if (v.outline_locked_at) {
    const max = Math.max(0, ...body.map((s) => s.num ?? 0));
    num = max + 1 < CLOSING_NUM ? max + 1 : null;
  }
  const { data, error } = await sb
    .from("yt_sections")
    .insert({ video_id: videoId, kind: "body", title: title.trim().slice(0, 200) || "New part", position, num, content: "", words: 0 })
    .select("id")
    .single();
  if (error) return { error: fail(error, "Couldn't add the part.") };
  refresh(videoId);
  return { id: data.id as string };
}

export type SectionMeta = { title?: string; description?: string | null; energy?: number | null };
export async function updateSectionMeta(id: string, patch: SectionMeta): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim().slice(0, 200) || "Untitled part";
  if (patch.description !== undefined) row.description = patch.description?.trim().slice(0, 1000) || null;
  if (patch.energy !== undefined) row.energy = clampEnergy(patch.energy);
  const { data, error } = await sb.from("yt_sections").update(row).eq("id", id).select("video_id").maybeSingle();
  if (error) return { error: fail(error) };
  if (data) refresh(data.video_id as string);
  return { ok: true, at: Date.now() };
}

/** New order of the body parts (ids, top to bottom). Numbers don't change (they are fixed once locked). */
export async function reorderSections(videoId: string, bodyIds: string[]): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const secs = await sectionsOf(sb, videoId);
  const body = new Set(secs.filter((s) => s.kind === "body").map((s) => s.id));
  const ids = bodyIds.filter((id) => body.has(id));
  if (ids.length !== body.size) return { error: "The outline changed. Reload the page and try again." };
  const results = await Promise.all(ids.map((id, i) => sb.from("yt_sections").update({ position: i + 1 }).eq("id", id).eq("video_id", videoId)));
  const err = results.find((r) => r.error)?.error;
  if (err) return { error: fail(err) };
  refresh(videoId);
  return { ok: true, at: Date.now() };
}

/** Marks the climax (one per video: the old one is cleared first). null = no climax (Shorts only). */
export async function setClimax(videoId: string, sectionId: string | null): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error: e1 } = await sb.from("yt_sections").update({ is_climax: false }).eq("video_id", videoId).eq("is_climax", true);
  if (e1) return { error: fail(e1) };
  if (sectionId) {
    const { error } = await sb.from("yt_sections").update({ is_climax: true }).eq("id", sectionId).eq("video_id", videoId).eq("kind", "body");
    if (error) return { error: fail(error) };
  }
  refresh(videoId);
  return { ok: true, at: Date.now() };
}

/** Deletes a body part (intro and closing can't be deleted). Its shots stay, without a section. */
export async function deleteSection(id: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: s } = await sb.from("yt_sections").select("id,kind,video_id").eq("id", id).maybeSingle();
  if (!s) return { error: "Part not found." };
  if (s.kind !== "body") return { error: "The intro and the closing can't be deleted." };
  const { error } = await sb.from("yt_sections").delete().eq("id", id);
  if (error) return { error: fail(error) };
  refresh(s.video_id as string);
  return { ok: true, at: Date.now(), info: "Part deleted." };
}

/** Locks the outline: checks the rules (one climax…), gives every section its fixed number, opens the script. */
export async function lockOutline(videoId: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const secs = await sectionsOf(sb, videoId);
  const check = validateOutline(secs, v.kind);
  if (!check.ok) return { error: check.errors.join(" ") };
  const nums = assignNumbers(secs);
  const changes = secs.filter((s) => nums[s.id] != null && nums[s.id] !== s.num);
  for (const s of changes) {
    const { error } = await sb.from("yt_sections").update({ num: nums[s.id] }).eq("id", s.id);
    if (error) return { error: fail(error, "Couldn't number the parts.") };
  }
  const { error } = await sb.from("yt_videos").update({ outline_locked_at: v.outline_locked_at ?? new Date().toISOString() }).eq("id", videoId);
  if (error) return { error: fail(error) };
  await advanceStage(sb, v, "script", ["package", "research", "outline"]);
  refresh(videoId);
  return { ok: true, at: Date.now(), info: "Outline locked: every part has its number. Write each part below." };
}

/** Saves the current outline (titles, descriptions, climax, energy — no text) as your own template. */
export async function saveOutlineTemplate(videoId: string, name: string, format: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const secs = await sectionsOf(sb, videoId);
  if (!secs.length) return { error: "There is no outline yet." };
  const sections: OutlineTemplateSection[] = secs.map((s) => ({
    kind: s.kind,
    title: s.title,
    ...(s.description ? { description: s.description } : {}),
    ...(s.is_climax ? { is_climax: true } : {}),
    ...(s.energy ? { energy: s.energy } : {}),
  }));
  const { error } = await sb.from("yt_outline_templates").insert({ format: format || "tutorial", name: name.trim().slice(0, 80) || "My template", sections });
  if (error) return { error: fail(error, "Couldn't save the template.") };
  refresh(videoId);
  return { ok: true, at: Date.now(), info: "Template saved. It appears when you create a new outline." };
}

export async function deleteOutlineTemplate(id: string, videoId: string): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("yt_outline_templates").delete().eq("id", id);
  if (error) return { error: fail(error) };
  refresh(videoId);
  return { ok: true, at: Date.now() };
}

// ----- Script text ---------------------------------------------------------------------------------------
/** Saves a section's Markdown (+ word count without Sources). An empty intro that gets text becomes "Draft". */
export async function saveSectionContent(id: string, content: string): Promise<{ words?: number; error?: string; introStatus?: IntroStatus }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const md = String(content ?? "").slice(0, 400_000);
  const words = sectionWords(md);
  const { data: s } = await sb.from("yt_sections").select("id,kind,intro_status,video_id").eq("id", id).maybeSingle();
  if (!s) return { error: "Part not found." };
  const row: Record<string, unknown> = { content: md, words };
  let introStatus = s.intro_status as IntroStatus;
  if (s.kind === "intro" && introStatus === "not_written" && words > 0) row.intro_status = introStatus = "draft";
  const { error } = await sb.from("yt_sections").update(row).eq("id", id);
  if (error) return { error: fail(error, "Couldn't save. Your text is still here; try again.") };
  return { words, introStatus };
}

/** Adds (or removes) a research card as a Source of a section. `content` = the section text with the Source block already put in (or taken out). */
export async function setSectionCard(id: string, cardId: string, on: boolean, content: string): Promise<{ words?: number; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: s } = await sb.from("yt_sections").select("id,card_ids,video_id").eq("id", id).maybeSingle();
  if (!s) return { error: "Part not found." };
  const ids = new Set((s.card_ids ?? []) as string[]);
  if (on) ids.add(cardId);
  else ids.delete(cardId);
  const md = String(content ?? "").slice(0, 400_000);
  const words = sectionWords(md);
  const { error } = await sb.from("yt_sections").update({ card_ids: [...ids], content: md, words }).eq("id", id);
  if (error) return { error: fail(error) };
  refresh(s.video_id as string);
  return { words };
}

// ----- Export to Notes -------------------------------------------------------------------------------------
async function scriptTypeProps(sb: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  const { data: prop } = await sb.from("note_properties").select("id,config").eq("user_id", userId).eq("key", "type").is("deleted_at", null).maybeSingle();
  if (!prop) return {};
  const config = (prop.config ?? {}) as { options?: { id: string; name: string; color?: string }[] };
  const options = config.options ?? [];
  let opt = options.find((o) => o.name.toLowerCase() === NOTE_TYPES.script.toLowerCase());
  if (!opt) {
    opt = { id: "yt_script", name: NOTE_TYPES.script, color: "red" };
    await sb.from("note_properties").update({ config: { ...config, options: [...options, opt] } }).eq("id", prop.id);
  }
  return { [prop.id as string]: opt.id };
}

export type ExportTarget = { mode: "new" } | { mode: "update"; noteId: string };
/** Exports the whole script to Notes ("Script · name · date"), as a new version or over an earlier export. */
export async function exportScriptToNotes(videoId: string, target: ExportTarget, sources: "omit" | "footnotes"): Promise<{ noteId?: string; version?: number; title?: string; error?: string }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const secs = await sectionsOf(sb, videoId);
  if (!secs.length) return { error: "There is no script yet." };
  const { data: exps, error: xErr } = await sb.from("yt_script_exports").select("id,note_id,version").eq("video_id", videoId);
  if (xErr) return { error: fail(xErr) };
  const { timezone } = await getSettings(sb);
  const date = localNow(timezone).date;
  const link = `[${v.code ?? "Video"} · open in YouTube](${videoHref(videoId, "script")})`;
  const body = fullScriptMarkdown(
    secs.map((s, i) => ({ code: s.num != null ? sectionCode(s.num) : s.kind === "intro" ? sectionCode(INTRO_NUM) : s.kind === "closing" ? sectionCode(CLOSING_NUM) : sectionCode(i), title: s.title, content: s.content, kind: s.kind })),
    { sources },
  );
  const content = `${link}\n\n${body}`;
  const props = await scriptTypeProps(sb, userId).catch(() => ({}));

  if (target.mode === "update") {
    const exp = (exps ?? []).find((e) => e.note_id === target.noteId);
    if (!exp) return { error: "That export isn't linked to this video." };
    const { data: note } = await sb.from("notes").select("id,title,props").eq("id", target.noteId).is("deleted_at", null).maybeSingle();
    if (!note) return { error: "That note was deleted. Create a new version instead." };
    const { error } = await sb.from("notes").update({ content, props: { ...((note.props ?? {}) as object), ...props } }).eq("id", target.noteId);
    if (error) return { error: fail(error, "Couldn't update the note.") };
    await sb.from("yt_script_exports").update({ exported_at: new Date().toISOString() }).eq("id", exp.id);
    refresh(videoId);
    return { noteId: target.noteId, version: exp.version as number, title: note.title as string };
  }

  const version = nextExportVersion((exps ?? []) as { version: number }[]);
  const title = exportTitle(v.idea_name, date, version);
  const { data: note, error } = await sb.from("notes").insert({ title, content, props }).select("id").single();
  if (error || !note) return { error: fail(error, "Couldn't create the note.") };
  const { error: e2 } = await sb.from("yt_script_exports").insert({ video_id: videoId, note_id: note.id, version, title });
  if (e2) return { error: fail(e2) };
  refresh(videoId);
  return { noteId: note.id as string, version, title };
}

// ----- Intro -----------------------------------------------------------------------------------------------
export type IntroPatch = { intro_status?: IntroStatus; guides?: Partial<IntroGuides>; watch_checks?: number; watch_notes?: string | null };
export async function updateIntro(sectionId: string, patch: IntroPatch): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data: s } = await sb.from("yt_sections").select("id,kind,video_id,intro_guides").eq("id", sectionId).maybeSingle();
  if (!s || s.kind !== "intro") return { error: "Intro not found." };
  const row: Record<string, unknown> = {};
  if (patch.intro_status && INTRO_STATUSES.some((x) => x.id === patch.intro_status)) row.intro_status = patch.intro_status;
  if (patch.guides) {
    const g: IntroGuides = { ...((s.intro_guides ?? {}) as IntroGuides) };
    for (const [k, val] of Object.entries(patch.guides)) (g as Record<string, unknown>)[k] = typeof val === "string" ? val.slice(0, 2000) : val;
    row.intro_guides = g;
  }
  if (patch.watch_checks !== undefined) row.watch_checks = Math.max(0, Math.min(INTRO_WATCH_TARGET, Math.round(Number(patch.watch_checks) || 0)));
  if (patch.watch_notes !== undefined) row.watch_notes = patch.watch_notes?.slice(0, 2000) || null;
  const { error } = await sb.from("yt_sections").update(row).eq("id", sectionId);
  if (error) return { error: fail(error) };
  refresh(s.video_id as string);
  return { ok: true, at: Date.now() };
}

/** Marks a moment as used in the intro (or not). */
export async function setMomentUsed(momentId: string, used: boolean): Promise<ActionState> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { data, error } = await sb.from("yt_moments").update({ used_in_intro: used }).eq("id", momentId).select("video_id").maybeSingle();
  if (error) return { error: fail(error) };
  if (data) refresh(data.video_id as string);
  return { ok: true, at: Date.now() };
}

export type IntroIdeas = { first_lines: string[]; open_loops: { text: string; closes?: string }[]; input_bias: string[]; context?: string };
/** ✨ Ideas for the intro: first lines that match the title, open loops (closed by the climax), effort lines from moments. */
export async function aiIntroIdeas(videoId: string, title: string | null): Promise<{ ideas?: IntroIdeas; error?: string; usage?: string | null }> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  const v = await videoOf(sb, videoId);
  if (!v) return { error: "Video not found." };
  const [secs, { data: moments }, { data: vfull }] = await Promise.all([
    sectionsOf(sb, videoId),
    sb.from("yt_moments").select("text,kind").eq("video_id", videoId).order("at").limit(30),
    sb.from("yt_videos").select("topic,gap_known,gap_want").eq("id", videoId).maybeSingle(),
  ]);
  const intro = secs.find((s) => s.kind === "intro");
  const body = secs
    .filter((s) => s.kind !== "intro")
    .map((s) => `- ${s.title}${s.is_climax ? " (CLIMAX)" : ""}: ${s.description ?? ""}\n  ${scriptPlainText(s.content).replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n");
  const prompt = [
    `Video: ${v.idea_name}${v.kind === "short" ? " (YouTube Short)" : ""}`,
    title ? `Title on the thumbnail pair: ${title}` : "No title chosen yet.",
    vfull?.topic ? `Topic: ${String(vfull.topic).slice(0, 600)}` : "",
    vfull?.gap_known || vfull?.gap_want ? `Curiosity gap — viewer knows: ${vfull?.gap_known ?? ""} / wants to know: ${vfull?.gap_want ?? ""}` : "",
    `Current intro:\n${intro ? scriptPlainText(intro.content).slice(0, 1500) || "(empty)" : "(none)"}`,
    `Outline and script:\n${body}`,
    (moments ?? []).length ? `Moments logged while filming:\n${(moments ?? []).map((m) => `- [${m.kind}] ${m.text}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, AI_PROMPT_MAX - 1500);
  const system =
    'You help a YouTuber write a killer intro (Aprilynne Alter): the first sentence must deliver on the title (share its key words, not word for word); then exceed expectations with an open loop (a question the climax answers), context, and input bias (time, energy, money spent). Write in English, spoken style, short sentences. Answer ONLY JSON: {"first_lines":[3 strings],"open_loops":[{"text":string,"closes":"title of the part that answers it"} x3],"input_bias":[up to 3 strings, from the moments when possible],"context":"one or two sentences"}';
  let usage: string | null = null;
  const out = await withAiUsage(
    "youtube-intro",
    async () => {
      const o = await aiChat(system, [{ text: prompt }], { kind: "write", json: true, temperature: 0.8, maxTokens: 1200, timeoutMs: 40000 });
      const { timezone } = await getSettings(sb);
      usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb, userId },
  );
  if (!("text" in out)) return { error: out.error, usage };
  try {
    const j = JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const strs = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 4) : []);
    const loops = Array.isArray(j.open_loops)
      ? (j.open_loops as unknown[])
          .map((l) => (typeof l === "string" ? { text: l } : { text: String((l as { text?: unknown })?.text ?? ""), closes: String((l as { closes?: unknown })?.closes ?? "") || undefined }))
          .filter((l) => l.text.trim())
          .slice(0, 4)
      : [];
    return { ideas: { first_lines: strs(j.first_lines), open_loops: loops, input_bias: strs(j.input_bias), context: typeof j.context === "string" ? j.context : undefined }, usage };
  } catch {
    return { error: "The AI answered in a strange way. Try again.", usage };
  }
}
