// The context every bot handler gets (server only). The admin client skips RLS, so EVERY query in
// lib/bot filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { localNow } from "@/lib/time";

export type Ctx = {
  admin: SupabaseClient;
  userId: string;
  chatId: number;
  tz: string;
  today: string;
  nowMin: number;
};

export function makeCtx(admin: SupabaseClient, userId: string, chatId: number, tz: string | null | undefined): Ctx {
  const timezone = tz || "America/Guayaquil";
  const now = localNow(timezone);
  return { admin, userId, chatId, tz: timezone, today: now.date, nowMin: now.minutes };
}

/** Reads every row (Supabase returns at most 1000 per request). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
