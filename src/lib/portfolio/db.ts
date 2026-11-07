// Portfolio add-on — shared SERVER loaders. They use the signed-in user's client (RLS "own rows") and
// report `missing: true` instead of throwing when migration 0042 has not been run.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { isMissingPortfolio } from "@/lib/portfolio/errors";

export { isMissingPortfolio };

export const portfolioServer = cache(async (): Promise<{ supabase: SupabaseClient; userId: string | null }> => {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  return { supabase, userId };
});

/** Is migration 0042 in place? Cheap check used by the layout. */
export const portfolioReady = cache(async (): Promise<{ missing: boolean }> => {
  const { supabase, userId } = await portfolioServer();
  if (!userId) return { missing: false };
  const { error } = await supabase.from("portfolio_slots").select("id", { head: true, count: "exact" }).limit(1);
  return { missing: isMissingPortfolio(error) };
});
