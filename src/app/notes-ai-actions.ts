"use server";
// OWNED BY: connections & extras. ✨ AI summary of one note (one line), saved in the built-in "AI summary" property.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiChat, hasAi } from "@/lib/ai";
import { noteAsPlainText } from "@/lib/block-notes";
import { getProperties } from "@/lib/notes-db/server";
import { SUMMARY_SYSTEM, cleanSummary, summaryInput } from "@/lib/notes-db/ai-summary";
import type { PropValue } from "@/lib/notes-db/types";

const MIGRATION = "Run MIGRACION-0021-notas-base-de-datos.sql in Supabase first.";

export async function summarizeNote(noteId: string): Promise<{ ok: true; text: string } | { ok?: false; error: string }> {
  try {
    if (!noteId) return { error: "Missing note." };
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return { error: "Sign in again." };
    if (!hasAi()) return { error: "The AI is not connected: GROQ_API_KEY is missing in Vercel." };

    const { data: note, error } = await sb.from("notes").select("id,title,content,block_name").eq("id", noteId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
    if (error) return { error: error.message };
    if (!note) return { error: "Note not found." };

    const props = await getProperties(sb, user.id);
    const prop = props.find((p) => p.builtin && p.key === "ai_summary") ?? props.find((p) => p.type === "ai_summary");
    if (!prop) return { error: "The AI summary property is missing. Reload the page and try again." };

    const input = summaryInput((note.block_name as string | null) || (note.title as string) || "", noteAsPlainText((note.content as string | null) ?? ""));
    if (!input) return { error: "Write something first." };

    const out = await aiChat(SUMMARY_SYSTEM, [{ text: input }], { kind: "write", temperature: 0.3, maxTokens: 600, timeoutMs: 30000 });
    if (!("text" in out)) return { error: out.error };
    const text = cleanSummary(out.text);
    if (!text) return { error: "The AI didn't write a summary. Try again." };

    // Read the values again right before saving (the AI took a few seconds; don't undo other changes)
    const { data: row, error: e2 } = await sb.from("notes").select("props").eq("id", noteId).eq("user_id", user.id).maybeSingle();
    if (e2) return { error: e2.message.includes("props") ? MIGRATION : e2.message };
    const next = { ...(((row?.props as Record<string, PropValue> | null) ?? {}) as Record<string, PropValue>), [prop.id]: { text, at: new Date().toISOString() } };
    const { error: e3 } = await sb.from("notes").update({ props: next }).eq("id", noteId).eq("user_id", user.id);
    if (e3) return { error: e3.message.includes("props") ? MIGRATION : e3.message };

    revalidatePath("/notes");
    revalidatePath(`/notes/${noteId}`);
    return { ok: true, text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't write the summary." };
  }
}
