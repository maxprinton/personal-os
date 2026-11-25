// Budget with buckets (BL-117): every number on the screen comes from here, and so does the math line under it.
// Pure: no database. Savings, Fixed costs and Spending money are CALCULATED from transactions, never stored.

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

export type CustomBucket = { id: string; name: string; monthly_amount: number };

export type BudgetTxn = {
  id: string;
  type: "income" | "expense";
  amount: number;
  category_id: string | null;
  description: string | null;
  localDate: string;
  payment_template_id: string | null;
};

export type BudgetInput = {
  settings: BudgetSettings;
  buckets: CustomBucket[];
  txns: BudgetTxn[];
  skipped: ReadonlySet<string>;
  petsCategoryId: string | null;
  today: string;
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
  custom: { id: string; name: string; monthly: number; total: number }[];
  customTotal: number;
  spendingMoney: number;
  savingsTotal: number;
  incomeRows: SavingRow[];
  fixedRows: BudgetTxn[];
  spentRows: BudgetTxn[];
  skippedCount: number;
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
  const { settings: s, buckets, txns, skipped, petsCategoryId, today } = input;
  const counted = new Set(s.counted_category_ids);
  const since = txns.filter((t) => t.localDate >= s.start_date && t.localDate <= today);

  const incomeRows: SavingRow[] = since
    .filter((t) => t.type === "income" && t.category_id !== null && counted.has(t.category_id))
    .map((t) => {
      const isSkipped = skipped.has(t.id);
      return { txn: t, part: isSkipped ? 0 : savingPart(t.amount, s.savings_percent), skipped: isSkipped };
    });
  const income = r2(incomeRows.reduce((n, r) => n + r.txn.amount, 0));
  const saved = r2(incomeRows.reduce((n, r) => n + r.part, 0));
  const skippedCount = incomeRows.filter((r) => r.skipped).length;

  const fixedRows = since.filter((t) => isFixed(t, petsCategoryId));
  const fixedFromPayments = r2(fixedRows.filter((t) => t.payment_template_id !== null).reduce((n, t) => n + t.amount, 0));
  const fixedFromPets = r2(fixedRows.filter((t) => t.payment_template_id === null).reduce((n, t) => n + t.amount, 0));
  const fixed = r2(fixedFromPayments + fixedFromPets);
  const spentRows = since.filter((t) => t.type === "expense" && !isFixed(t, petsCategoryId));
  const spent = r2(spentRows.reduce((n, t) => n + t.amount, 0));

  const months = monthsSince(s.start_date, today);
  const custom = buckets.map((b) => ({ id: b.id, name: b.name, monthly: b.monthly_amount, total: r2(b.monthly_amount * months) }));
  const customTotal = r2(custom.reduce((n, c) => n + c.total, 0));

  const spendingMoney = r2(s.opening_spending + income - saved - fixed - spent - customTotal);
  const savingsTotal = r2(s.opening_savings + saved);

  const sp: string[] = [`${s.spending_name} = `];
  const parts: string[] = [];
  if (s.opening_spending !== 0) parts.push(`${usd(s.opening_spending)} start`);
  parts.push(`${usd(income)} income`);
  const body =
    parts.join(" + ") +
    ` − ${usd(saved)} ${s.savings_name.toLowerCase() === "savings" ? "saved" : `to ${s.savings_name}`}` +
    ` − ${usd(fixed)} fixed` +
    ` − ${usd(spent)} spent` +
    custom.map((c) => ` − ${usd(c.total)} ${c.name}`).join("");
  sp.push(body, ` = ${usd(spendingMoney)}`);

  const savingsMath =
    `${s.savings_name} = ` +
    (s.opening_savings !== 0 ? `${usd(s.opening_savings)} start + ` : "") +
    `${usd(saved)} set aside (${s.savings_percent}% of ${usd(income - incomeRows.filter((r) => r.skipped).reduce((n, r) => n + r.txn.amount, 0))} income` +
    (skippedCount > 0 ? `, ${skippedCount} skipped` : "") +
    `) = ${usd(savingsTotal)}`;

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
    spendingMoney,
    savingsTotal,
    incomeRows,
    fixedRows,
    spentRows,
    skippedCount,
    math: { spending: sp.join(""), savings: savingsMath, fixed: fixedMath },
  };
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
  buckets: { name: string; monthly_amount: number }[];
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.start_date) || Number.isNaN(Date.parse(`${i.start_date}T12:00:00Z`))) return "Pick a valid start date.";
  if (!Number.isFinite(i.savings_percent) || i.savings_percent < 0 || i.savings_percent > 100) return "The saving percentage must be between 0 and 100.";
  if (!Number.isFinite(i.opening_spending) || !Number.isFinite(i.opening_savings)) return "Starting money must be a number.";
  if (Math.abs(i.opening_spending) > 1e9 || Math.abs(i.opening_savings) > 1e9) return "Starting money is too large.";
  for (const n of i.names) if (!n.trim() || n.trim().length > 40) return "Bucket names need 1 to 40 characters.";
  if (i.buckets.length > 10) return "Up to 10 extra buckets.";
  for (const b of i.buckets) {
    if (!b.name.trim() || b.name.trim().length > 40) return "Bucket names need 1 to 40 characters.";
    if (!Number.isFinite(b.monthly_amount) || b.monthly_amount < 0 || b.monthly_amount > 1e9) return "A bucket amount must be 0 or more.";
  }
  const all = [...i.names, ...i.buckets.map((b) => b.name)].map((n) => n.trim().toLowerCase());
  if (new Set(all).size !== all.length) return "Two buckets have the same name.";
  return null;
}
