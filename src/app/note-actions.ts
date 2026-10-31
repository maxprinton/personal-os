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

/** Autosave of a normal note from the Notion-style editor (title and Markdown content). */
export async function autosaveNote(input: { id: string; title: string; content: string }): Promise<{ ok?: boolean; error?: string }> {
  const id = String(input.id ?? "");
  if (!id) return { error: "Missing note." };
  const content = String(input.content ?? "").replace(/\r\n?/g, "\n");
  if (content.length > 200_000) return { error: "This note is too long." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notes")
    .update({ title: String(input.title ?? "").trim() || "Untitled", content })
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ---------- Notes as Notion pages (migration 0020) ----------

export type PageSettings = {
  icon?: string | null;
  cover?: string | null;
  coverY?: number | null;
  /** The last prompt used to make the cover with AI (the AI's scene, your idea, and the full text sent to the image model). */
  coverPrompt?: { prompt: string; scene: string; idea: string; at: string } | null;
  font?: "default" | "serif" | "mono";
  small?: boolean;
  full?: boolean;
  locked?: boolean;
  toc?: boolean;
  /** Spell check: words "Ignore in this note". */
  spellIgnore?: string[] | null;
};

const SETTING_KEYS: (keyof PageSettings)[] = ["icon", "cover", "coverY", "coverPrompt", "font", "small", "full", "locked", "toc", "spellIgnore"];

/** Changes the page's icon, cover, font, width… (only the keys sent). */
export async function savePageSettings(id: string, patch: PageSettings): Promise<{ ok?: boolean; error?: string; page?: PageSettings }> {
  if (!id) return { error: "Missing note." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes").select("page").eq("id", id).maybeSingle();
  if (error) return { error: error.message.includes("page") ? "Run MIGRACION-0020 in Supabase first." : error.message };
  const page: PageSettings = { ...((data?.page as PageSettings | null) ?? {}) };
  for (const k of SETTING_KEYS) if (k in patch) (page as Record<string, unknown>)[k] = patch[k] ?? null;
  const { error: e2 } = await supabase.from("notes").update({ page }).eq("id", id);
  if (e2) return { error: e2.message };
  revalidatePath("/notes");
  return { ok: true, page };
}

/** "/page" or "[[ + Add new sub-page": a new note inside this one. */
export async function createSubpage(parentId: string, title: string): Promise<{ id?: string; title?: string; error?: string }> {
  const supabase = await createClient();
  const t = String(title ?? "").trim().slice(0, 200);
  // A page inside a template (or inside one of its sub-pages) is part of the template, not a note of its own
  let inTemplate = false;
  if (parentId) {
    const { data: parent, error: pErr } = await supabase.from("notes").select("is_template").eq("id", parentId).maybeSingle();
    if (!pErr) inTemplate = !!(parent as { is_template?: boolean } | null)?.is_template; // error = migration 0021 not run yet
  }
  const row: Record<string, unknown> = { title: t || "Untitled", parent_id: parentId || null };
  if (inTemplate) Object.assign(row, { is_template: true, template: { child: true } });
  const { data, error } = await supabase.from("notes").insert(row).select("id,title").single();
  if (error || !data) return { error: error?.message ?? "Couldn't create the page." };
  revalidatePath("/notes");
  return { id: data.id as string, title: data.title as string };
}

/** ✨ Summarize notes → "Save as new note": a new top-level note with that Markdown. */
export async function createNoteFromMarkdown(title: string, content: string): Promise<{ id?: string; error?: string }> {
  const t = String(title ?? "").trim().slice(0, 200) || "Summary";
  const c = String(content ?? "");
  if (c.length > 200_000) return { error: "That summary is too long." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes").insert({ title: t, content: c }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Couldn't create the note." };
  revalidatePath("/notes");
  return { id: data.id as string };
}

/** ⋮⋮ → Move to: adds the block (Markdown) at the end of another note. */
export async function appendToNote(id: string, markdown: string): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes").select("content").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error || !data) return { error: error?.message ?? "Note not found." };
  const before = String(data.content ?? "").replace(/\s+$/, "");
  const content = `${before}${before ? "\n\n" : ""}${String(markdown ?? "").trim()}\n`;
  if (content.length > 200_000) return { error: "That note is too long." };
  const { error: e2 } = await supabase.from("notes").update({ content }).eq("id", id);
  if (e2) return { error: e2.message };
  revalidatePath(`/notes/${id}`);
  return { ok: true };
}

/** Page ⋯ → Move to: puts the note inside another one (null = top level). */
export async function moveNote(id: string, parentId: string | null): Promise<{ ok?: boolean; error?: string }> {
  if (parentId === id) return { error: "A page can't go inside itself." };
  const supabase = await createClient();
  // Not inside one of its own sub-pages
  let cur = parentId;
  for (let i = 0; cur && i < 50; i++) {
    if (cur === id) return { error: "A page can't go inside one of its sub-pages." };
    const { data } = await supabase.from("notes").select("parent_id").eq("id", cur).maybeSingle();
    cur = (data?.parent_id as string | null) ?? null;
  }
  const { error } = await supabase.from("notes").update({ parent_id: parentId }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/notes");
  revalidatePath(`/notes/${id}`);
  return { ok: true };
}

/** Page ⋯ → Duplicate: a copy next to it (same parent), then opens it. */
export async function duplicateNote(form: FormData) {
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  const read = await supabase.from("notes").select("title,content,page,parent_id").eq("id", id).maybeSingle();
  const src = read.data as { title: string; content: string; page?: unknown; parent_id?: string | null } | null;
  if (!src) redirect("/notes");
  const { data } = await supabase
    .from("notes")
    .insert({ title: `${src.title || "Untitled"} (1)`, content: src.content, page: src.page ?? {}, parent_id: src.parent_id ?? null })
    .select("id")
    .single();
  revalidatePath("/notes");
  redirect(data ? `/notes/${data.id}` : "/notes");
}

/** Deleting a page also deletes its sub-pages (like Notion). */
export async function deletePage(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  const all = [id];
  let level = [id];
  for (let i = 0; level.length && i < 20; i++) {
    const { data } = await supabase.from("notes").select("id").in("parent_id", level).is("deleted_at", null);
    level = ((data ?? []) as { id: string }[]).map((r) => r.id).filter((x) => !all.includes(x));
    all.push(...level);
  }
  const { data: parent } = await supabase.from("notes").select("parent_id").eq("id", id).maybeSingle();
  await supabase.from("entity_relations").update({ deleted_at: now }).eq("source_type", "note").in("source_id", all);
  await supabase.from("entity_tags").update({ deleted_at: now }).eq("entity_type", "note").in("entity_id", all);
  await supabase.from("notes").update({ deleted_at: now }).in("id", all);
  revalidatePath("/notes");
  redirect(parent?.parent_id ? `/notes/${parent.parent_id}` : "/notes");
}
