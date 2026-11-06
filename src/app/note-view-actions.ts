"use server";
// Saved views of the notes database (table note_views, migration 0037). Each view = a tab.
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { MAX_VIEWS, cleanExtras, cleanViewName, type SavedView } from "@/lib/notes-db/views";
import type { ViewState } from "@/lib/notes-db/types";

type Row = { id: string; name: string; position: number; state: unknown; extras: unknown };
const toView = (r: Row): SavedView => ({ id: r.id, name: r.name, position: r.position, state: (r.state ?? {}) as ViewState, extras: cleanExtras(r.extras) });
const tooBig = (v: unknown) => JSON.stringify(v ?? {}).length > 200_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `ok: false` also when the migration was not run yet (the page then keeps the view in this browser). */
export async function listNoteViews(): Promise<{ ok: boolean; views: SavedView[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("note_views").select("id,name,position,state,extras").order("position", { ascending: true }).order("created_at", { ascending: true });
  if (error) return { ok: false, views: [] };
  return { ok: true, views: ((data ?? []) as Row[]).map(toView) };
}

export async function createNoteView(input: { name: string; state: ViewState; extras?: unknown }): Promise<{ ok: boolean; view?: SavedView; error?: string }> {
  if (!isObj(input.state) || tooBig(input.state)) return { ok: false, error: "That view is too big to save." };
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false, error: "Sign in again." };
  const { data: existing, error: e1 } = await supabase.from("note_views").select("position");
  if (e1) return { ok: false, error: "Couldn't save the view." };
  const rows = (existing ?? []) as { position: number }[];
  if (rows.length >= MAX_VIEWS) return { ok: false, error: `You can have up to ${MAX_VIEWS} views.` };
  const position = rows.reduce((m, r) => Math.max(m, r.position), -1) + 1;
  const { data, error } = await supabase
    .from("note_views")
    .insert({ user_id: userId, name: cleanViewName(input.name), position, state: input.state, extras: cleanExtras(input.extras) })
    .select("id,name,position,state,extras")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save the view." };
  return { ok: true, view: toView(data as Row) };
}

export async function saveNoteView(id: string, patch: { name?: string; state?: ViewState; extras?: unknown }): Promise<{ ok: boolean; error?: string }> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = cleanViewName(patch.name);
  if (patch.state !== undefined) {
    if (!isObj(patch.state) || tooBig(patch.state)) return { ok: false, error: "That view is too big to save." };
    update.state = patch.state;
  }
  if (patch.extras !== undefined) update.extras = cleanExtras(patch.extras);
  if (!Object.keys(update).length) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.from("note_views").update(update).eq("id", id);
  return error ? { ok: false, error: "Couldn't save the view." } : { ok: true };
}

export async function deleteNoteView(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { count } = await supabase.from("note_views").select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) return { ok: false, error: "Keep at least one view." };
  const { error } = await supabase.from("note_views").delete().eq("id", id);
  return error ? { ok: false, error: "Couldn't delete the view." } : { ok: true };
}

export async function reorderNoteViews(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const results = await Promise.all(ids.map((id, i) => supabase.from("note_views").update({ position: i }).eq("id", id)));
  return results.some((r) => r.error) ? { ok: false, error: "Couldn't save the new order." } : { ok: true };
}
