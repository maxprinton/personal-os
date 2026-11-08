"use server";
// Portfolio add-on, Phase 8 — ✨ translate a page into the other language.
// Step 1 (preview): the AI translates; NOTHING is saved. Step 2 (accept): the translation becomes a new, linked draft note
// in the other language. Discarding is just closing the preview. It never touches a note that already exists.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiChat, hasAi } from "@/lib/ai";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { BASE } from "@/lib/portfolio/constants";
import { createLinkedNote, loadSlotViews } from "@/lib/portfolio/link";
import { isLang } from "@/lib/portfolio/slots";
import { MAX_CHARS, otherLang, translatePage, type Ask } from "@/lib/portfolio/translate";

export type TranslatePreview = { ok: true; title: string; content: string; parts: number; usage: string | null } | { ok?: false; error: string };

async function who() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}

const BUDGET_MS = 50_000;

export async function previewTranslationAction(slotId: string, from: string): Promise<TranslatePreview> {
  try {
    const { sb, userId } = await who();
    if (!isLang(from)) return { error: "Unknown language." };
    const to = otherLang(from);
    if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
    const { slots } = await loadSlotViews(sb, userId, { includeArchived: true });
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return { error: "This page no longer exists." };
    const src = slot.pages[from].note;
    if (!src || src.deleted_at) return { error: "There is no note to translate in this language." };
    if (slot.pages[to].note) return { error: `The ${to.toUpperCase()} side already has a note. Unlink it first if you want a fresh translation (it stays in Notes).` };
    const { data: row, error } = await sb.from("notes").select("title,content").eq("id", src.id).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (error) return { error: error.message };
    if (!row) return { error: "The note was not found." };

    const started = Date.now();
    let usage: string | null = null;
    const result = await withAiUsage(
      "portfolio-translate",
      async () => {
        const ask: Ask = async (system, user) => {
          if (Date.now() - started > BUDGET_MS) return { error: "This is taking too long. Try again, or translate the page in parts." };
          return aiChat(system, [{ text: user }], { kind: "write", temperature: 0.2, maxTokens: 3000, timeoutMs: 25_000 });
        };
        const r = await translatePage({ title: (row.title as string | null) ?? "", content: (row.content as string | null) ?? "", from, to }, ask);
        const { timezone } = await getSettings(sb);
        usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
        return r;
      },
      { sb, userId },
    );
    if (!result.ok) return { error: result.error };
    return { ok: true, title: result.title, content: result.content, parts: result.parts, usage };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not translate the page." };
  }
}

export async function acceptTranslationAction(slotId: string, to: string, title: string, content: string): Promise<{ ok: true; noteId: string } | { ok?: false; error: string }> {
  try {
    const { sb, userId } = await who();
    if (!isLang(to)) return { error: "Unknown language." };
    if (typeof content !== "string" || content.length > MAX_CHARS * 3) return { error: "The translation is too long to save." };
    const r = await createLinkedNote(sb, userId, { slotId, lang: to, title: String(title ?? "").trim().slice(0, 200) || undefined, content });
    if (!r.ok) return { error: r.error };
    revalidatePath(BASE);
    revalidatePath(`${BASE}/pages`);
    revalidatePath(`${BASE}/pages/${slotId}`);
    return { ok: true, noteId: r.noteId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the translation." };
  }
}
