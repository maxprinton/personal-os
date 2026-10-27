"use server";

// Block note actions. Unlike the calendar actions these also work on the phone:
// the calendar is read-only there, but the note of a block can be written.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findBlockNote, writeBlockNote } from "@/lib/block-notes";
import { parseTags, setTags } from "@/lib/tags";
import type { ActionState } from "@/app/actions";

export type BlockNoteResult = { ok?: boolean; error?: string; id?: string };

const MAX_LEN = 50_000;

async function user() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}

/** Autosave of the note shared by every block with this name (last save wins, like LifeOS). */
export async function saveBlockNote(input: { name: string; content: string }): Promise<BlockNoteResult> {
  try {
    const { sb, userId } = await user();
    const content = String(input.content ?? "").replace(/\r\n?/g, "\n");
    if (content.length > MAX_LEN) return { error: "This note is too long." };
    const id = await writeBlockNote(sb, userId, String(input.name ?? ""), content);
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the note." };
  }
}

/** Notes → Block notes: open the note of a block (created empty the first time). */
export async function openBlockNote(form: FormData) {
  const name = String(form.get("name") ?? "");
  const { sb, userId } = await user();
  const existing = await findBlockNote(sb, userId, name);
  const id = existing?.id ?? (await writeBlockNote(sb, userId, name, ""));
  redirect(`/notes/${id}`);
}

/** Tags of a block note (its text autosaves on its own). */
export async function saveNoteTags(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Missing note." };
  const supabase = await createClient();
  await setTags(supabase, "note", id, parseTags(String(form.get("tags") ?? "")));
  revalidatePath(`/notes/${id}`);
  return { ok: true, at: Date.now() };
}
