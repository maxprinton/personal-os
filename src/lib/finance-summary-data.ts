// BL-28: loads what the monthly summary needs. Works with the signed-in client (RLS) and the admin client (Telegram):
// every query filters by user_id and reads in pages of 1000 so long histories are not cut.
import type { SupabaseClient } from "@supabase/supabase-js";
import { utcToLocal } from "@/lib/time";
import type { SummaryData } from "@/lib/finance-summary";

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type TxRow = { id: string; account_id: string | null; category_id: string | null; type: "income" | "expense"; amount: number | string; description: string | null; occurred_at: string; worth_it?: boolean | null };

export async function loadSummaryData(sb: SupabaseClient, userId: string, tz: string): Promise<SummaryData> {
  const [acc, cat, snaps, tr] = await Promise.all([
    sb.from("accounts").select("id,name").eq("user_id", userId).is("deleted_at", null).order("created_at"),
    sb.from("categories").select("id,name").eq("user_id", userId).is("deleted_at", null),
    sb.from("balance_snapshots").select("id,account_id,amount,recorded_at").eq("user_id", userId).is("deleted_at", null),
    all<{ id: string; from_account_id: string; to_account_id: string; amount: number | string; note: string | null; occurred_at: string }>((a, b) =>
      sb.from("transfers").select("id,from_account_id,to_account_id,amount,note,occurred_at").eq("user_id", userId).is("deleted_at", null).order("occurred_at").range(a, b)
    ),
  ]);
  // worth_it exists only after migration 0050: try with it, fall back without it
  const txSelect = (cols: string) => (a: number, b: number) =>
    sb.from("transactions").select(cols).eq("user_id", userId).is("deleted_at", null).order("occurred_at").range(a, b) as unknown as PromiseLike<{ data: TxRow[] | null; error: unknown }>;
  let tx: TxRow[];
  try {
    tx = await all<TxRow>(txSelect("id,account_id,category_id,type,amount,description,occurred_at,worth_it"));
  } catch {
    tx = await all<TxRow>(txSelect("id,account_id,category_id,type,amount,description,occurred_at"));
  }
  return {
    accounts: (acc.data ?? []) as { id: string; name: string }[],
    categories: (cat.data ?? []) as { id: string; name: string }[],
    snapshots: ((snaps.data ?? []) as { id: string; account_id: string; amount: number | string; recorded_at: string }[]).map((s) => ({
      id: s.id,
      account_id: s.account_id,
      recorded_at: s.recorded_at,
      amount: Number(s.amount),
      localDate: utcToLocal(s.recorded_at, tz).date,
    })),
    txns: tx.map((t) => ({
      id: t.id,
      account_id: t.account_id,
      category_id: t.category_id,
      type: t.type,
      amount: Number(t.amount),
      description: t.description,
      occurred_at: t.occurred_at,
      localDate: utcToLocal(t.occurred_at, tz).date,
      worth_it: t.worth_it ?? null,
    })),
    transfers: tr.map((t) => ({ ...t, amount: Number(t.amount), localDate: utcToLocal(t.occurred_at, tz).date })),
  };
}
