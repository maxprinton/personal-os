// BL-28: the monthly finance summary (pure, no database). Used by /finance, /finance/summary and Telegram.
// Rules (user decisions, 15 Nov 2026): transfers are left out; transactions without an account count in income,
// expense and categories but not in account balances; the open month is "so far" and is compared with the
// same days of the previous month; nothing is saved, it is always calculated from the data.
import { signed, type Snapshot, type Transfer, type Txn } from "@/lib/money";
import { addDays } from "@/lib/time";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SummaryTxn = Txn & { worth_it?: boolean | null };
export type SummarySnapshot = Snapshot & { localDate: string };
export type SummaryData = {
  txns: SummaryTxn[];
  transfers: Transfer[];
  snapshots: SummarySnapshot[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
};

export type Totals = { income: number; expense: number; net: number; count: number };
export type CategoryLine = { id: string | null; name: string; total: number; pct: number };
export type BalanceLine = { accountId: string; name: string; balance: number; /** no snapshot before that date: sum of movements only */ noSnapshot: boolean };
export type MonthSummary = {
  month: string; // YYYY-MM
  /** The month is still running: numbers are "so far". */
  partial: boolean;
  /** Last day counted (today for the open month, the last day otherwise). */
  throughDate: string;
  totals: Totals;
  /** Previous month, same days when the month is open; null when it has no transactions at all. */
  previous: (Totals & { month: string }) | null;
  categories: CategoryLine[];
  /** Expenses only. rated = answered "was it worth it?". */
  worth: { yes: { count: number; total: number }; no: { count: number; total: number }; unrated: { count: number; total: number } };
  biggest: { id: string; type: "income" | "expense"; amount: number; label: string; date: string }[];
  balances: BalanceLine[];
  /** Transactions of the month without an account (counted in the totals, not in the balances). */
  withoutAccount: number;
};

export const monthOf = (date: string) => date.slice(0, 7);
export function firstDay(month: string) {
  return `${month}-01`;
}
export function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
export function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function daysInMonth(month: string) {
  return Number(addDays(firstDay(nextMonth(month)), -1).slice(8, 10));
}

const inDates = (t: { localDate: string }, start: string, endExclusive: string) => t.localDate >= start && t.localDate < endExclusive;

function totalsOf(txns: Txn[]): Totals {
  let income = 0;
  let expense = 0;
  for (const t of txns) {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense), count: txns.length };
}

/** Balance of one account at the end of a local date (exclusive): latest snapshot before it + movements after that snapshot. */
export function balanceBefore(accountId: string, endExclusive: string, d: Pick<SummaryData, "txns" | "transfers" | "snapshots">): { balance: number; noSnapshot: boolean } {
  const latest = d.snapshots
    .filter((s) => s.account_id === accountId && s.localDate < endExclusive)
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0];
  const cutoff = latest?.recorded_at ?? null;
  const fromTxns = d.txns
    .filter((t) => t.account_id === accountId && t.localDate < endExclusive && (!cutoff || t.occurred_at > cutoff))
    .reduce((s, t) => s + signed(t), 0);
  const moved = d.transfers
    .filter((t) => t.localDate < endExclusive && (!cutoff || t.occurred_at > cutoff))
    .reduce((s, t) => s + (t.to_account_id === accountId ? t.amount : 0) - (t.from_account_id === accountId ? t.amount : 0), 0);
  return { balance: round2((latest?.amount ?? 0) + fromTxns + moved), noSnapshot: !latest };
}

export function summarizeMonth(d: SummaryData, month: string, today: string, topCategories = 5): MonthSummary {
  const partial = monthOf(today) === month;
  const start = firstDay(month);
  const monthEnd = firstDay(nextMonth(month));
  const endExclusive = partial ? addDays(today, 1) : monthEnd;
  const throughDate = partial ? today : addDays(monthEnd, -1);
  const mine = d.txns.filter((t) => inDates(t, start, endExclusive));
  const totals = totalsOf(mine);

  // Previous month: same number of days when the month is still open
  const pm = prevMonth(month);
  const pStart = firstDay(pm);
  const pEnd = partial ? addDays(pStart, Math.min(Number(today.slice(8, 10)), daysInMonth(pm))) : start;
  const prevTxns = d.txns.filter((t) => inDates(t, pStart, pEnd));
  const previous = prevTxns.length ? { ...totalsOf(prevTxns), month: pm } : null;

  // Categories: expenses, largest first; the rest together as "Other"
  const catName = new Map(d.categories.map((c) => [c.id, c.name]));
  const byCat = new Map<string | null, number>();
  for (const t of mine) if (t.type === "expense") byCat.set(t.category_id, round2((byCat.get(t.category_id) ?? 0) + t.amount));
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const line = ([id, total]: [string | null, number]): CategoryLine => ({
    id,
    name: id ? catName.get(id) ?? "Removed category" : "No category",
    total,
    pct: totals.expense > 0 ? Math.round((total / totals.expense) * 100) : 0,
  });
  const categories = sorted.slice(0, topCategories).map(line);
  const rest = round2(sorted.slice(topCategories).reduce((s, [, v]) => s + v, 0));
  if (rest > 0) categories.push({ id: "__other", name: "Other", total: rest, pct: totals.expense > 0 ? Math.round((rest / totals.expense) * 100) : 0 });

  // Worth it? (expenses only)
  const worth = { yes: { count: 0, total: 0 }, no: { count: 0, total: 0 }, unrated: { count: 0, total: 0 } };
  for (const t of mine) {
    if (t.type !== "expense") continue;
    const k = t.worth_it === true ? "yes" : t.worth_it === false ? "no" : "unrated";
    worth[k].count++;
    worth[k].total = round2(worth[k].total + t.amount);
  }

  const biggest = [...mine]
    .sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1))
    .slice(0, 5)
    .map((t) => ({ id: t.id, type: t.type, amount: t.amount, label: t.description || catName.get(t.category_id ?? "") || (t.type === "income" ? "Income" : "Expense"), date: t.localDate }));

  const balances = d.accounts.map((a) => ({ accountId: a.id, name: a.name, ...balanceBefore(a.id, endExclusive, d) }));

  return { month, partial, throughDate, totals, previous, categories, worth, biggest, balances, withoutAccount: mine.filter((t) => !t.account_id).length };
}

// ——— Text ———
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const monthName = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const summaryMonthName = monthName;

/** "▲ $120 more than last month" (expenses: up is bad, so wording stays neutral). */
export function diffText(now: number, before: number, label: string): string {
  const d = round2(now - before);
  if (d === 0) return `same as ${label}`;
  return `${d > 0 ? "▲" : "▼"} ${usd(Math.abs(d))} ${d > 0 ? "more" : "less"} than ${label}`;
}

/** The Telegram message (also usable anywhere plain text works). */
export function summaryText(s: MonthSummary): string {
  const L: string[] = [];
  L.push(`📊 ${monthName(s.month)}${s.partial ? ` — so far (through ${s.throughDate.slice(5)})` : ""}`);
  if (s.totals.count === 0) {
    L.push("", "No income or expenses logged in this month.");
    return L.join("\n");
  }
  const cmp = s.previous ? (s.partial ? "the same days of last month" : monthName(s.previous.month)) : "";
  L.push("", `Income: ${usd(s.totals.income)}`, `Expenses: ${usd(s.totals.expense)}`, `Net: ${s.totals.net < 0 ? "−" : s.totals.net > 0 ? "+" : ""}${usd(Math.abs(s.totals.net))}`);
  if (s.previous) {
    L.push("", `Compared with ${cmp}:`, `• expenses ${diffText(s.totals.expense, s.previous.expense, cmp)}`, `• income ${diffText(s.totals.income, s.previous.income, cmp)}`);
  }
  if (s.categories.length) {
    L.push("", "Where it went:");
    for (const c of s.categories) L.push(`• ${c.name}: ${usd(c.total)} (${c.pct}%)`);
  }
  const rated = s.worth.yes.count + s.worth.no.count;
  if (rated > 0) {
    L.push("", `Worth it? ✅ ${usd(s.worth.yes.total)} (${s.worth.yes.count}) · ❌ ${usd(s.worth.no.total)} (${s.worth.no.count}) · not rated ${usd(s.worth.unrated.total)} (${s.worth.unrated.count})`);
  }
  if (s.biggest.length) {
    L.push("", "Biggest:");
    for (const b of s.biggest) L.push(`• ${b.type === "income" ? "+" : "−"}${usd(b.amount)} ${b.label} · ${b.date.slice(5)}`);
  }
  if (s.balances.length) {
    L.push("", s.partial ? "Balances now:" : "Balances at month end:");
    for (const b of s.balances) L.push(`• ${b.name}: ${usd(b.balance)}${b.noSnapshot ? " (no balance set)" : ""}`);
  }
  if (s.withoutAccount > 0) L.push("", `${s.withoutAccount} transaction${s.withoutAccount > 1 ? "s have" : " has"} no account: counted above, not in the balances.`);
  return L.join("\n");
}
