"use server";

// Edit a tag from the tag picker: rename, recolor, delete, or merge into another one. Tags are shared by notes,
// tasks and events, so the change shows everywhere. Everything runs as the signed-in user (RLS).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanTagName, isColor } from "@/lib/notes-db/tag-ops";
import type { ColorName } from "@/lib/editor/colors";

type Fail = { ok?: false; error: string; conflict?: undefined };
/** The new name is taken by another tag: ask whether to merge (mergeTag). */
type Conflict = { ok?: false; conflict: { name: string }; error?: undefined };

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

async function findTag(sb: Awaited<ReturnType<typeof createClient>>, userId: string, name: string) {
  const { data } = await sb.from("tags").select("id,name,color").eq("user_id", userId).is("deleted_at", null).ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`));
  return ((data ?? []) as { id: string; name: string; color: string | null }[]).find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null;
}

const refresh = () => {
  revalidatePath("/notes");
  revalidatePath("/tasks");
  revalidatePath("/settings");
};

/** Renames and/or recolors a tag (found by its current name). */
export async function updateTag(name: string, patch: { name?: string; color?: ColorName }): Promise<{ ok: true; name: string; color: string | null } | Fail | Conflict> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const tag = await findTag(sb, userId, cleanTagName(name));
  if (!tag) return { error: "That tag no longer exists." };
  const update: { name?: string; color?: string } = {};
  if (patch.color !== undefined) {
    if (!isColor(patch.color)) return { error: "That color doesn't exist." };
    update.color = patch.color;
  }
  if (patch.name !== undefined) {
    const next = cleanTagName(patch.name);
    if (!next) return { error: "Write a name." };
    if (next !== tag.name) {
      const clash = await findTag(sb, userId, next);
      // Only a case change of the same tag is fine ("work" → "Work")
      if (clash && clash.id !== tag.id) return { conflict: { name: clash.name } };
      update.name = next;
    }
  }
  if (!Object.keys(update).length) return { ok: true, name: tag.name, color: tag.color };
  const { error } = await sb.from("tags").update(update).eq("id", tag.id).eq("user_id", userId);
  if (error) return { error: error.code === "23505" ? "A tag with that name already exists." : error.message };
  refresh();
  return { ok: true, name: update.name ?? tag.name, color: update.color ?? tag.color };
}

/** Moves everything tagged `from` to `into` and removes `from`. Nothing that carried a tag loses it. */
export async function mergeTag(from: string, into: string): Promise<{ ok: true; name: string } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const a = await findTag(sb, userId, cleanTagName(from));
  const b = await findTag(sb, userId, cleanTagName(into));
  if (!a || !b) return { error: "That tag no longer exists." };
  if (a.id === b.id) return { ok: true, name: b.name };
  const now = new Date().toISOString();

  const { data: links } = await sb.from("entity_tags").select("id,entity_type,entity_id").eq("user_id", userId).eq("tag_id", a.id).is("deleted_at", null);
  const mine = (links ?? []) as { id: string; entity_type: string; entity_id: string }[];
  const { data: targetLinks } = await sb.from("entity_tags").select("entity_type,entity_id").eq("user_id", userId).eq("tag_id", b.id).is("deleted_at", null);
  const has = new Set(((targetLinks ?? []) as { entity_type: string; entity_id: string }[]).map((l) => `${l.entity_type}:${l.entity_id}`));
  const move = mine.filter((l) => !has.has(`${l.entity_type}:${l.entity_id}`)).map((l) => l.id);
  const dup = mine.filter((l) => has.has(`${l.entity_type}:${l.entity_id}`)).map((l) => l.id);
  if (move.length) {
    const { error } = await sb.from("entity_tags").update({ tag_id: b.id }).in("id", move);
    if (error) return { error: error.message };
  }
  if (dup.length) await sb.from("entity_tags").update({ deleted_at: now }).in("id", dup);
  await sb.from("tags").update({ deleted_at: now }).eq("id", a.id).eq("user_id", userId);
  refresh();
  return { ok: true, name: b.name };
}

/** Deletes a tag everywhere it is used. */
export async function deleteTagByName(name: string): Promise<{ ok: true } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const tag = await findTag(sb, userId, cleanTagName(name));
  if (!tag) return { ok: true };
  const now = new Date().toISOString();
  await sb.from("entity_tags").update({ deleted_at: now }).eq("tag_id", tag.id).is("deleted_at", null);
  const { error } = await sb.from("tags").update({ deleted_at: now }).eq("id", tag.id).eq("user_id", userId);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}
