// Envelopes (category budgets) with optional rollover, their period-by-period history, and what they take
// out of Spending money. Pure: no database.
// Rules (decided 27 Nov 2026, migrations 0076 and 0077):
//   · An envelope has a monthly amount and zero or more categories; spending in those categories comes out of it.
//   · Rollover off: every month starts at its amount. At the end of the month the envelope settles with
//     Spending money: the leftover goes back, overspending is taken from it.
//   · Rollover on: what is left (or what you went over) carries into the next month. Available = amount + what
//     carried in, never more than DOUBLE the amount (anything above goes back to Spending money); it can go
//     below zero. The carry starts in the month the switch was turned on (rollover_since).
//   · Each month uses the amount it had (budget_limit_changes); a change applies to its whole month.
import { addDays } from "@/lib/time";
import { monthRange, weekRange, type Budget } from "@/lib/money";

export type BudgetRow = Budget & {
  category_id: string | null;
  name?: string | null;
  /** The envelope's categories (migration 0077). Missing = the old single category_id. */
  category_ids?: string[];
  rollover?: boolean | null;
  rollover_since?: string | null;
  started_on?: string | null;
};
export type LimitChange = { budget_id: string; limit_amount: number; effective_from: string };
/** The few fields of a transaction the math needs (finance Txn and budget BudgetTxn both fit). */
export type MoneyTxn = { type: "income" | "expense"; amount: number; category_id: string | null; localDate: string };

export type PeriodLine = {
  start: string;
  end: string;
  limit: number;
  /** What came in from the period before (+ unused, − overspent). 0 when rollover was not on. */
  carriedIn: number;
  available: number;
  spent: number;
  /** available − spent (negative = over). */
  left: number;
  /** True when the double-the-amount cap cut some of the carry. */
  capped: boolean;
  /** The part above the cap, given back to Spending money. */
  returned: number;
  rollover: boolean;
};

export type BudgetStatus = PeriodLine & { pct: number; range: { start: string; end: string } };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function periodRange(date: string, period: Budget["period"]) {
  return period === "weekly" ? weekRange(date) : monthRange(date);
}

/** The categories an envelope spends from. */
export function categoriesOf(b: BudgetRow): string[] {
  if (Array.isArray(b.category_ids)) return b.category_ids;
  return b.category_id ? [b.category_id] : [];
}

/** The name shown: the typed one, else the categories' names, else "Envelope". */
export function envelopeName(b: BudgetRow, catName: (id: string) => string | undefined) {
  if (b.name && b.name.trim()) return b.name.trim();
  const names = categoriesOf(b).map(catName).filter(Boolean);
  return names.length ? names.join(" + ") : "Envelope";
}

/** The limit a period had: the latest change on or before its start, else the earliest one, else the budget's own. */
export function limitFor(budget: Budget, changes: LimitChange[], start: string) {
  const mine = changes.filter((c) => c.budget_id === budget.id).sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  if (!mine.length) return budget.limit_amount;
  let hit = mine[0];
  for (const c of mine) if (c.effective_from <= start) hit = c;
  return Number(hit.limit_amount);
}

function spentIn(cats: Set<string>, txns: MoneyTxn[], range: { start: string; end: string }) {
  return round2(
    txns
      .filter((t) => t.type === "expense" && t.category_id !== null && cats.has(t.category_id) && t.localDate >= range.start && t.localDate < range.end)
      .reduce((s, t) => s + t.amount, 0)
  );
}

/** Period starts from `from` up to the period containing `today` (both normalized to period starts). */
function starts(period: Budget["period"], from: string, today: string) {
  const last = periodRange(today, period).start;
  const out: string[] = [];
  let s = periodRange(from, period).start;
  for (let guard = 0; s <= last && guard < 600; guard++) {
    out.push(s);
    s = periodRange(period === "weekly" ? addDays(s, 7) : periodRange(s, period).end, period).start;
  }
  return out;
}

/** The chain of periods from `from` to today, oldest first, carrying as the rules say. */
function chain(budget: BudgetRow, txns: MoneyTxn[], today: string, changes: LimitChange[], from: string): PeriodLine[] {
  const since = budget.rollover && budget.rollover_since ? periodRange(budget.rollover_since, budget.period).start : null;
  const cats = new Set(categoriesOf(budget));
  const lines: PeriodLine[] = [];
  let carry = 0;
  for (const start of starts(budget.period, from, today)) {
    const range = periodRange(start, budget.period);
    const limit = limitFor(budget, changes, start);
    const on = !!since && start >= since;
    const carriedIn = on ? round2(carry) : 0;
    const raw = round2(limit + carriedIn);
    const cap = round2(limit * 2);
    const available = on ? Math.min(raw, cap) : limit;
    const returned = on && raw > cap ? round2(raw - cap) : 0;
    const spent = spentIn(cats, txns, range);
    const left = round2(available - spent);
    lines.push({ start, end: range.end, limit, carriedIn, available, spent, left, capped: returned > 0, returned, rollover: on });
    carry = on ? left : 0;
  }
  return lines;
}

/**
 * The periods shown for an envelope, oldest first: the last `count` ones (never before it started) and, with
 * rollover on, enough earlier ones to carry correctly from the month it was turned on.
 */
export function budgetPeriods(budget: BudgetRow, txns: MoneyTxn[], today: string, changes: LimitChange[] = [], count = 6): PeriodLine[] {
  const current = periodRange(today, budget.period).start;
  const all = starts(budget.period, budget.started_on ?? current, today);
  const windowStart = all[Math.max(0, all.length - count)] ?? current;
  const since = budget.rollover && budget.rollover_since ? periodRange(budget.rollover_since, budget.period).start : null;
  const from = since && since < windowStart ? since : windowStart;
  return chain(budget, txns, today, changes, from).filter((l) => l.start >= windowStart);
}

/** The current period of an envelope: what is available, spent and left, and the % used (100+ = over). */
export function budgetStatus(budget: BudgetRow, txns: MoneyTxn[], today: string, changes: LimitChange[] = []): BudgetStatus {
  const lines = budgetPeriods(budget, txns, today, changes, 1);
  const cur = lines[lines.length - 1];
  const pct = cur.available > 0 ? Math.round((cur.spent / cur.available) * 100) : cur.spent > 0 || cur.available < 0 ? 100 : 0;
  return { ...cur, pct, range: { start: cur.start, end: cur.end } };
}

/** The last `count` periods, newest first (for the history under each envelope). */
export function budgetHistory(budget: BudgetRow, txns: MoneyTxn[], today: string, changes: LimitChange[] = [], count = 6) {
  return budgetPeriods(budget, txns, today, changes, count).reverse();
}

/**
 * What an envelope takes out of Spending money since the budget's start date (`txns` already limited to it):
 *   · a month with rollover off settles: it takes what was really spent; the current month holds its
 *     whole amount (or what was spent, when that is more);
 *   · months with rollover on take their amount minus what went back above the cap, plus any overspending
 *     the envelope has not paid back yet (that money is gone already).
 * So Spending money + every envelope's balance always add up to the real money.
 */
export function envelopeCharge(budget: BudgetRow, txns: MoneyTxn[], today: string, changes: LimitChange[], budgetStart: string): number {
  if (today < budgetStart) return 0;
  const startedOn = budget.started_on && budget.started_on > budgetStart ? budget.started_on : budgetStart;
  const lines = chain(budget, txns, today, changes, startedOn);
  let charge = 0;
  lines.forEach((l, i) => {
    const current = i === lines.length - 1;
    if (!l.rollover) charge += current ? Math.max(l.limit, l.spent) : l.spent;
    else charge += l.limit - l.returned;
  });
  const last = lines[lines.length - 1];
  if (last?.rollover && last.left < 0) charge += -last.left;
  return round2(charge);
}

/** First day of the period containing `today`: where a newly turned-on rollover, a new amount or a new envelope starts. */
export function currentPeriodStart(today: string, period: Budget["period"]) {
  return periodRange(today, period).start;
}
