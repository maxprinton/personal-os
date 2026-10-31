// Server side of ✨ AI covers: read the note → Groq plans the picture → Cloudflare draws it → it is fitted to the frames
// (src/lib/cover-fit.ts) → saved in the note-files bucket. The prompt used is kept in the note (page.coverPrompt) when the cover is saved.
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, hasAi } from "@/lib/ai";
import { noteAsPlainText } from "@/lib/block-notes";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { COVER_SYSTEM, buildImagePrompt, coverInput, isAiCover, isReplaceableCover, needsFit, parseCoverPlan, promptRecord, withCoverBg, type CoverPromptRecord } from "@/lib/cover-art";
import { generateImage, hasImageAi } from "@/lib/cloudflare-image";
import { fitCover } from "@/lib/cover-fit";

export type CoverResult =
  | { ok: true; url: string; scene: string; about: string; usage: string | null; saved: boolean; record: CoverPromptRecord | null; refit?: boolean }
  | { ok?: false; error: string; skipped?: boolean; quota?: boolean };

const urlFor = (path: string) => `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`;

/** Fits the picture to the frames and saves it. Without sharp (or if it fails) the picture is saved as it came. */
async function storePicture(sb: SupabaseClient, userId: string, noteId: string, bytes: Uint8Array, mime: string): Promise<{ url: string } | { error: string }> {
  const fit = await fitCover(bytes);
  const body = fit ? fit.bytes : bytes;
  const type = fit ? fit.mime : mime;
  const ext = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  const path = `${userId}/covers/ai-${noteId.slice(0, 8)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const up = await sb.storage.from("note-files").upload(path, body, { contentType: type, upsert: false, cacheControl: "31536000" });
  if (up.error) return { error: `Couldn't save the picture: ${up.error.message}` };
  return { url: fit ? withCoverBg(urlFor(path), fit.bg) : urlFor(path) };
}

/** An AI cover made before fitting existed: cut and blend it again (no AI, no quota used). */
async function refitCover(sb: SupabaseClient, userId: string, noteId: string, cover: string): Promise<CoverResult> {
  const key = decodeURIComponent(cover.replace(/#.*$/, "").replace(/^\/api\/files\//, "").split("/").map(decodeURIComponent).join("/"));
  if (!key.startsWith(`${userId}/`) || key.includes("..")) return { error: "That picture isn't yours." };
  const dl = await sb.storage.from("note-files").download(key);
  if (dl.error || !dl.data) return { error: "Couldn't read the old picture." };
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const stored = await storePicture(sb, userId, noteId, bytes, dl.data.type || "image/jpeg");
  if ("error" in stored) return stored;
  if (!/#bg=/.test(stored.url)) return { error: "Couldn't fit the picture (image tools unavailable)." };
  const { savePageSettings } = await import("@/app/note-actions");
  const r = await savePageSettings(noteId, { cover: stored.url, coverY: 50 });
  if (r.error) return { error: r.error };
  revalidatePath(`/notes/${noteId}`);
  return { ok: true, url: stored.url, scene: "", about: "", usage: null, saved: true, record: null, refit: true };
}

export async function makeCover(sb: SupabaseClient, userId: string, noteId: string, opts: { idea?: string; save?: boolean; force?: boolean } = {}): Promise<CoverResult> {
  if (!noteId) return { error: "Missing note." };
  if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };
  if (!hasImageAi()) return { error: "Pictures aren't connected: add CF_ACCOUNT_ID and CF_API_TOKEN in Vercel (see ACTIVAR-PORTADAS-IA.md)." };

  const { data: note, error } = await sb.from("notes").select("id,title,content,block_name,page").eq("id", noteId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  if (error) return { error: error.message };
  if (!note) return { error: "Note not found." };
  const page = ((note.page as Record<string, unknown> | null) ?? {}) as { cover?: string | null };
  if (opts.save && !opts.force) {
    if (needsFit(page.cover)) return refitCover(sb, userId, noteId, page.cover as string);
    if (!isReplaceableCover(page.cover)) return { skipped: true, error: isAiCover(page.cover) ? "It already has an AI cover." : "It has its own cover." };
  }

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

  // 3) Fit it to the frames and save it like any other file of the notes (private bucket, only you can open it)
  const stored = await storePicture(sb, userId, noteId, img.bytes, img.mime);
  if ("error" in stored) return stored;

  const record = promptRecord(plan.scene, opts.idea);
  let saved = false;
  if (opts.save) {
    const { savePageSettings } = await import("@/app/note-actions");
    const r = await savePageSettings(noteId, { cover: stored.url, coverY: 50, coverPrompt: record });
    if (r.error) return { error: r.error };
    saved = true;
    revalidatePath(`/notes/${noteId}`);
  }
  return { ok: true, url: stored.url, scene: plan.scene, about: plan.about, usage, saved, record };
}
