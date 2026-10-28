// Real balance with "merma" (server only). When you set an account's real balance, the difference with
// what Personal OS had calculated becomes a transaction in its own category "Adjustment":
// less money than calculated → an expense (merma), more → an income. It shows in spending and reports
// but no budget uses it (unless you give that category a budget). Then the real balance is saved.
// Works with the signed-in client (RLS) and the admin client (Telegram): every query filters by user_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountBalance, type Snapshot, type Transfer, type Txn } from "@/lib/money";

export const ADJUSTMENT_CATEGORY = "Adjustment";
export const ADJUSTMENT_DESCRIPTION = "Balance adjustment";

/** What Personal OS calculates for one account right now (latest real balance + everything after it). */
export async function calculatedBalance(sb: SupabaseClient, userId: string, accountId: string) {
  const [s, t, tr] = await Promise.all([
    sb.from("balance_snapshots").select("id,account_id,amount,recorded_at").eq("user_id", userId).eq("account_id", accountId).is("deleted_at", null),
    sb.from("transactions").select("id,account_id,type,amount,occurred_at").eq("user_id", userId).eq("account_id", accountId).is("deleted_at", null),
    sb
      .from("transfers")
      .select("id,from_account_id,to_account_id,amount,occurred_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .or(`from_account_id.eq.${accountId},to_account_id.eq.${accountId}`),
  ]);
  const snaps = ((s.data ?? []) as Snapshot[]).map((x) => ({ ...x, amount: Number(x.amount) }));
  const txns = ((t.data ?? []) as Omit<Txn, "localDate" | "category_id" | "description">[]).map((x) => ({
    ...x,
    amount: Number(x.amount),
    category_id: null,
    description: null,
    localDate: "",
  })) as Txn[];
  const trs = ((tr.data ?? []) as Omit<Transfer, "note" | "localDate">[]).map((x) => ({ ...x, amount: Number(x.amount), note: null, localDate: "" })) as Transfer[];
  const r = accountBalance(accountId, snaps, txns, trs);
  return { balance: r.balance, hasSnapshot: Boolean(r.snapshotAt) };
}

/** The "Adjustment" category of that kind (created the first time). */
async function adjustmentCategory(sb: SupabaseClient, userId: string, kind: "income" | "expense") {
  const { data } = await sb.from("categories").select("id,name").eq("user_id", userId).eq("kind", kind).is("deleted_at", null);
  const found = ((data ?? []) as { id: string; name: string }[]).find((c) => c.name.toLowerCase() === ADJUSTMENT_CATEGORY.toLowerCase());
  if (found) return found.id;
  const { data: created } = await sb
    .from("categories")
    .insert({ user_id: userId, name: ADJUSTMENT_CATEGORY, kind, color: "#94a3b8" })
    .select("id")
    .single();
  return (created?.id as string | undefined) ?? null;
}

/** first = the account had no real balance yet: this one is its starting point, not a merma. */
export type AdjustResult = { before: number; real: number; diff: number; first: boolean; snapshotId: string; adjustmentId: string | null };

/**
 * Saves the real balance of an account and, when it differs from the calculated one, the adjustment
 * transaction for the difference. The adjustment is dated one second before the real balance, so the
 * balance shown afterwards is exactly the real one (nothing is counted twice).
 */
export async function setRealBalance(
  sb: SupabaseClient,
  userId: string,
  accountId: string,
  real: number,
  source: "web" | "telegram_bot"
): Promise<AdjustResult> {
  const { balance: before, hasSnapshot } = await calculatedBalance(sb, userId, accountId);
  const diff = Math.round((real - before) * 100) / 100;
  const now = Date.now();
  let adjustmentId: string | null = null;
  // The first real balance of an account is where it starts, not money that went missing
  if (diff !== 0 && hasSnapshot) {
    const type = diff < 0 ? "expense" : "income";
    const category = await adjustmentCategory(sb, userId, type);
    const { data } = await sb
      .from("transactions")
      .insert({
        user_id: userId,
        type,
        amount: Math.abs(diff),
        description: ADJUSTMENT_DESCRIPTION,
        category_id: category,
        account_id: accountId,
        occurred_at: new Date(now - 1000).toISOString(),
        source,
      })
      .select("id")
      .single();
    adjustmentId = (data?.id as string | undefined) ?? null;
  }
  const { data: snap, error } = await sb
    .from("balance_snapshots")
    .insert({ user_id: userId, account_id: accountId, amount: real, recorded_at: new Date(now).toISOString() })
    .select("id")
    .single();
  if (error || !snap) {
    // Without the real balance the adjustment would count twice: take it back
    if (adjustmentId) await sb.from("transactions").update({ deleted_at: new Date().toISOString() }).eq("id", adjustmentId).eq("user_id", userId);
    throw new Error(error?.message ?? "Could not save the real balance.");
  }
  return { before, real, diff, first: !hasSnapshot, snapshotId: snap.id as string, adjustmentId };
}
