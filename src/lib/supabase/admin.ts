import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client with full access (bypasses RLS). Used ONLY by the Telegram webhook,
 * which has no browser session. Every query it runs must filter by user_id explicitly.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
