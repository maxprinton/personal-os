"use server";
// Portfolio add-on — server actions. Every action checks the signed-in user and returns a short message on failure.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { indexSoon } from "@/lib/search/server";
import type { ActionState } from "@/app/actions";
import { BASE } from "@/lib/portfolio/constants";
import { createLinkedNote, createSlot, deleteSlot, linkNote, loadSlotViews, portfolioLinkOfNote, unlinkNote, updateSlot } from "@/lib/portfolio/link";
import { parseLangs, parseLinks, parseMeta, parseWords } from "@/lib/portfolio/forms";
import { isKind, isLang, KIND_LABEL, slugProblem } from "@/lib/portfolio/slots";
import { loadSite, saveSite, type SiteSettings } from "@/lib/portfolio/site";

async function who() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}
const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const done = (): ActionState => ({ ok: true, at: Date.now() });
const refresh = (slotId?: string) => {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/pages`);
  if (slotId) revalidatePath(`${BASE}/pages/${slotId}`);
};
const msg = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : "Something went wrong." });

export async function createSlotAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { sb, userId } = await who();
    const kind = s(f, "kind");
    if (!isKind(kind)) return { error: "Pick a kind." };
    const r = await createSlot(sb, userId, { kind, name: s(f, "name") });
    if (!r.ok) return { error: r.error };
    id = r.id;
  } catch (e) {
    return msg(e);
  }
  refresh();
  redirect(`${BASE}/pages/${id}`);
}

export async function saveSlotAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { sb, userId } = await who();
    const id = s(f, "id");
    const metaR = parseMeta((k) => s(f, k));
    if ("error" in metaR) return { error: metaR.error };
    const langs = parseLangs((k) => s(f, k));
    for (const lang of ["en", "es"] as const) {
      const slug = langs[lang]?.slug;
      const p = slug ? slugProblem(slug) : null;
      if (p) return { error: `${lang.toUpperCase()}: ${p}` };
    }
    const key = s(f, "key");
    const r = await updateSlot(sb, userId, id, { ...(key ? { key } : {}), meta: metaR.meta, langs });
    if (!r.ok) return { error: r.error };
    refresh(id);
    return done();
  } catch (e) {
    return msg(e);
  }
}

/** Feature / archive toggles. */
export async function slotFlagAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { sb, userId } = await who();
    const id = s(f, "id");
    const field = s(f, "field");
    if (field !== "featured" && field !== "archived") return { error: "Unknown option." };
    const r = await updateSlot(sb, userId, id, { [field]: s(f, "value") === "true" });
    if (!r.ok) return { error: r.error };
    refresh(id);
    return done();
  } catch (e) {
    return msg(e);
  }
}

export async function deleteSlotAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { sb, userId } = await who();
    const r = await deleteSlot(sb, userId, s(f, "id"));
    if (!r.ok) return { error: r.error };
  } catch (e) {
    return msg(e);
  }
  refresh();
  redirect(`${BASE}/pages`);
}

export async function linkNoteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { sb, userId } = await who();
    const lang = s(f, "lang");
    if (!isLang(lang)) return { error: "Unknown language." };
    const noteId = s(f, "noteId");
    if (!noteId) return { error: "Pick a note." };
    const r = await linkNote(sb, userId, { slotId: s(f, "slotId"), lang, noteId, replace: s(f, "replace") === "on" });
    if (!r.ok) return { error: r.error };
    refresh(s(f, "slotId"));
    return done();
  } catch (e) {
    return msg(e);
  }
}

/** Creates an empty note linked to the slot and opens it in the editor. */
export async function newNoteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let noteId: string;
  try {
    const { sb, userId } = await who();
    const lang = s(f, "lang");
    if (!isLang(lang)) return { error: "Unknown language." };
    const r = await createLinkedNote(sb, userId, { slotId: s(f, "slotId"), lang });
    if (!r.ok) return { error: r.error };
    noteId = r.noteId;
    after(() => indexSoon(userId, noteId));
  } catch (e) {
    return msg(e);
  }
  refresh(s(f, "slotId"));
  redirect(`/notes/${noteId}`);
}

export async function unlinkNoteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { sb, userId } = await who();
    const lang = s(f, "lang");
    if (!isLang(lang)) return { error: "Unknown language." };
    const r = await unlinkNote(sb, userId, { slotId: s(f, "slotId"), lang });
    if (!r.ok) return { error: r.error };
    refresh(s(f, "slotId"));
    return done();
  } catch (e) {
    return msg(e);
  }
}

export async function saveSiteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { sb, userId } = await who();
    const name = s(f, "name").trim();
    if (!name) return { error: "Write the name that appears on the site." };
    const langs = (["en", "es"] as const).filter((l) => s(f, `lang_${l}`) === "on");
    if (!langs.length) return { error: "Keep at least one language on." };
    const def = s(f, "default_lang");
    const default_lang = (isLang(def) && langs.includes(def) ? def : langs[0]) as "en" | "es";
    const { site: prev } = await loadSite(sb, userId);
    const site: SiteSettings = {
      ...prev,
      name: name.slice(0, 80),
      tagline: { en: s(f, "tagline_en").trim().slice(0, 160), es: s(f, "tagline_es").trim().slice(0, 160) },
      links: parseLinks(s(f, "links")),
      langs: [...langs],
      default_lang,
      contact_enabled: s(f, "contact_enabled") === "on",
      analytics_enabled: s(f, "analytics_enabled") === "on",
      blocked_words: parseWords(s(f, "blocked_words")),
    };
    const err = await saveSite(sb, userId, site);
    if (err) return { error: err };
    revalidatePath(`${BASE}/settings`);
    return done();
  } catch (e) {
    return msg(e);
  }
}

// ——— From a note's Kind menu: link this note to a portfolio page ———
export type SlotChoice = { id: string; label: string; kind: string; taken: { en: boolean; es: boolean } };
export type PortfolioLinkInfo = { slots: SlotChoice[]; current: { slotId: string; lang: "en" | "es"; label: string } | null };

export async function portfolioChoicesForNote(noteId: string): Promise<({ ok: true } & PortfolioLinkInfo) | { ok: false; error: string }> {
  try {
    const { sb, userId } = await who();
    const [{ slots }, link] = await Promise.all([loadSlotViews(sb, userId), portfolioLinkOfNote(sb, userId, noteId)]);
    const label = (s: { kind: string; key: string }) => (s.kind === s.key ? KIND_LABEL[s.kind as keyof typeof KIND_LABEL] : s.key);
    return {
      ok: true,
      slots: slots.map((s) => ({ id: s.id, label: label(s), kind: KIND_LABEL[s.kind], taken: { en: !!s.pages.en.note, es: !!s.pages.es.note } })),
      current: link ? { slotId: link.slotId, lang: link.lang, label: label(link) } : null,
    };
  } catch (e) {
    return { ok: false, error: msg(e).error ?? "Something went wrong." };
  }
}

export async function linkNoteToPortfolio(input: { noteId: string; slotId: string; lang: string; replace: boolean }): Promise<{ ok: true; notice: string } | { ok: false; error: string }> {
  try {
    if (!isLang(input.lang)) return { ok: false, error: "Pick a language." };
    const { sb, userId } = await who();
    const r = await linkNote(sb, userId, { slotId: input.slotId, lang: input.lang, noteId: input.noteId, replace: input.replace });
    if (!r.ok) return { ok: false, error: r.error };
    refresh(input.slotId);
    return { ok: true, notice: r.released ? "Linked. The previous note was kept in Notes as “Former · …”." : "Linked to the portfolio page." };
  } catch (e) {
    return { ok: false, error: msg(e).error ?? "Something went wrong." };
  }
}

export async function unlinkNoteFromPortfolio(slotId: string, lang: string): Promise<{ ok: true; notice: string } | { ok: false; error: string }> {
  try {
    if (!isLang(lang)) return { ok: false, error: "Pick a language." };
    const { sb, userId } = await who();
    const r = await unlinkNote(sb, userId, { slotId, lang });
    if (!r.ok) return { ok: false, error: r.error };
    refresh(slotId);
    return { ok: true, notice: "Unlinked. The live page does not change." };
  } catch (e) {
    return { ok: false, error: msg(e).error ?? "Something went wrong." };
  }
}
