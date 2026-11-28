import type { createClient } from "@/lib/supabase/server";
import { utcToLocal } from "@/lib/time";
import type { Snapshot, Transfer, Txn } from "@/lib/money";
import type { BudgetRow, LimitChange } from "@/lib/budget-rollover";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Account = { id: string; name: string; kind: string };
export type Category = { id: string; name: string; kind: "income" | "expense"; color: string | null };

/** Everything the finance screens need, in one round of queries. */
export async function getFinance(supabase: Supabase, tz: string) {
  const [acc, cat, bud, snap, tx, tr] = await Promise.all([
    supabase.from("accounts").select("id,name,kind").is("deleted_at", null).order("created_at"),
    supabase.from("categories").select("id,name,kind,color").is("deleted_at", null).order("name"),
    loadBudgets(supabase),
    supabase.from("balance_snapshots").select("id,account_id,amount,recorded_at").is("deleted_at", null),
    supabase
      .from("transactions")
      .select("id,account_id,category_id,type,amount,description,occurred_at")
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("transfers")
      .select("id,from_account_id,to_account_id,amount,note,occurred_at")
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false }),
  ]);

  const txns: Txn[] = ((tx.data ?? []) as Omit<Txn, "localDate">[]).map((t) => ({
    ...t,
    amount: Number(t.amount),
    localDate: utcToLocal(t.occurred_at, tz).date,
  }));
  const transfers: Transfer[] = ((tr.data ?? []) as Omit<Transfer, "localDate">[]).map((t) => ({
    ...t,
    amount: Number(t.amount),
    localDate: utcToLocal(t.occurred_at, tz).date,
  }));
  return {
    transfers,
    accounts: (acc.data ?? []) as Account[],
    categories: (cat.data ?? []) as Category[],
    budgets: bud.budgets,
    budgetChanges: bud.changes,
    snapshots: ((snap.data ?? []) as Snapshot[]).map((s) => ({ ...s, amount: Number(s.amount) })),
    txns,
  };
}

/**
 * Envelopes (category budgets): rollover switch and limit history (migration 0076), name, order and several
 * categories (0077). Without those migrations it falls back to the old columns: one category, no rollover.
 */
export async function loadBudgets(supabase: Supabase): Promise<{ budgets: BudgetRow[]; changes: LimitChange[] }> {
  const full = await supabase
    .from("budgets")
    .select("id,category_id,limit_amount,period,rollover,rollover_since,started_on,name,position,created_at,budget_categories(category_id)")
    .is("deleted_at", null)
    .order("position")
    .order("created_at");
  if (full.error) {
    const { data } = await supabase.from("budgets").select("id,category_id,limit_amount,period").is("deleted_at", null);
    return { budgets: ((data ?? []) as BudgetRow[]).map((b) => ({ ...b, limit_amount: Number(b.limit_amount) })), changes: [] };
  }
  type Row = BudgetRow & { budget_categories?: { category_id: string }[] | null };
  const budgets = ((full.data ?? []) as Row[]).map(({ budget_categories, ...b }) => ({
    ...b,
    limit_amount: Number(b.limit_amount),
    category_ids: (budget_categories ?? []).map((x) => x.category_id),
  }));
  if (!budgets.length) return { budgets, changes: [] };
  const ch = await supabase
    .from("budget_limit_changes")
    .select("budget_id,limit_amount,effective_from")
    .in("budget_id", budgets.map((b) => b.id));
  const changes = ((ch.error ? [] : ch.data ?? []) as LimitChange[]).map((c) => ({ ...c, limit_amount: Number(c.limit_amount) }));
  return { budgets, changes };
}
