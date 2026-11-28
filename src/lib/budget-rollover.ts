// Category budgets with optional rollover, and their period-by-period history (pure: no database).
// Rules (decided 27 Nov 2026, migration 0076):
//   · Rollover is a per-budget switch. Off: every period starts at its limit (as before).
//   · On: what is left at the end of a period (or what you went over) carries into the next one.
//   · Available in a period = its limit + what carried in, never more than DOUBLE that period's limit.
//     It can go below zero (overspending you are still paying back).
//   · The carry starts in the period the switch was turned on (rollover_since); before that nothing carries.
//   · Each period uses the limit it had (budget_limit_changes); a change applies to its whole period.
import { addDays } from "@/lib/time";
import { inRange, monthRange, weekRange, type Budget, type Txn } from "@/lib/money";

export type BudgetRow = Budget & {
  rollover?: boolean | null;
  rollover_since?: string | null;
  started_on?: string | null;
};
export type LimitChange = { budget_id: string; limit_amount: number; effective_from: string };

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
  /** True when the double-the-limit cap cut some of the carry. */
  capped: boolean;
  rollover: boolean;
};

export type BudgetStatus = PeriodLine & { pct: number; range: { start: string; end: string } };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function periodRange(date: string, period: Budget["period"]) {
  return period === "weekly" ? weekRange(date) : monthRange(date);
}

/** The limit a period had: the latest change on or before its start, else the earliest one, else the budget's own. */
export function limitFor(budget: Budget, changes: LimitChange[], start: string) {
  const mine = changes.filter((c) => c.budget_id === budget.id).sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  if (!mine.length) return budget.limit_amount;
  let hit = mine[0];
  for (const c of mine) if (c.effective_from <= start) hit = c;
  return Number(hit.limit_amount);
}

function spentIn(budget: Budget, txns: Txn[], range: { start: string; end: string }) {
  return round2(
    txns.filter((t) => t.type === "expense" && t.category_id === budget.category_id && inRange(t, range)).reduce((s, t) => s + t.amount, 0)
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

/**
 * Every period from the earliest one needed up to today, oldest first: the history window
 * (`count` periods, never before the budget started) and, with rollover on, everything since it was turned on.
 */
export function budgetPeriods(budget: BudgetRow, txns: Txn[], today: string, changes: LimitChange[] = [], count = 6): PeriodLine[] {
  const current = periodRange(today, budget.period).start;
  const all = starts(budget.period, budget.started_on ?? current, today);
  const windowStart = all[Math.max(0, all.length - count)] ?? current;
  const since = budget.rollover && budget.rollover_since ? periodRange(budget.rollover_since, budget.period).start : null;
  const from = since && since < windowStart ? since : windowStart;

  const lines: PeriodLine[] = [];
  let carry = 0;
  for (const start of starts(budget.period, from, today)) {
    const range = periodRange(start, budget.period);
    const limit = limitFor(budget, changes, start);
    const on = !!since && start >= since;
    const carriedIn = on ? round2(carry) : 0;
    const raw = round2(limit + carriedIn);
    const available = on ? Math.min(raw, round2(limit * 2)) : limit;
    const spent = spentIn(budget, txns, range);
    const left = round2(available - spent);
    lines.push({ start, end: range.end, limit, carriedIn, available, spent, left, capped: on && raw > limit * 2, rollover: on });
    carry = on ? left : 0;
  }
  return lines.filter((l) => l.start >= windowStart);
}

/** The current period of a budget: what is available, spent and left, and the % used (100+ = over). */
export function budgetStatus(budget: BudgetRow, txns: Txn[], today: string, changes: LimitChange[] = []): BudgetStatus {
  const lines = budgetPeriods(budget, txns, today, changes, 1);
  const cur = lines[lines.length - 1];
  const pct = cur.available > 0 ? Math.round((cur.spent / cur.available) * 100) : cur.spent > 0 || cur.available < 0 ? 100 : 0;
  return { ...cur, pct, range: { start: cur.start, end: cur.end } };
}

/** The last `count` periods, newest first (for the history under each budget). */
export function budgetHistory(budget: BudgetRow, txns: Txn[], today: string, changes: LimitChange[] = [], count = 6) {
  return budgetPeriods(budget, txns, today, changes, count).reverse();
}

/** First day of the period containing `today`: where a newly turned-on rollover, a new limit or a new period starts. */
export function currentPeriodStart(today: string, period: Budget["period"]) {
  return periodRange(today, period).start;
}
