"use server";

import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { utcToLocal } from "@/lib/time";

/** The transactions already recorded for a payment event (to show "Paid · $120 on Oct 25 · Checking"). */
export async function getPaymentRecords(eventId: string): Promise<{ amount: number; date: string; account: string | null }[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { timezone } = await getSettings(supabase);
  const { data } = await supabase
    .from("transactions")
    .select("amount,occurred_at,account_id,accounts(name)")
    .eq("user_id", user.id)
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .order("occurred_at");
  return ((data ?? []) as unknown as { amount: number; occurred_at: string; accounts: { name: string } | null }[]).map((t) => ({
    amount: Number(t.amount),
    date: utcToLocal(t.occurred_at, timezone).date,
    account: t.accounts?.name ?? null,
  }));
}
