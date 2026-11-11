// Reads your command words (server only). A missing table (migration 0055 not run yet) just means "no words".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VocabRow } from "@/lib/bot/vocab";

export async function loadVocab(admin: SupabaseClient, userId: string): Promise<VocabRow[]> {
  const { data, error } = await admin.from("bot_vocab").select("feature_id,word,kind").eq("user_id", userId);
  if (error || !data) return [];
  return (data as VocabRow[]).filter((r) => r.kind === "add" || r.kind === "hide");
}
