"use server";
// The notes search engine (Ctrl+F box, /search page, Notes list, notes database magnifier).
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/calendar/model";
import { indexStatus, indexUser, processFiles, searchNotes, type SearchOptions, type SearchResponse } from "@/lib/search/server";

export async function searchAction(input: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const q = String(input ?? "").slice(0, 300);
  try {
    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) return { ok: false, results: [], total: 0, words: [], error: "Sign in again." };
    return await searchNotes(supabase, userId, q, opts);
  } catch (e) {
    return { ok: false, results: [], total: 0, words: [], error: e instanceof Error ? e.message : "Search failed." };
  }
}

export async function searchStatusAction() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  try {
    return await indexStatus(supabase, userId);
  } catch {
    return null;
  }
}

/** "Update index now": your notes, then a few waiting files (about 40 s at most). */
export async function reindexNowAction(): Promise<{ ok: boolean; notes?: number; files?: number; error?: string }> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false, error: "Sign in again." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "The server key is missing." };
  try {
    const notes = await indexUser(admin, userId, { budgetMs: 20_000 });
    const files = await processFiles(admin, { budgetMs: 20_000, userId });
    return { ok: true, notes, files };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't update the index." };
  }
}
