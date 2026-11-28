// Budget (BL-117): database access for the Finance page. Every query filters by user_id.
// A missing table (migration 0074 not run yet) is reported, never thrown, so the page keeps working.
import type { SupabaseClient } from "@supabase/supabase-js";
import { utcToLocal } from "@/lib/time";
import type { BudgetSettings, BudgetTxn, Correction, SavingsWithdrawal } from "@/lib/budget/calc";

/** BL-124 (migration 0079): the settings beyond BL-117. All optional: without 0079 they read as "not set". */
export type BudgetV2 = { savingsAccountId: string | null; planIncome: number; cushionTarget: number };
export type Debt = { id: string; person: string; amount: number; note: string | null; paid: number; left: number };

export const MISSING_BUDGET = "The budget needs migration 0074. Run MIGRACION-0074-budget-buckets.sql in Supabase.";

export function isMissingBudget(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || (/budget_/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? ""));
}

export type BudgetState =
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; settings: BudgetSettings; txns: BudgetTxn[]; skipped: string[]; v2: BudgetV2; corrections: Correction[]; debts: Debt[] | null; withdrawals: SavingsWithdrawal[] };

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
  // The old extra buckets are envelopes now (migration 0077): they come with the Finance page's envelopes
  const [k, t] = await Promise.all([
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
  // BL-124: fixes and debts (quietly empty / null when migration 0079 is not run)
  const [cr, db, dp] = await Promise.all([
    sb.from("budget_corrections").select("amount,target").eq("user_id", userId).is("deleted_at", null).limit(2000),
    sb.from("debts").select("id,person,amount,note").eq("user_id", userId).is("deleted_at", null).order("created_at"),
    sb.from("transactions").select("debt_id,amount").eq("user_id", userId).is("deleted_at", null).not("debt_id", "is", null).limit(2000),
  ]);
  const corrections: Correction[] = cr.error
    ? []
    : ((cr.data ?? []) as { amount: number | string; target: string }[]).map((c) => ({ amount: num(c.amount), target: c.target === "savings" ? "savings" : "spending" }));
  let debts: Debt[] | null = null;
  if (!db.error) {
    const paidBy = new Map<string, number>();
    for (const p of (dp.error ? [] : dp.data ?? []) as { debt_id: string; amount: number | string }[]) paidBy.set(p.debt_id, (paidBy.get(p.debt_id) ?? 0) + num(p.amount));
    debts = ((db.data ?? []) as { id: string; person: string; amount: number | string; note: string | null }[]).map((d) => {
      const paid = Math.round((paidBy.get(d.id) ?? 0) * 100) / 100;
      return { id: d.id, person: d.person, amount: num(d.amount), note: d.note, paid, left: Math.max(0, Math.round((num(d.amount) - paid) * 100) / 100) };
    });
  }
  const v2: BudgetV2 = {
    savingsAccountId: typeof row.savings_account_id === "string" ? row.savings_account_id : null,
    planIncome: num(row.plan_income),
    cushionTarget: num(row.cushion_target),
  };
  // Transfers out of the savings account since the start, with the user's "used / borrowed" answer (0080)
  let withdrawals: SavingsWithdrawal[] = [];
  if (v2.savingsAccountId) {
    const tr = await sb
      .from("transfers")
      .select("id,amount,occurred_at,to_account_id")
      .eq("user_id", userId)
      .eq("from_account_id", v2.savingsAccountId)
      .is("deleted_at", null)
      .gte("occurred_at", from)
      .order("occurred_at", { ascending: false })
      .limit(500);
    const rows = (tr.error ? [] : tr.data ?? []) as { id: string; amount: number | string; occurred_at: string; to_account_id: string }[];
    const marks = new Map<string, "used" | "borrowed">();
    if (rows.length) {
      const mk = await sb.from("budget_savings_withdrawals").select("transfer_id,kind").eq("user_id", userId).in("transfer_id", rows.map((r) => r.id));
      for (const m of (mk.error ? [] : mk.data ?? []) as { transfer_id: string; kind: string }[]) marks.set(m.transfer_id, m.kind === "borrowed" ? "borrowed" : "used");
    }
    withdrawals = rows
      .map((r) => ({ id: r.id, amount: num(r.amount), localDate: utcToLocal(r.occurred_at, tz).date, toAccountId: r.to_account_id, kind: marks.get(r.id) ?? null }))
      .filter((w) => w.localDate >= settings.start_date);
  }
  const err = k.error ?? t.error;
  if (err) return isMissingBudget(err) ? { kind: "missing" } : { kind: "error", message: err.message };
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
  return { kind: "ready", settings, txns, skipped: ((k.data ?? []) as { transaction_id: string }[]).map((x) => x.transaction_id), v2, corrections, debts, withdrawals };
}
