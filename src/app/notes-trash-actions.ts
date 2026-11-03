"use server";

// The notes trash screen (/notes/trash): restore, delete for good, empty. Logic in src/lib/notes-trash.ts.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteForever, emptyTrash, restoreFromTrash } from "@/lib/notes-trash";

type Done = { ok: true; count: number } | { ok?: false; error: string };

async function run(fn: (sb: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<number>): Promise<Done> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Sign in again." };
  try {
    const count = await fn(sb, user.id);
    revalidatePath("/notes");
    revalidatePath("/notes/trash");
    return { ok: true, count };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

const clean = (ids: unknown) => [...new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && !!x))].slice(0, 1000);

/** Back to Notes, with the sub-pages, tags and links that went with them. */
export async function restoreTrashed(ids: string[]): Promise<Done> {
  const list = clean(ids);
  if (!list.length) return { error: "Nothing selected." };
  return run((sb, userId) => restoreFromTrash(sb, userId, list));
}

/** Gone for good (cannot be undone). */
export async function deleteTrashed(ids: string[]): Promise<Done> {
  const list = clean(ids);
  if (!list.length) return { error: "Nothing selected." };
  return run((sb, userId) => deleteForever(sb, userId, list));
}

export async function emptyNotesTrash(): Promise<Done> {
  return run((sb, userId) => emptyTrash(sb, userId));
}
