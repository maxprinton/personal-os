"use server";

import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { utcToLocal } from "@/lib/time";
import { revalidatePath } from "next/cache";

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

/**
 * The account to suggest when paying an event: the one used the last time this scheduled payment
 * was paid; if it was never paid, the scheduled payment's own account.
 */
export async function getSuggestedPaymentAccount(eventId: string): Promise<{
  accountId: string | null;
  source: "last" | "template" | "none";
  lastDate?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { accountId: null, source: "none" };
  const { data: ev } = await supabase
    .from("events")
    .select("payment_template_id")
    .eq("user_id", user.id)
    .eq("id", eventId)
    .maybeSingle();
  const templateId = (ev?.payment_template_id as string | null | undefined) ?? null;
  if (!templateId) return { accountId: null, source: "none" };
  const { timezone } = await getSettings(supabase);
  const { data: last } = await supabase
    .from("transactions")
    .select("account_id,occurred_at")
    .eq("user_id", user.id)
    .eq("payment_template_id", templateId)
    .is("deleted_at", null)
    .not("account_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.account_id) {
    return { accountId: last.account_id as string, source: "last", lastDate: utcToLocal(last.occurred_at as string, timezone).date };
  }
  const { data: t } = await supabase
    .from("payment_templates")
    .select("account_id")
    .eq("user_id", user.id)
    .eq("id", templateId)
    .maybeSingle();
  return { accountId: (t?.account_id as string | null | undefined) ?? null, source: t?.account_id ? "template" : "none" };
}

/** Change the account a scheduled payment uses (its next payments suggest it until one is paid from another). */
export async function setPaymentTemplateAccount(input: { templateId: string; accountId: string | null }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const { error } = await supabase
    .from("payment_templates")
    .update({ account_id: input.accountId || null })
    .eq("id", input.templateId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/finance");
  return { ok: true };
}
