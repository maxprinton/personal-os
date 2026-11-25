// Tests of the budget math (BL-117): src/lib/budget/calc.ts (pure). Run: npm run test:budget
import assert from "node:assert/strict";
import { affordNext, checkSetup, computeBudget, isFixed, monthsSince, savingPart, usd, type BudgetSettings, type BudgetTxn } from "@/lib/budget/calc";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e instanceof Error ? e.message.split("\n").join("\n  ") : e}`);
  }
}

const GIGS = "cat-gigs";
const OTHER = "cat-other-income";
const PETS = "cat-pets";
const FOOD = "cat-food";
const base: BudgetSettings = {
  start_date: "2026-11-20",
  savings_percent: 10,
  counted_category_ids: [GIGS],
  opening_spending: 0,
  opening_savings: 0,
  savings_name: "Savings",
  fixed_name: "Fixed costs",
  spending_name: "Spending money",
};
let n = 0;
const tx = (type: "income" | "expense", amount: number, localDate: string, category_id: string | null, payment_template_id: string | null = null): BudgetTxn => ({
  id: `t${++n}`, type, amount, category_id, description: null, localDate, payment_template_id,
});
const run = (txns: BudgetTxn[], over: Partial<BudgetSettings> = {}, skipped: string[] = [], buckets: { id: string; name: string; monthly_amount: number }[] = [], today = "2026-11-25") =>
  computeBudget({ settings: { ...base, ...over }, buckets, txns, skipped: new Set(skipped), petsCategoryId: PETS, today });

test("saving is the percentage of each counted payment: 10% of 50 = 5", () => {
  assert.equal(savingPart(50, 10), 5);
  const r = run([tx("income", 50, "2026-11-21", GIGS)]);
  assert.equal(r.saved, 5);
  assert.equal(r.savingsTotal, 5);
  assert.equal(r.spendingMoney, 45);
});

test("only the chosen income categories count; other income is ignored, no saving taken", () => {
  const r = run([tx("income", 100, "2026-11-21", OTHER), tx("income", 40, "2026-11-22", GIGS)]);
  assert.equal(r.income, 40);
  assert.equal(r.saved, 4);
  assert.equal(r.spendingMoney, 36);
});

test("a skipped payment sets nothing aside and can be seen as skipped", () => {
  const a = tx("income", 100, "2026-11-21", GIGS);
  const b = tx("income", 100, "2026-11-22", GIGS);
  const r = run([a, b], {}, [a.id]);
  assert.equal(r.saved, 10);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.spendingMoney, 190);
  assert.match(r.math.savings, /1 skipped/);
});

test("transactions before the start date or after today do not count", () => {
  const r = run([tx("income", 100, "2026-11-19", GIGS), tx("expense", 30, "2026-11-10", FOOD), tx("income", 100, "2026-11-30", GIGS), tx("income", 20, "2026-11-20", GIGS)]);
  assert.equal(r.income, 20);
  assert.equal(r.spent, 0);
});

test("fixed costs = payments from a recurring template + the Pets category; other expenses are spending", () => {
  const rows = [tx("expense", 12, "2026-11-21", null, "tpl-netflix"), tx("expense", 30, "2026-11-22", PETS), tx("expense", 8, "2026-11-23", FOOD)];
  assert.equal(isFixed(rows[0], PETS), true);
  assert.equal(isFixed(rows[1], PETS), true);
  assert.equal(isFixed(rows[2], PETS), false);
  const r = run(rows);
  assert.equal(r.fixed, 42);
  assert.equal(r.fixedFromPayments, 12);
  assert.equal(r.fixedFromPets, 30);
  assert.equal(r.spent, 8);
  assert.equal(r.spendingMoney, -50);
});

test("spending money = start + income − saved − fixed − spent, shown as negative, never blocking", () => {
  const r = run([tx("income", 120, "2026-11-21", GIGS), tx("expense", 70, "2026-11-22", PETS), tx("expense", 18, "2026-11-23", FOOD)], { opening_spending: 5 });
  assert.equal(r.spendingMoney, 5 + 120 - 12 - 70 - 18);
  assert.equal(r.math.spending, "Spending money = $5 start + $120 income − $12 saved − $70 fixed − $18 spent = $25");
  const neg = run([tx("expense", 10, "2026-11-21", FOOD)]);
  assert.equal(neg.spendingMoney, -10);
  assert.match(neg.math.spending, /= -\$10$/);
});

test("the math line always equals the number it explains", () => {
  const r = run([tx("income", 77.77, "2026-11-21", GIGS), tx("expense", 12.34, "2026-11-22", FOOD), tx("expense", 5.5, "2026-11-23", null, "tpl")], { opening_spending: 3, opening_savings: 20 });
  assert.ok(r.math.spending.endsWith(`= ${usd(r.spendingMoney)}`));
  assert.ok(r.math.savings.endsWith(`= ${usd(r.savingsTotal)}`));
  assert.ok(r.math.fixed.endsWith(`= ${usd(r.fixed)}`));
  assert.equal(r.savingsTotal, 20 + r.saved);
});

test("opening savings and opening spending are the starting point", () => {
  const r = run([], { opening_spending: 40, opening_savings: 15 });
  assert.equal(r.spendingMoney, 40);
  assert.equal(r.savingsTotal, 15);
});

test("no income and nothing logged: all zero, no error", () => {
  const r = run([]);
  assert.equal(r.spendingMoney, 0);
  assert.equal(r.savingsTotal, 0);
  assert.equal(r.fixed, 0);
  assert.equal(r.incomeRows.length, 0);
});

test("a changed or removed payment follows: the saved amount is recalculated, never orphaned", () => {
  const a = tx("income", 100, "2026-11-21", GIGS);
  assert.equal(run([a]).saved, 10);
  assert.equal(run([{ ...a, amount: 60 }]).saved, 6);
  assert.equal(run([]).saved, 0);
});

test("leftover carries over: one running total, no monthly reset", () => {
  const dec = run([tx("income", 100, "2026-11-21", GIGS), tx("expense", 20, "2026-11-22", FOOD)], {}, [], [], "2026-12-15");
  assert.equal(dec.spendingMoney, 100 - 10 - 20);
});

test("custom buckets set their typed amount aside every month since the start", () => {
  assert.equal(monthsSince("2026-11-20", "2026-11-25"), 1);
  assert.equal(monthsSince("2026-11-20", "2027-01-02"), 3);
  assert.equal(monthsSince("2026-11-20", "2026-11-19"), 0);
  const r = run([tx("income", 100, "2026-11-21", GIGS)], {}, [], [{ id: "b1", name: "Trip", monthly_amount: 15 }], "2026-12-05");
  assert.equal(r.customTotal, 30);
  assert.equal(r.spendingMoney, 100 - 10 - 30);
  assert.match(r.math.spending, /− \$30 Trip/);
});

test("afford-next: each item on its own against the money left; a cheaper want can be covered while a need is short", () => {
  const a = affordNext(
    [
      { id: "1", name: "Pants", price: 25, kind: "need" },
      { id: "2", name: "Headphones", price: 80, kind: "want" },
      { id: "3", name: "Cable", price: 5, kind: "want" },
      { id: "4", name: "Gift", price: null, kind: "want" },
    ],
    20
  );
  assert.deepEqual(a.map((x) => [x.state, x.short]), [["short", 5], ["short", 60], ["covered", 0], ["noprice", 0]]);
  assert.equal(affordNext([{ id: "1", name: "x", price: 5, kind: "need" }], -3)[0].short, 8);
});

test("setup checks: percentage range, dates, names, duplicates, amounts", () => {
  const ok = { start_date: "2026-11-24", savings_percent: 10, opening_spending: 0, opening_savings: 0, names: ["Savings", "Fixed costs", "Spending money"] as [string, string, string], buckets: [] };
  assert.equal(checkSetup(ok), null);
  assert.ok(checkSetup({ ...ok, savings_percent: 101 }));
  assert.ok(checkSetup({ ...ok, savings_percent: -1 }));
  assert.ok(checkSetup({ ...ok, savings_percent: Number.NaN }));
  assert.ok(checkSetup({ ...ok, start_date: "24/11/2026" }));
  assert.ok(checkSetup({ ...ok, names: ["", "Fixed costs", "Spending money"] }));
  assert.ok(checkSetup({ ...ok, buckets: [{ name: "savings", monthly_amount: 5 }] }));
  assert.ok(checkSetup({ ...ok, buckets: [{ name: "Trip", monthly_amount: -5 }] }));
  assert.equal(checkSetup({ ...ok, savings_percent: 0 }), null);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
