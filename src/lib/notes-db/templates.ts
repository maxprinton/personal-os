// Templates (server only): the starter templates, creating a note from a template (variables, values,
// tags, icon / cover, sub-pages, its series ← · →), "by Type", the schedules run by the 5-minute cron
// (with "delete the previous one if unused" and the Telegram notice). Works with the signed-in client
// (RLS) and with the admin client: every query filters by user_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { noteAsPlainText } from "@/lib/block-notes";
import { botToken } from "@/lib/telegram";
import { remember, send } from "@/lib/bot/tg";
import { cleanSchedule, dueKey, expandVars, isUntouched, localDateAt, localTimeAt, madeHash, nextRun, remapNoteLinks } from "@/lib/notes-db/tpl-core";
import { STARTERS } from "@/lib/notes-db/tpl-starters";
import type { NoteProperty, PropValue, Schedule, TemplateConfig } from "@/lib/notes-db/types";

type Page = Record<string, unknown> & { icon?: string | null; cover?: string | null };
type NoteRow = {
  id: string;
  user_id?: string;
  title: string;
  content: string;
  page: Page | null;
  props: Record<string, PropValue> | null;
  parent_id: string | null;
  is_template: boolean;
  template: (TemplateConfig & { made?: { hash: string; at: string } }) | null;
  template_id?: string | null;
  series_key?: string | null;
  block_name?: string | null;
  created_at?: string;
  updated_at?: string;
};
const COLS = "id,title,content,page,props,parent_id,is_template,template,template_id,series_key,block_name,created_at,updated_at";

export type MadeNote = { id: string; title: string; created: boolean };

/** The web address of the app (for the Telegram button). */
export function appUrl() {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (env) return env.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://personal-os-eosin-mu.vercel.app";
}

/** No text yet (a sub-page, an image… count as content). */
export function isEmptyContent(md: string | null | undefined) {
  const s = (md ?? "").trim();
  if (!s) return true;
  if (/<(page|image|video|audio|file|pdf|embed|bookmark|columns|table)\b/i.test(s) || /^\s*\|/m.test(s) || /!\[/.test(s)) return false;
  return !noteAsPlainText(s).replace(/[☐☑•▸\s-]/g, "").trim();
}

async function userSettings(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("user_settings").select("timezone,telegram_chat_id").eq("user_id", userId).maybeSingle();
  const d = data as { timezone?: string | null; telegram_chat_id?: number | string | null } | null;
  return { timezone: d?.timezone || "America/Guayaquil", chatId: d?.telegram_chat_id ? Number(d.telegram_chat_id) : null };
}

/** A copy of the page settings (icon, cover, font…), never "locked". */
function copyPage(p: Page | null | undefined): Page {
  const out: Page = { ...(p ?? {}) };
  delete out.locked;
  return out;
}

async function aiSummaryIds(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("note_properties").select("id").eq("user_id", userId).eq("type", "ai_summary").is("deleted_at", null);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

function copyProps(p: Record<string, PropValue> | null | undefined, skip: Set<string>) {
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (!skip.has(k) && v !== null && v !== undefined) out[k] = v;
  return out;
}

/** Every sub-page under a note (breadth first, parents before children). */
async function descendants(sb: SupabaseClient, userId: string, rootId: string) {
  const out: NoteRow[] = [];
  const seen = new Set([rootId]);
  let level = [rootId];
  for (let depth = 0; level.length && depth < 12 && out.length < 300; depth++) {
    const { data } = await sb.from("notes").select(COLS).eq("user_id", userId).in("parent_id", level).is("deleted_at", null).order("created_at");
    const rows = ((data ?? []) as NoteRow[]).filter((r) => !seen.has(r.id) && !r.block_name);
    rows.forEach((r) => seen.add(r.id));
    out.push(...rows);
    level = rows.map((r) => r.id);
  }
  return out.slice(0, 300);
}

/** Copies the tags and the "Linked to" links (tasks, events, notes) from each old note to its copy. */
async function copyTagsAndLinks(sb: SupabaseClient, userId: string, map: Map<string, string>) {
  const from = [...map.keys()];
  if (!from.length) return;
  const [{ data: tags }, { data: have }, { data: rels }] = await Promise.all([
    sb.from("entity_tags").select("entity_id,tag_id,tags(deleted_at)").eq("user_id", userId).eq("entity_type", "note").in("entity_id", from).is("deleted_at", null),
    sb.from("entity_tags").select("entity_id,tag_id").eq("user_id", userId).eq("entity_type", "note").in("entity_id", [...map.values()]).is("deleted_at", null),
    sb.from("entity_relations").select("source_id,target_type,target_id,relationship_type").eq("user_id", userId).eq("source_type", "note").in("source_id", from).is("deleted_at", null),
  ]);
  type T = { entity_id: string; tag_id: string; tags?: { deleted_at: string | null } | { deleted_at: string | null }[] | null };
  const already = new Set(((have ?? []) as T[]).map((t) => `${t.entity_id}:${t.tag_id}`));
  const tagRows = ((tags ?? []) as T[])
    .filter((t) => {
      const j = Array.isArray(t.tags) ? t.tags[0] : t.tags;
      return !j?.deleted_at;
    })
    .map((t) => ({ user_id: userId, tag_id: t.tag_id, entity_type: "note", entity_id: map.get(t.entity_id.toLowerCase())! }))
    .filter((t) => t.entity_id && !already.has(`${t.entity_id}:${t.tag_id}`));
  const uniq = [...new Map(tagRows.map((t) => [`${t.entity_id}:${t.tag_id}`, t])).values()];
  if (uniq.length) {
    const { error } = await sb.from("entity_tags").insert(uniq);
    if (error) console.error("template tags", error.message);
  }
  type R = { source_id: string; target_type: string; target_id: string; relationship_type: string };
  const relRows = ((rels ?? []) as R[])
    .map((r) => ({
      user_id: userId,
      source_type: "note",
      source_id: map.get(r.source_id.toLowerCase())!,
      target_type: r.target_type,
      target_id: r.target_type === "note" ? (map.get(r.target_id.toLowerCase()) ?? r.target_id) : r.target_id,
      relationship_type: r.relationship_type,
    }))
    .filter((r) => r.source_id && !(r.target_type === "note" && r.target_id === r.source_id));
  if (relRows.length) {
    const { error } = await sb.from("entity_relations").insert(relRows);
    if (error) console.error("template links", error.message);
  }
}

/** Inserts the copies of the sub-pages, level by level (parents first). */
async function insertCopies(sb: SupabaseClient, rows: Record<string, unknown>[]) {
  const done = new Set<string>();
  let rest = rows;
  for (let guard = 0; rest.length && guard < 14; guard++) {
    const ready = rest.filter((r) => !rows.some((o) => o.id === r.parent_id && !done.has(o.id as string)));
    if (!ready.length) break;
    const { error } = await sb.from("notes").insert(ready);
    if (error) throw new Error(error.message);
    ready.forEach((r) => done.add(r.id as string));
    rest = rest.filter((r) => !done.has(r.id as string));
  }
}

export type MakeOpts = {
  /** Scheduled: the date it belongs to (YYYY-MM-DD); manual: null. */
  seriesKey?: string | null;
  /** The date / time the variables use (default: now, in the user's timezone). */
  date?: string;
  time?: string;
  /** Extra values (win over the template's). */
  values?: Record<string, PropValue>;
  parentId?: string | null;
  /** Fill this existing (empty) note instead of creating a new one. */
  intoNoteId?: string;
};

/**
 * Creates a note from a template: title and text with variables, its values, tags, links, icon / cover,
 * and its sub-pages (copied as normal sub-pages of the new note). With a seriesKey that already exists,
 * returns the existing note (never two for the same date).
 */
export async function makeFromTemplate(sb: SupabaseClient, userId: string, templateId: string, opts: MakeOpts = {}): Promise<MadeNote> {
  const { data: tplData, error: tErr } = await sb.from("notes").select(COLS).eq("id", templateId).eq("user_id", userId).eq("is_template", true).is("deleted_at", null).maybeSingle();
  if (tErr) throw new Error(tErr.message);
  const tpl = tplData as NoteRow | null;
  if (!tpl) throw new Error("That template no longer exists.");

  if (opts.seriesKey) {
    const existing = await seriesNote(sb, userId, templateId, opts.seriesKey);
    if (existing) return { ...existing, created: false };
  }

  let date = opts.date;
  let time = opts.time;
  if (!date || !time) {
    const { timezone } = await userSettings(sb, userId);
    const now = new Date();
    date ??= localDateAt(now, timezone);
    time ??= localTimeAt(now, timezone);
  }
  const ex = (s: string) => expandVars(s ?? "", date!, time!);
  const skip = await aiSummaryIds(sb, userId);

  // The existing note to fill (manual "Start with a template" / by Type)
  let into: NoteRow | null = null;
  if (opts.intoNoteId) {
    const { data } = await sb.from("notes").select(COLS).eq("id", opts.intoNoteId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    into = data as NoteRow | null;
    if (!into) throw new Error("Note not found.");
  }

  // Ids of the copies first, so links between the pages can point to the copies
  const subs = await descendants(sb, userId, templateId);
  const rootId = into?.id ?? crypto.randomUUID();
  const map = new Map<string, string>([[templateId.toLowerCase(), rootId]]);
  for (const s of subs) map.set(s.id.toLowerCase(), crypto.randomUUID());

  const tplTitle = ex(tpl.title ?? "").slice(0, 500);
  const keepTitle = into && into.title && into.title.trim() && into.title.trim() !== "Untitled";
  const title = keepTitle ? into!.title : tplTitle.trim() ? tplTitle : "Untitled";
  const content = remapNoteLinks(ex(tpl.content ?? ""), map);
  const props = { ...copyProps(tpl.props, skip), ...copyProps(into?.props, skip), ...copyProps(opts.values, skip) };
  const page = into ? { ...copyPage(tpl.page), ...Object.fromEntries(Object.entries(into.page ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "")) } : copyPage(tpl.page);
  const made = { hash: madeHash({ title, content, props }), at: new Date().toISOString() };

  if (into) {
    const { error } = await sb
      .from("notes")
      .update({ title, content, props, page, template_id: templateId, template: { ...(into.template ?? {}), made } })
      .eq("id", into.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("notes").insert({
      id: rootId,
      user_id: userId,
      title,
      content,
      props,
      page,
      parent_id: opts.parentId ?? null,
      is_template: false,
      template: { made },
      template_id: templateId,
      series_key: opts.seriesKey ?? null,
    });
    if (error) {
      // Two runs at once: the other one made it (unique template + date)
      if (error.code === "23505" && opts.seriesKey) {
        const existing = await seriesNote(sb, userId, templateId, opts.seriesKey);
        if (existing) return { ...existing, created: false };
      }
      throw new Error(error.message);
    }
  }

  if (subs.length) {
    await insertCopies(
      sb,
      subs.map((s) => ({
        id: map.get(s.id.toLowerCase()),
        user_id: userId,
        title: ex(s.title ?? "").trim() || "Untitled",
        content: remapNoteLinks(ex(s.content ?? ""), map),
        props: copyProps(s.props, skip),
        page: copyPage(s.page),
        parent_id: map.get((s.parent_id ?? templateId).toLowerCase()) ?? rootId,
        is_template: false,
        template: {},
      })),
    ).catch((e) => console.error("template sub-pages", e));
  }
  await copyTagsAndLinks(sb, userId, map).catch((e) => console.error("template tags", e));
  return { id: rootId, title, created: true };
}

async function seriesNote(sb: SupabaseClient, userId: string, templateId: string, key: string) {
  const { data } = await sb.from("notes").select("id,title").eq("user_id", userId).eq("template_id", templateId).eq("series_key", key).is("deleted_at", null).maybeSingle();
  return (data as { id: string; title: string } | null) ?? null;
}

/** Copies a template (with its sub-pages, as template sub-pages). The copy's schedule starts paused. */
export async function duplicateTemplateTree(sb: SupabaseClient, userId: string, templateId: string): Promise<string> {
  const { data } = await sb.from("notes").select(COLS).eq("id", templateId).eq("user_id", userId).eq("is_template", true).is("deleted_at", null).maybeSingle();
  const tpl = data as NoteRow | null;
  if (!tpl) throw new Error("That template no longer exists.");
  const subs = await descendants(sb, userId, templateId);
  const rootId = crypto.randomUUID();
  const map = new Map<string, string>([[templateId.toLowerCase(), rootId]]);
  for (const s of subs) map.set(s.id.toLowerCase(), crypto.randomUUID());
  const cfg: TemplateConfig = { ...(tpl.template ?? {}) };
  delete cfg.isDefault;
  delete cfg.forType;
  delete cfg.lastKey;
  delete cfg.starter;
  if (cfg.schedule) cfg.schedule = { ...cfg.schedule, paused: true };
  const { error } = await sb.from("notes").insert({
    id: rootId,
    user_id: userId,
    title: `${(tpl.title ?? "").trim() || "Untitled"} (copy)`.slice(0, 500),
    content: remapNoteLinks(tpl.content ?? "", map),
    props: tpl.props ?? {},
    page: copyPage(tpl.page),
    is_template: true,
    template: cfg,
  });
  if (error) throw new Error(error.message);
  await insertCopies(
    sb,
    subs.map((s) => ({
      id: map.get(s.id.toLowerCase()),
      user_id: userId,
      title: s.title || "Untitled",
      content: remapNoteLinks(s.content ?? "", map),
      props: s.props ?? {},
      page: copyPage(s.page),
      parent_id: map.get((s.parent_id ?? templateId).toLowerCase()) ?? rootId,
      is_template: true,
      template: { child: true },
    })),
  );
  await copyTagsAndLinks(sb, userId, map).catch((e) => console.error("template tags", e));
  return rootId;
}

/** Soft-deletes notes and everything under them (sub-pages, tags, links). */
export async function softDeleteTree(sb: SupabaseClient, userId: string, ids: string[]) {
  const all = [...ids];
  for (const id of ids) all.push(...(await descendants(sb, userId, id)).map((r) => r.id));
  const now = new Date().toISOString();
  await sb.from("entity_relations").update({ deleted_at: now }).eq("user_id", userId).eq("source_type", "note").in("source_id", all);
  await sb.from("entity_tags").update({ deleted_at: now }).eq("user_id", userId).eq("entity_type", "note").in("entity_id", all);
  const { error } = await sb.from("notes").update({ deleted_at: now }).eq("user_id", userId).in("id", all);
  if (error) throw new Error(error.message);
  return all.length;
}

// ---- Starter templates + template sub-pages ---------------------------------------------------

/**
 * Called on every database load: the first time (no template ever existed, deleted ones count too),
 * creates the 4 starter templates (Diario, Revisión semanal, Reunión, Aprendizaje). Also makes the
 * pages created inside a template ("/page") part of it (is_template + {child:true}). Cheap when done.
 */
export async function ensureStarterTemplates(sb: SupabaseClient, userId: string, properties: NoteProperty[]): Promise<void> {
  const { data, error } = await sb.from("notes").select("id,deleted_at").eq("user_id", userId).eq("is_template", true).limit(1000);
  if (error) return; // migration 0021 not run yet
  const rows = (data ?? []) as { id: string; deleted_at: string | null }[];
  if (!rows.length) {
    await seedStarters(sb, userId, properties);
    return;
  }
  // Sub-pages made inside a template → part of the template (not listed with the notes)
  let level = rows.filter((r) => !r.deleted_at).map((r) => r.id);
  for (let depth = 0; level.length && depth < 6; depth++) {
    const { data: kids } = await sb.from("notes").select("id").eq("user_id", userId).in("parent_id", level.slice(0, 300)).eq("is_template", false).is("deleted_at", null).is("block_name", null);
    const ids = ((kids ?? []) as { id: string }[]).map((k) => k.id);
    if (!ids.length) break;
    await sb.from("notes").update({ is_template: true, template: { child: true } }).eq("user_id", userId).in("id", ids);
    level = ids;
  }
}

async function seedStarters(sb: SupabaseClient, userId: string, properties: NoteProperty[]) {
  const typeProp = properties.find((p) => p.builtin && p.key === "type");
  const areaProp = properties.find((p) => p.builtin && p.key === "area");
  const has = (p: NoteProperty | undefined, opt?: string) => !!p && !!opt && (p.config.options ?? []).some((o) => o.id === opt);
  const rows = STARTERS.map((s) => {
    const props: Record<string, PropValue> = {};
    if (has(typeProp, s.typeOption)) props[typeProp!.id] = s.typeOption;
    if (has(areaProp, s.areaOption)) props[areaProp!.id] = s.areaOption!;
    const template: TemplateConfig = { starter: s.starter };
    if (s.forType && has(typeProp, s.typeOption)) template.forType = s.typeOption;
    return { user_id: userId, title: s.title, content: s.content, page: { icon: s.icon }, props, is_template: true, template };
  });
  const { error } = await sb.from("notes").insert(rows);
  if (error) throw new Error(error.message);
  // Two loads at the same moment could both seed: keep the first of each, the same one for both
  const { data } = await sb.from("notes").select("id,created_at,template").eq("user_id", userId).eq("is_template", true).is("deleted_at", null).order("created_at").order("id");
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const r of (data ?? []) as { id: string; template: TemplateConfig | null }[]) {
    const k = r.template?.starter;
    if (!k) continue;
    if (seen.has(k)) extra.push(r.id);
    else seen.add(k);
  }
  if (extra.length) await sb.from("notes").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId).in("id", extra);
}

// ---- By Type ---------------------------------------------------------------------------------

/**
 * Called after the built-in "Type" of a note changes. If the note is still empty (no text) and a
 * template has config.forType === optionId, the note gets that template (content, values, sub-pages).
 * Returns true when it applied one.
 */
export async function applyTypeTemplate(sb: SupabaseClient, userId: string, noteId: string, optionId: string | null): Promise<boolean> {
  if (!optionId) return false;
  const { data } = await sb.from("notes").select("id,content,is_template,block_name").eq("id", noteId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  const note = data as { id: string; content: string; is_template: boolean; block_name: string | null } | null;
  if (!note || note.is_template || note.block_name || !isEmptyContent(note.content)) return false;
  const { data: tpls } = await sb.from("notes").select("id,template").eq("user_id", userId).eq("is_template", true).is("deleted_at", null).eq("template->>forType", optionId).order("created_at").limit(5);
  const tpl = ((tpls ?? []) as { id: string; template: TemplateConfig | null }[]).find((t) => !t.template?.child);
  if (!tpl) return false;
  await makeFromTemplate(sb, userId, tpl.id, { intoNoteId: noteId });
  return true;
}

// ---- Schedules -------------------------------------------------------------------------------

/** The previous note of the series, deleted if it was left exactly as the template made it. */
async function deletePreviousIfUnused(sb: SupabaseClient, userId: string, templateId: string, key: string, newId: string) {
  const { data } = await sb
    .from("notes")
    .select(COLS)
    .eq("user_id", userId)
    .eq("template_id", templateId)
    .is("deleted_at", null)
    .not("series_key", "is", null)
    .lt("series_key", key)
    .neq("id", newId)
    .order("series_key", { ascending: false })
    .limit(1);
  const prev = ((data ?? []) as NoteRow[])[0];
  if (!prev || !isUntouched(prev)) return false;
  // A sub-page edited, or a page added inside it, also counts as used
  const madeAt = Date.parse(prev.template?.made?.at ?? prev.created_at ?? "") || 0;
  const subs = await descendants(sb, userId, prev.id);
  if (subs.some((s) => Date.parse(s.updated_at ?? "") > madeAt + 120_000 || Date.parse(s.created_at ?? "") > madeAt + 120_000)) return false;
  // Linked from another note → used
  const { count } = await sb.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null).neq("id", prev.id).ilike("content", `%/notes/${prev.id}%`);
  if (count) return false;
  await softDeleteTree(sb, userId, [prev.id]);
  return true;
}

/** Telegram: "📝 <title> is ready" + a button to the note; a reply to it is added to the note. */
export async function notifyNoteReady(sb: SupabaseClient, userId: string, chatId: number, note: { id: string; title: string }) {
  if (!botToken() || !chatId) return false;
  const url = `${appUrl()}/notes/${note.id}`;
  const msgId = await send(chatId, `📝 ${note.title.trim() || "Your note"} is ready\n\nReply to this message to add to the note.`, null, {
    reply_markup: { inline_keyboard: [[{ text: "📝 Open note", url }]] },
  });
  if (msgId) await remember(sb, userId, chatId, msgId, "note_append", { noteId: note.id });
  return !!msgId;
}

/** Saves the last date made (never goes back). Re-reads the settings so a change made meanwhile is kept. */
async function saveLastKey(sb: SupabaseClient, userId: string, templateId: string, key: string) {
  const { data } = await sb.from("notes").select("template").eq("id", templateId).eq("user_id", userId).maybeSingle();
  const cfg = ((data as { template?: TemplateConfig | null } | null)?.template ?? {}) as TemplateConfig;
  if (cfg.lastKey && cfg.lastKey >= key) return;
  await sb.from("notes").update({ template: { ...cfg, lastKey: key } }).eq("id", templateId).eq("user_id", userId);
}

/** Makes the note of one date of a schedule (+ skip unused + Telegram). */
export async function makeScheduled(
  sb: SupabaseClient,
  userId: string,
  templateId: string,
  schedule: Schedule,
  key: string,
  chatId: number | null,
): Promise<MadeNote> {
  const made = await makeFromTemplate(sb, userId, templateId, { seriesKey: key, date: key, time: schedule.time });
  await saveLastKey(sb, userId, templateId, key);
  if (made.created) {
    if (schedule.skipUnused) await deletePreviousIfUnused(sb, userId, templateId, key, made.id).catch((e) => console.error("skip unused", e));
    if (schedule.notify && chatId) await notifyNoteReady(sb, userId, chatId, made).catch((e) => console.error("template notice", e));
  }
  return made;
}

/** "Create one now": the note of the next date of the schedule (the "Next: …" shown), made right away. */
export async function makeNextScheduledNow(sb: SupabaseClient, userId: string, templateId: string): Promise<MadeNote> {
  const { data } = await sb.from("notes").select("template").eq("id", templateId).eq("user_id", userId).eq("is_template", true).is("deleted_at", null).maybeSingle();
  const cfg = ((data as { template?: TemplateConfig | null } | null)?.template ?? null) as TemplateConfig | null;
  if (!cfg) throw new Error("That template no longer exists.");
  const s = cleanSchedule(cfg.schedule);
  if (!s) return makeFromTemplate(sb, userId, templateId);
  const active = { ...s, paused: false };
  const { timezone, chatId } = await userSettings(sb, userId);
  const now = new Date();
  let key = nextRun(active, timezone, now, cfg.lastKey ?? null)?.key ?? null;
  for (let i = 0; key && i < 12; i++) {
    if (!(await seriesNote(sb, userId, templateId, key))) break;
    key = nextRun(active, timezone, now, key)?.key ?? null;
  }
  if (!key) return makeFromTemplate(sb, userId, templateId); // the schedule ended: a manual one
  return makeScheduled(sb, userId, templateId, s, key, chatId);
}

/** Called by the 5-minute cron (admin client): creates the scheduled notes that are due. Returns how many. */
export async function runTemplateSchedules(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.from("notes").select("id,user_id,template").eq("is_template", true).is("deleted_at", null).limit(5000);
  if (error) {
    console.error("note templates", error.message);
    return 0;
  }
  const tpls = ((data ?? []) as { id: string; user_id: string; template: TemplateConfig | null }[]).filter((t) => !t.template?.child && t.template?.schedule && !t.template.schedule.paused);
  if (!tpls.length) return 0;
  const users = [...new Set(tpls.map((t) => t.user_id))];
  const { data: settings } = await admin.from("user_settings").select("user_id,timezone,telegram_chat_id").in("user_id", users);
  const byUser = new Map(((settings ?? []) as { user_id: string; timezone: string | null; telegram_chat_id: number | string | null }[]).map((s) => [s.user_id, s]));
  const now = new Date();
  let made = 0;
  for (const t of tpls) {
    try {
      const s = cleanSchedule(t.template!.schedule);
      const st = byUser.get(t.user_id);
      const tz = st?.timezone || "America/Guayaquil";
      const key = dueKey(s, tz, now, t.template!.lastKey ?? null);
      if (!s || !key) continue;
      const r = await makeScheduled(admin, t.user_id, t.id, s, key, st?.telegram_chat_id ? Number(st.telegram_chat_id) : null);
      if (r.created) made++;
    } catch (e) {
      console.error("note template", t.id, e);
    }
  }
  return made;
}
