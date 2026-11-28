// Budget with buckets (BL-117): every number on the screen comes from here, and so does the math line under it.
// Pure: no database. Savings, Fixed costs and Spending money are CALCULATED from transactions, never stored.
// Envelopes (27 Nov 2026, migration 0077) replace the old typed "extra buckets": each one takes its charge out of
// Spending money (worked out in lib/budget-rollover.ts), and spending in its categories is NOT counted again as
// Fixed costs or as spending (an envelope wins over Fixed costs).
// Budget v2 (BL-124, 27 Nov 2026): counted_category_ids is the WORK PAY (it gets the savings %); every other income
// still counts and goes straight to Spending money; balance adjustments count both ways; "Fix" corrections; the
// bills still due this month; and a real-money check against the account balances.
import { monthRange } from "@/lib/money";

export type BudgetSettings = {
  start_date: string; // YYYY-MM-DD, the day the budget was set up; earlier transactions do not count
  savings_percent: number;
  counted_category_ids: string[];
  opening_spending: number;
  opening_savings: number;
  savings_name: string;
  fixed_name: string;
  spending_name: string;
};

/** An envelope as the budget sees it: its categories and what it takes out of Spending money (envelopeCharge). */
export type EnvelopeInput = { id: string; name: string; categoryIds: string[]; monthly: number; charge: number };

export type BudgetTxn = {
  id: string;
  type: "income" | "expense";
  amount: number;
  category_id: string | null;
  description: string | null;
  localDate: string;
  payment_template_id: string | null;
};

export type Correction = { amount: number; target: "spending" | "savings" };
/** A transfer out of the savings account since the start date, and what the user said it was (null = not answered: used). */
export type SavingsWithdrawal = { id: string; amount: number; localDate: string; toAccountId: string; kind: "used" | "borrowed" | null };

export type BudgetInput = {
  settings: BudgetSettings;
  envelopes: EnvelopeInput[];
  txns: BudgetTxn[];
  skipped: ReadonlySet<string>;
  petsCategoryId: string | null;
  today: string;
  /** The Adjustment categories (both kinds): they count both ways, outside the other lines (BL-124 decision 11). */
  adjustmentIds?: ReadonlySet<string>;
  /** Fix corrections of the real-money check (BL-124 decision 9). */
  corrections?: Correction[];
  /** Scheduled payments still due until the end of this month (not in a set-aside envelope). */
  billsDue?: number;
  /** All accounts added up (null = not known). */
  accountsTotal?: number | null;
  /** The savings account's real balance (null = no savings account chosen). */
  savingsAccountBalance?: number | null;
  /** Transfers out of the savings account since the start date (BL-124 follow-up, migration 0080). */
  savingsWithdrawals?: SavingsWithdrawal[];
  /** The low month the plan is sized on (0 = no plan). */
  planIncome?: number;
  /** The first savings goal (0 = none). */
  cushionTarget?: number;
};

export type SavingRow = { txn: BudgetTxn; part: number; skipped: boolean };

export type BudgetResult = {
  monthsCounted: number;
  income: number;
  saved: number;
  fixed: number;
  fixedFromPayments: number;
  fixedFromPets: number;
  spent: number;
  /** One line per envelope: its monthly amount and what it took out of Spending money (`total`). */
  custom: { id: string; name: string; monthly: number; total: number }[];
  customTotal: number;
  /** Spending since the start date that came out of an envelope (not counted as fixed or spent). */
  envelopeRows: BudgetTxn[];
  spendingMoney: number;
  savingsTotal: number;
  incomeRows: SavingRow[];
  fixedRows: BudgetTxn[];
  spentRows: BudgetTxn[];
  skippedCount: number;
  /** Income outside the work pay (tips, cashback, found money): counts as money, no saving taken. */
  otherIncome: number;
  otherIncomeRows: BudgetTxn[];
  /** Balance adjustments: money found (+) and lost (−). */
  adjIn: number;
  adjOut: number;
  adjRows: BudgetTxn[];
  corrSpending: number;
  corrSavings: number;
  /** Spending money after the bills still due this month. */
  billsDue: number;
  afterBills: number;
  /** What the envelopes hold right now (their charge minus what was spent from them). */
  envelopesHeld: number;
  /** Spending money + Savings + envelopes: every dollar the budget accounts for. */
  budgetTotal: number;
  accountsTotal: number | null;
  /** accounts − budget (positive = the accounts hold more than the budget knows). Null when unknown. */
  gap: number | null;
  /** Savings in the savings account, and what still has to be moved there (0 when it is all there). */
  inSavingsAccount: number | null;
  toMove: number;
  /** Taken out of savings and spent ("used", or not answered yet): lowers Savings, back in Spending money. */
  usedSavings: number;
  /** Taken out of savings to put back ("borrowed"): Savings stays, it is part of "to move". */
  borrowedSavings: number;
  /** Put into the savings account beyond what was asked: extra savings, taken from Spending money. */
  extraSaved: number;
  withdrawals: SavingsWithdrawal[];
  /** Work pay logged this calendar month, and the "good month" suggestion (BL-124 decision 12). */
  monthWorkPay: number;
  goodMonth: { extra: number; suggest: number } | null;
  cushion: { target: number; have: number; left: number; pct: number } | null;
  math: { spending: string; savings: string; fixed: string };
};

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "$12", "$12.50", "-$3" (no trailing .00). */
export function usd(n: number): string {
  const v = r2(n);
  const s = Math.abs(v) % 1 === 0 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2);
  return `${v < 0 ? "-" : ""}$${s}`;
}

/** Calendar months from the start month to today's month, both included (0 when the start is in the future). */
export function monthsSince(start: string, today: string): number {
  if (today < start) return 0;
  const [sy, sm] = start.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  return (ty - sy) * 12 + (tm - sm) + 1;
}

/** The part of one payment that is set aside. */
export function savingPart(amount: number, percent: number): number {
  return r2((amount * percent) / 100);
}

export function isFixed(t: BudgetTxn, petsCategoryId: string | null): boolean {
  return t.type === "expense" && (t.payment_template_id !== null || (petsCategoryId !== null && t.category_id === petsCategoryId));
}

export function computeBudget(input: BudgetInput): BudgetResult {
  const { settings: s, envelopes, txns, skipped, petsCategoryId, today } = input;
  const adj = input.adjustmentIds ?? new Set<string>();
  const isAdj = (t: BudgetTxn) => t.category_id !== null && adj.has(t.category_id);
  const inEnvelope = new Set(envelopes.flatMap((e) => e.categoryIds));
  const enveloped = (t: BudgetTxn) => t.type === "expense" && t.category_id !== null && inEnvelope.has(t.category_id) && !isAdj(t);
  const counted = new Set(s.counted_category_ids);
  const since = txns.filter((t) => t.localDate >= s.start_date && t.localDate <= today);

  // Work pay: gets the savings percentage (and feeds percentage envelopes)
  const incomeRows: SavingRow[] = since
    .filter((t) => t.type === "income" && t.category_id !== null && counted.has(t.category_id))
    .map((t) => {
      const isSkipped = skipped.has(t.id);
      return { txn: t, part: isSkipped ? 0 : savingPart(t.amount, s.savings_percent), skipped: isSkipped };
    });
  const income = r2(incomeRows.reduce((n, r) => n + r.txn.amount, 0));
  const saved = r2(incomeRows.reduce((n, r) => n + r.part, 0));
  const skippedCount = incomeRows.filter((r) => r.skipped).length;

  // Every other income still counts (decision 1); adjustments count both ways (decision 11)
  const otherIncomeRows = since.filter((t) => t.type === "income" && !isAdj(t) && !(t.category_id !== null && counted.has(t.category_id)));
  const otherIncome = r2(otherIncomeRows.reduce((n, t) => n + t.amount, 0));
  const adjRows = since.filter(isAdj);
  const adjIn = r2(adjRows.filter((t) => t.type === "income").reduce((n, t) => n + t.amount, 0));
  const adjOut = r2(adjRows.filter((t) => t.type === "expense").reduce((n, t) => n + t.amount, 0));

  const envelopeRows = since.filter(enveloped);
  const fixedRows = since.filter((t) => !enveloped(t) && !isAdj(t) && isFixed(t, petsCategoryId));
  const fixedFromPayments = r2(fixedRows.filter((t) => t.payment_template_id !== null).reduce((n, t) => n + t.amount, 0));
  const fixedFromPets = r2(fixedRows.filter((t) => t.payment_template_id === null).reduce((n, t) => n + t.amount, 0));
  const fixed = r2(fixedFromPayments + fixedFromPets);
  const spentRows = since.filter((t) => t.type === "expense" && !enveloped(t) && !isAdj(t) && !isFixed(t, petsCategoryId));
  const spent = r2(spentRows.reduce((n, t) => n + t.amount, 0));

  const months = monthsSince(s.start_date, today);
  const custom = envelopes.map((e) => ({ id: e.id, name: e.name, monthly: e.monthly, total: r2(e.charge) }));
  const customTotal = r2(custom.reduce((n, c) => n + c.total, 0));
  const envelopesHeld = r2(
    envelopes.reduce((n, e) => {
      const cats = new Set(e.categoryIds);
      const out = envelopeRows.filter((t) => t.category_id !== null && cats.has(t.category_id)).reduce((m, t) => m + t.amount, 0);
      return n + e.charge - out;
    }, 0)
  );

  const corrections = input.corrections ?? [];
  const corrSpending = r2(corrections.filter((c) => c.target === "spending").reduce((n, c) => n + c.amount, 0));
  const corrSavings = r2(corrections.filter((c) => c.target === "savings").reduce((n, c) => n + c.amount, 0));

  // Savings and the savings account (BL-124 follow-up): a "used" withdrawal lowers Savings and gives the money back to
  // Spending money; a "borrowed" one keeps Savings (it shows up in "to move"). Deposits first cover what is to move;
  // anything above that is extra savings, taken from Spending money. So Savings + Spending money stay the real money.
  const withdrawals = (input.savingsWithdrawals ?? []).filter((w) => w.localDate >= s.start_date && w.localDate <= today);
  const usedSavings = r2(withdrawals.filter((w) => w.kind !== "borrowed").reduce((n, w) => n + w.amount, 0));
  const borrowedSavings = r2(withdrawals.filter((w) => w.kind === "borrowed").reduce((n, w) => n + w.amount, 0));
  const savingsBase = r2(s.opening_savings + saved + corrSavings - usedSavings);
  const inSavingsAccount = input.savingsAccountBalance ?? null;
  const extraSaved = inSavingsAccount === null ? 0 : r2(Math.max(0, inSavingsAccount - savingsBase));
  const toMove = inSavingsAccount === null ? 0 : r2(Math.max(0, savingsBase - inSavingsAccount));

  const spendingMoney = r2(s.opening_spending + income + otherIncome + adjIn - adjOut - saved - fixed - spent - customTotal + corrSpending + usedSavings - extraSaved);
  const savingsTotal = r2(savingsBase + extraSaved);

  const billsDue = r2(Math.max(0, input.billsDue ?? 0));
  const afterBills = r2(spendingMoney - billsDue);
  const budgetTotal = r2(spendingMoney + savingsTotal + envelopesHeld);
  const accountsTotal = input.accountsTotal ?? null;
  const gap = accountsTotal === null || accountsTotal === undefined ? null : r2(accountsTotal - budgetTotal);

  const month = monthRange(today);
  const monthWorkPay = r2(incomeRows.filter((r) => r.txn.localDate >= month.start && r.txn.localDate < month.end).reduce((n, r) => n + r.txn.amount, 0));
  const plan = input.planIncome ?? 0;
  const goodMonth = plan > 0 && monthWorkPay > plan ? { extra: r2(monthWorkPay - plan), suggest: r2((monthWorkPay - plan) / 2) } : null;
  const target = input.cushionTarget ?? 0;
  const cushion =
    target > 0
      ? { target, have: savingsTotal, left: r2(Math.max(0, target - savingsTotal)), pct: Math.max(0, Math.min(100, Math.round((savingsTotal / target) * 100))) }
      : null;

  const sp: string[] = [`${s.spending_name} = `];
  const parts: string[] = [];
  if (s.opening_spending !== 0) parts.push(`${usd(s.opening_spending)} start`);
  parts.push(`${usd(income)} income`);
  if (otherIncome !== 0) parts.push(`${usd(otherIncome)} other income`);
  if (adjIn !== 0) parts.push(`${usd(adjIn)} found (adjustments)`);
  const body =
    parts.join(" + ") +
    ` − ${usd(saved)} ${s.savings_name.toLowerCase() === "savings" ? "saved" : `to ${s.savings_name}`}` +
    ` − ${usd(fixed)} fixed` +
    ` − ${usd(spent)} spent` +
    (adjOut !== 0 ? ` − ${usd(adjOut)} lost (adjustments)` : "") +
    custom.map((c) => ` − ${usd(c.total)} ${c.name}`).join("") +
    (corrSpending > 0 ? ` + ${usd(corrSpending)} fixes` : corrSpending < 0 ? ` − ${usd(-corrSpending)} fixes` : "") +
    (usedSavings !== 0 ? ` + ${usd(usedSavings)} taken from ${s.savings_name}` : "") +
    (extraSaved !== 0 ? ` − ${usd(extraSaved)} extra to ${s.savings_name}` : "");
  sp.push(body, ` = ${usd(spendingMoney)}`);

  const savingsMath =
    `${s.savings_name} = ` +
    (s.opening_savings !== 0 ? `${usd(s.opening_savings)} start + ` : "") +
    `${usd(saved)} set aside (${s.savings_percent}% of ${usd(income - incomeRows.filter((r) => r.skipped).reduce((n, r) => n + r.txn.amount, 0))} income` +
    (skippedCount > 0 ? `, ${skippedCount} skipped` : "") +
    `)` +
    (corrSavings > 0 ? ` + ${usd(corrSavings)} fixes` : corrSavings < 0 ? ` − ${usd(-corrSavings)} fixes` : "") +
    (usedSavings !== 0 ? ` − ${usd(usedSavings)} used` : "") +
    (extraSaved !== 0 ? ` + ${usd(extraSaved)} extra put in` : "") +
    ` = ${usd(savingsTotal)}`;

  const fixedMath = `${s.fixed_name} = ${usd(fixedFromPayments)} from recurring payments + ${usd(fixedFromPets)} from Pets = ${usd(fixed)}`;

  return {
    monthsCounted: months,
    income,
    saved,
    fixed,
    fixedFromPayments,
    fixedFromPets,
    spent,
    custom,
    customTotal,
    envelopeRows,
    spendingMoney,
    savingsTotal,
    incomeRows,
    fixedRows,
    spentRows,
    skippedCount,
    otherIncome,
    otherIncomeRows,
    adjIn,
    adjOut,
    adjRows,
    corrSpending,
    corrSavings,
    billsDue,
    afterBills,
    envelopesHeld,
    budgetTotal,
    accountsTotal,
    gap,
    inSavingsAccount,
    toMove,
    usedSavings,
    borrowedSavings,
    extraSaved,
    withdrawals,
    monthWorkPay,
    goodMonth,
    cushion,
    math: { spending: sp.join(""), savings: savingsMath, fixed: fixedMath },
  };
}

/**
 * Bills still due this month (BL-124 decision 8): unpaid payment events from the 1st to the end of `today`'s month
 * (overdue ones too: they are still owed). Payments whose category sits in a set-aside envelope are skipped, since
 * that envelope already holds their money. Income payments are skipped.
 */
export function billsDueThisMonth(
  events: { event_date: string; payment_status: string | null; payment_expected_amount: number | null; template: { type: string; expected_amount: number | null; category_id: string | null } | null }[],
  today: string,
  heldCategoryIds: ReadonlySet<string>
): { total: number; count: number } {
  const m = monthRange(today);
  const rows = events.filter(
    (e) =>
      !e.payment_status &&
      e.event_date >= m.start &&
      e.event_date < m.end &&
      e.template?.type !== "income" &&
      !(e.template?.category_id && heldCategoryIds.has(e.template.category_id))
  );
  const total = r2(rows.reduce((n, e) => n + Number(e.payment_expected_amount ?? e.template?.expected_amount ?? 0), 0));
  return { total, count: rows.length };
}

export type AffordItem = { id: string; name: string; price: number | null; kind: "need" | "want" };
export type Afford = { id: string; name: string; kind: "need" | "want"; price: number | null; state: "covered" | "short" | "noprice"; short: number };

/** Each item is checked on its own against the money left to spend (decision 15). Never blocks anything. */
export function affordNext(items: AffordItem[], spendingMoney: number): Afford[] {
  return items.map((i) => {
    if (i.price === null) return { id: i.id, name: i.name, kind: i.kind, price: null, state: "noprice" as const, short: 0 };
    const gap = r2(i.price - spendingMoney);
    return { id: i.id, name: i.name, kind: i.kind, price: i.price, state: gap <= 0 ? ("covered" as const) : ("short" as const), short: gap > 0 ? gap : 0 };
  });
}

/** Setup input checks, shared by the server action and the tests. Returns an error message or null. */
export function checkSetup(i: {
  start_date: string;
  savings_percent: number;
  opening_spending: number;
  opening_savings: number;
  names: [string, string, string];
  /** Old extra buckets (now envelopes); still checked when given. */
  buckets?: { name: string; monthly_amount: number }[];
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.start_date) || Number.isNaN(Date.parse(`${i.start_date}T12:00:00Z`))) return "Pick a valid start date.";
  if (!Number.isFinite(i.savings_percent) || i.savings_percent < 0 || i.savings_percent > 100) return "The saving percentage must be between 0 and 100.";
  if (!Number.isFinite(i.opening_spending) || !Number.isFinite(i.opening_savings)) return "Starting money must be a number.";
  if (Math.abs(i.opening_spending) > 1e9 || Math.abs(i.opening_savings) > 1e9) return "Starting money is too large.";
  for (const n of i.names) if (!n.trim() || n.trim().length > 40) return "Bucket names need 1 to 40 characters.";
  const extra = i.buckets ?? [];
  if (extra.length > 10) return "Up to 10 extra buckets.";
  for (const b of extra) {
    if (!b.name.trim() || b.name.trim().length > 40) return "Bucket names need 1 to 40 characters.";
    if (!Number.isFinite(b.monthly_amount) || b.monthly_amount < 0 || b.monthly_amount > 1e9) return "A bucket amount must be 0 or more.";
  }
  const all = [...i.names, ...extra.map((b) => b.name)].map((n) => n.trim().toLowerCase());
  if (new Set(all).size !== all.length) return "Two buckets have the same name.";
  return null;
}
