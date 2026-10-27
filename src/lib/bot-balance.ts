import type { SupabaseClient } from "@supabase/supabase-js";
import { accountBalance, formatUSD, type Snapshot, type Transfer, type Txn } from "@/lib/money";

// Server-only: the "/balance" message for Telegram. Runs with the admin client, so EVERY query filters by user_id.

const TRIGGERS = new Set(["/balance", "/balances", "balance", "balances", "/saldo", "/saldos", "saldo", "saldos", "/cuentas", "cuentas", "/accounts", "accounts"]);

export function isBalanceRequest(text: string) {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?!.]/g, "")
    .replace(/@\w+$/, "") // "/balance@maxpersonalos_bot" in groups
    .replace(/\s+/g, " ")
    .trim();
  return TRIGGERS.has(t);
}

/** Reads every row (Supabase returns at most 1000 per request). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function balanceText(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: accs, error } = await admin
    .from("accounts")
    .select("id,name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  if (!accs?.length) return "You have no accounts yet. Add them in Personal OS → Finance.";

  const [snapRows, txRows, trRows] = await Promise.all([
    fetchAll<{ id: string; account_id: string; amount: number; recorded_at: string }>((a, b) =>
      admin.from("balance_snapshots").select("id,account_id,amount,recorded_at").eq("user_id", userId).is("deleted_at", null).order("recorded_at").range(a, b)
    ),
    fetchAll<{ id: string; account_id: string | null; type: "income" | "expense"; amount: number; occurred_at: string }>((a, b) =>
      admin.from("transactions").select("id,account_id,type,amount,occurred_at").eq("user_id", userId).is("deleted_at", null).order("occurred_at").order("id").range(a, b)
    ),
    fetchAll<{ id: string; from_account_id: string; to_account_id: string; amount: number; occurred_at: string }>((a, b) =>
      admin.from("transfers").select("id,from_account_id,to_account_id,amount,occurred_at").eq("user_id", userId).is("deleted_at", null).order("occurred_at").order("id").range(a, b)
    ),
  ]);

  const snapshots: Snapshot[] = snapRows.map((s) => ({ ...s, amount: Number(s.amount) }));
  const txns: Txn[] = txRows.map((t) => ({ ...t, amount: Number(t.amount), category_id: null, description: null, localDate: "" }));
  const transfers: Transfer[] = trRows.map((t) => ({ ...t, amount: Number(t.amount), note: null, localDate: "" }));

  let total = 0;
  const lines = accs.map((a) => {
    const { balance } = accountBalance(a.id, snapshots, txns, transfers);
    total += balance;
    return `• ${a.name}: ${formatUSD(balance)}`;
  });
  const unassigned = txns.filter((t) => !t.account_id).length;
  return [
    "💰 Your accounts",
    ...lines,
    accs.length > 1 ? `\nTotal: ${formatUSD(Math.round(total * 100) / 100)}` : "",
    unassigned ? `\n${unassigned} transaction${unassigned === 1 ? " has" : "s have"} no account yet, so ${unassigned === 1 ? "it is" : "they are"} not counted here (pick the account in Finance).` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
