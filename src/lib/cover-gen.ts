// Server side of ✨ AI covers: read the note → Groq plans the picture → Cloudflare draws it → saved in the note-files bucket.
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, hasAi } from "@/lib/ai";
import { noteAsPlainText } from "@/lib/block-notes";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { COVER_SYSTEM, buildImagePrompt, coverInput, isReplaceableCover, parseCoverPlan } from "@/lib/cover-art";
import { generateImage, hasImageAi } from "@/lib/cloudflare-image";

export type CoverResult =
  | { ok: true; url: string; scene: string; about: string; usage: string | null; saved: boolean }
  | { ok?: false; error: string; skipped?: boolean; quota?: boolean };

export async function makeCover(sb: SupabaseClient, userId: string, noteId: string, opts: { idea?: string; save?: boolean; force?: boolean } = {}): Promise<CoverResult> {
  if (!noteId) return { error: "Missing note." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  if (!hasImageAi()) return { error: "Pictures aren't connected: add CF_ACCOUNT_ID and CF_API_TOKEN in Vercel (see ACTIVAR-PORTADAS-IA.md)." };

  const { data: note, error } = await sb.from("notes").select("id,title,content,block_name,page").eq("id", noteId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  if (error) return { error: error.message };
  if (!note) return { error: "Note not found." };
  const page = ((note.page as Record<string, unknown> | null) ?? {}) as { cover?: string | null };
  if (opts.save && !opts.force && !isReplaceableCover(page.cover)) return { skipped: true, error: "It has its own cover." };

  const title = (note.block_name as string | null) || (note.title as string) || "";
  const input = coverInput(title, noteAsPlainText((note.content as string | null) ?? ""), opts.idea);
  if (!input) return { error: "Write something first (or type an idea for the picture)." };

  // 1) Groq thinks about the note and plans the scene
  let usage: string | null = null;
  const out = await withAiUsage(
    "cover-art",
    async () => {
      const o = await aiChat(COVER_SYSTEM, [{ text: input }], { kind: "write", temperature: 0.7, maxTokens: 700, timeoutMs: 25000 });
      const { timezone } = await getSettings(sb);
      usage = await scopeUsageLine(sb, userId, timezone, localNow(timezone).date).catch(() => null);
      return o;
    },
    { sb, userId },
  );
  if (!("text" in out)) return { error: out.error };
  const plan = parseCoverPlan(out.text);
  if (!plan) return { error: "The AI couldn't think of a picture for this note. Try again, or type an idea." };

  // 2) Cloudflare draws it in the house style
  const img = await generateImage(buildImagePrompt(plan.scene));
  if (!("bytes" in img)) return { error: img.error, quota: img.quota };

  // 3) Save it like any other file of the notes (private bucket, only you can open it)
  const ext = img.mime === "image/png" ? "png" : "jpg";
  const path = `${userId}/covers/ai-${noteId.slice(0, 8)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const up = await sb.storage.from("note-files").upload(path, img.bytes, { contentType: img.mime, upsert: false, cacheControl: "31536000" });
  if (up.error) return { error: `Couldn't save the picture: ${up.error.message}` };
  const url = `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`;

  let saved = false;
  if (opts.save) {
    const { savePageSettings } = await import("@/app/note-actions");
    const r = await savePageSettings(noteId, { cover: url, coverY: 50 });
    if (r.error) return { error: r.error };
    saved = true;
    revalidatePath(`/notes/${noteId}`);
  }
  return { ok: true, url, scene: plan.scene, about: plan.about, usage, saved };
}
