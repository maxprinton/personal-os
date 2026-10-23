// Pure finance helpers (no database). All amounts are USD.
import { addDays, weekdayOf } from "@/lib/time";

export type TxnType = "income" | "expense";
export type Txn = {
  id: string;
  account_id: string | null;
  category_id: string | null;
  type: TxnType;
  amount: number;
  description: string | null;
  occurred_at: string; // ISO UTC
  localDate: string; // YYYY-MM-DD in the user's timezone
};
export type Snapshot = { id: string; account_id: string; amount: number; recorded_at: string };
export type Budget = { id: string; category_id: string; limit_amount: number; period: "weekly" | "monthly" };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** Signed value of a transaction: income +, expense -. */
export function signed(t: Pick<Txn, "type" | "amount">) {
  return t.type === "income" ? t.amount : -t.amount;
}

/**
 * Current balance of an account = latest manual snapshot + transactions after it.
 * Without a snapshot, it is just the sum of the account's transactions.
 */
export function accountBalance(accountId: string, snapshots: Snapshot[], txns: Txn[]) {
  const latest = snapshots
    .filter((s) => s.account_id === accountId)
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0];
  const cutoff = latest?.recorded_at ?? null;
  const delta = txns
    .filter((t) => t.account_id === accountId && (!cutoff || t.occurred_at > cutoff))
    .reduce((sum, t) => sum + signed(t), 0);
  return { balance: round2((latest?.amount ?? 0) + delta), snapshotAt: cutoff };
}

/** First day of the month and first day of next month for a local date. */
export function monthRange(today: string) {
  const [y, m] = today.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start, end: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

/** Monday of the week containing the date, and the Monday after. */
export function weekRange(today: string) {
  const order = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const start = addDays(today, -order.indexOf(weekdayOf(today)));
  return { start, end: addDays(start, 7) };
}

export function inRange(t: Txn, range: { start: string; end: string }) {
  return t.localDate >= range.start && t.localDate < range.end;
}

export function totals(txns: Txn[]) {
  let income = 0;
  let expense = 0;
  for (const t of txns) {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

export function budgetUsage(budget: Budget, txns: Txn[], today: string) {
  const range = budget.period === "weekly" ? weekRange(today) : monthRange(today);
  const spent = round2(
    txns
      .filter((t) => t.type === "expense" && t.category_id === budget.category_id && inRange(t, range))
      .reduce((s, t) => s + t.amount, 0)
  );
  const pct = budget.limit_amount > 0 ? Math.round((spent / budget.limit_amount) * 100) : 0;
  return { spent, limit: budget.limit_amount, left: round2(budget.limit_amount - spent), pct, range };
}

/** Expense totals per category id ("" = uncategorized), largest first. */
export function spendingByCategory(txns: Txn[]) {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "expense") continue;
    const k = t.category_id ?? "";
    map.set(k, round2((map.get(k) ?? 0) + t.amount));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
