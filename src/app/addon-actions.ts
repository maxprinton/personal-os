"use server";

import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { cleanFavorites } from "@/lib/addons/registry";

/** Pinned add-ons. `stored: false` = migration 0030 not run yet (the browser keeps them instead). */
export async function getAddonFavorites(): Promise<{ favorites: string[]; stored: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_settings").select("addon_favorites").maybeSingle();
  if (error || !data) return { favorites: [], stored: false };
  return { favorites: cleanFavorites((data as { addon_favorites?: unknown }).addon_favorites), stored: true };
}

export async function saveAddonFavorites(ids: string[]): Promise<{ ok: boolean; stored: boolean; favorites: string[] }> {
  const favorites = cleanFavorites(ids);
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false, stored: false, favorites };
  const { error } = await supabase.from("user_settings").update({ addon_favorites: favorites }).eq("user_id", userId);
  return { ok: !error, stored: !error, favorites };
}
