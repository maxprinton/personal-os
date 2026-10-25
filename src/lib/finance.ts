import type { createClient } from "@/lib/supabase/server";
import { utcToLocal } from "@/lib/time";
import type { Budget, Snapshot, Transfer, Txn } from "@/lib/money";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Account = { id: string; name: string; kind: string };
export type Category = { id: string; name: string; kind: "income" | "expense"; color: string | null };

/** Everything the finance screens need, in one round of queries. */
export async function getFinance(supabase: Supabase, tz: string) {
  const [acc, cat, bud, snap, tx, tr] = await Promise.all([
    supabase.from("accounts").select("id,name,kind").is("deleted_at", null).order("created_at"),
    supabase.from("categories").select("id,name,kind,color").is("deleted_at", null).order("name"),
    supabase.from("budgets").select("id,category_id,limit_amount,period").is("deleted_at", null),
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
    budgets: ((bud.data ?? []) as Budget[]).map((b) => ({ ...b, limit_amount: Number(b.limit_amount) })),
    snapshots: ((snap.data ?? []) as Snapshot[]).map((s) => ({ ...s, amount: Number(s.amount) })),
    txns,
  };
}
