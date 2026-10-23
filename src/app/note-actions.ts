"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseTags, setTags } from "@/lib/tags";
import type { ActionState } from "@/app/actions";

export async function createNote(form: FormData) {
  const title = String(form.get("title") ?? "").trim() || "Untitled";
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes").insert({ title }).select("id").single();
  if (error || !data) redirect("/notes");
  revalidatePath("/notes");
  redirect(`/notes/${data.id}`);
}

export async function saveNote(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Missing note." };
  const title = String(form.get("title") ?? "").trim() || "Untitled";
  const content = String(form.get("content") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("notes").update({ title, content }).eq("id", id);
  if (error) return { error: error.message };
  await setTags(supabase, "note", id, parseTags(String(form.get("tags") ?? "")));
  revalidatePath("/notes");
  revalidatePath(`/notes/${id}`);
  revalidatePath("/");
  return { ok: true, at: Date.now() };
}

export async function deleteNote(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("entity_relations").update({ deleted_at: now }).eq("source_type", "note").eq("source_id", id);
  await supabase.from("entity_tags").update({ deleted_at: now }).eq("entity_type", "note").eq("entity_id", id);
  await supabase.from("notes").update({ deleted_at: now }).eq("id", id);
  revalidatePath("/notes");
  redirect("/notes");
}
