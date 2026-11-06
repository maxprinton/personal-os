"use server";
// The theme you picked last (Auto / Light / Dark), saved with your settings so every device uses it
// (migration 0038). Without the column the choice is still remembered in each browser.
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";

type Pref = "auto" | "light" | "dark";
const clean = (v: unknown): Pref | null => (v === "auto" || v === "light" || v === "dark" ? v : null);

export async function getThemePref(): Promise<Pref | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("user_settings").select("theme").maybeSingle();
    if (error || !data) return null;
    return clean((data as { theme?: unknown }).theme);
  } catch {
    return null;
  }
}

export async function saveThemePref(pref: string): Promise<{ ok: boolean }> {
  const p = clean(pref);
  if (!p) return { ok: false };
  try {
    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) return { ok: false };
    const { error } = await supabase.from("user_settings").update({ theme: p }).eq("user_id", userId);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
