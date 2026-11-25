// Budget (BL-117): database access for the Finance page. Every query filters by user_id.
// A missing table (migration 0074 not run yet) is reported, never thrown, so the page keeps working.
import type { SupabaseClient } from "@supabase/supabase-js";
import { utcToLocal } from "@/lib/time";
import type { BudgetSettings, BudgetTxn, CustomBucket } from "@/lib/budget/calc";

export const MISSING_BUDGET = "The budget needs migration 0074. Run MIGRACION-0074-budget-buckets.sql in Supabase.";

export function isMissingBudget(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || (/budget_/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? ""));
}

export type BudgetState =
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; settings: BudgetSettings; buckets: CustomBucket[]; txns: BudgetTxn[]; skipped: string[] };

const num = (v: unknown) => Number(v ?? 0);

export async function loadBudget(sb: SupabaseClient, userId: string, tz: string): Promise<BudgetState> {
  const s = await sb.from("budget_settings").select("*").eq("user_id", userId).maybeSingle();
  if (s.error) return isMissingBudget(s.error) ? { kind: "missing" } : { kind: "error", message: s.error.message };
  if (!s.data) return { kind: "empty" };
  const row = s.data as Record<string, unknown>;
  const settings: BudgetSettings = {
    start_date: String(row.start_date),
    savings_percent: num(row.savings_percent),
    counted_category_ids: Array.isArray(row.counted_category_ids) ? (row.counted_category_ids as string[]) : [],
    opening_spending: num(row.opening_spending),
    opening_savings: num(row.opening_savings),
    savings_name: String(row.savings_name ?? "Savings"),
    fixed_name: String(row.fixed_name ?? "Fixed costs"),
    spending_name: String(row.spending_name ?? "Spending money"),
  };
  // one day earlier than the start (UTC vs local day); the exact local day is filtered below
  const from = new Date(Date.parse(`${settings.start_date}T00:00:00Z`) - 86_400_000).toISOString();
  const [b, k, t] = await Promise.all([
    sb.from("budget_buckets").select("id,name,monthly_amount").eq("user_id", userId).is("deleted_at", null).order("position"),
    sb.from("budget_saving_skips").select("transaction_id").eq("user_id", userId).limit(2000),
    sb
      .from("transactions")
      .select("id,type,amount,category_id,description,occurred_at,payment_template_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("occurred_at", from)
      .order("occurred_at", { ascending: false })
      .limit(2000),
  ]);
  const err = b.error ?? k.error ?? t.error;
  if (err) return isMissingBudget(err) ? { kind: "missing" } : { kind: "error", message: err.message };
  const buckets = ((b.data ?? []) as { id: string; name: string; monthly_amount: number | string }[]).map((x) => ({ id: x.id, name: x.name, monthly_amount: num(x.monthly_amount) }));
  const txns = ((t.data ?? []) as { id: string; type: "income" | "expense"; amount: number | string; category_id: string | null; description: string | null; occurred_at: string; payment_template_id: string | null }[])
    .map((x) => ({
      id: x.id,
      type: x.type,
      amount: num(x.amount),
      category_id: x.category_id,
      description: x.description,
      localDate: utcToLocal(x.occurred_at, tz).date,
      payment_template_id: x.payment_template_id,
    }))
    .filter((x) => x.localDate >= settings.start_date);
  return { kind: "ready", settings, buckets, txns, skipped: ((k.data ?? []) as { transaction_id: string }[]).map((x) => x.transaction_id) };
}
