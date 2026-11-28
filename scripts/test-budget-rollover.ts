// Tests of category budgets with rollover and their history: src/lib/budget-rollover.ts (pure).
// Run: npm run test:budget-rollover
import assert from "node:assert/strict";
import { budgetHistory, budgetPeriods, budgetStatus, limitFor, type BudgetRow, type LimitChange } from "@/lib/budget-rollover";
import type { Txn } from "@/lib/money";

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

const FOOD = "cat-food";
let n = 0;
const spend = (date: string, amount: number, category = FOOD, type: Txn["type"] = "expense"): Txn => ({
  id: `t${++n}`,
  account_id: null,
  category_id: category,
  type,
  amount,
  description: null,
  occurred_at: `${date}T15:00:00Z`,
  localDate: date,
});
const food = (over: Partial<BudgetRow> = {}): BudgetRow => ({
  id: "b1",
  category_id: FOOD,
  limit_amount: 200,
  period: "monthly",
  rollover: true,
  rollover_since: "2026-01-01",
  started_on: "2026-01-01",
  ...over,
});

test("rollover off: every month starts at its limit", () => {
  const s = budgetStatus(food({ rollover: false }), [spend("2026-01-10", 50), spend("2026-02-03", 20)], "2026-02-15");
  assert.equal(s.available, 200);
  assert.equal(s.carriedIn, 0);
  assert.equal(s.spent, 20);
  assert.equal(s.left, 180);
  assert.equal(s.rollover, false);
});

test("off with an old rollover_since still stored: nothing carries", () => {
  const s = budgetStatus(food({ rollover: false, rollover_since: "2026-01-01" }), [spend("2026-01-10", 10)], "2026-02-15");
  assert.equal(s.available, 200);
});

test("unused money carries, capped at double the limit (the $200 Food example)", () => {
  const tx = [spend("2026-01-05", 50), spend("2026-02-05", 50), spend("2026-03-05", 50)];
  const feb = budgetStatus(food(), tx, "2026-02-20");
  assert.equal(feb.carriedIn, 150);
  assert.equal(feb.available, 350);
  const mar = budgetStatus(food(), tx, "2026-03-20");
  assert.equal(mar.carriedIn, 300);
  assert.equal(mar.available, 400);
  assert.equal(mar.capped, true);
  const apr = budgetStatus(food(), tx, "2026-04-02");
  assert.equal(apr.carriedIn, 350); // 400 available − 50 spent in March
  assert.equal(apr.available, 400);
});

test("overspending carries too and can go below zero (the $500 January example)", () => {
  const tx = [spend("2026-01-12", 500)];
  const feb = budgetStatus(food(), tx, "2026-02-01");
  assert.equal(feb.carriedIn, -300);
  assert.equal(feb.available, -100);
  assert.equal(feb.left, -100);
  assert.equal(feb.pct, 100); // already behind: shows as over
  const mar = budgetStatus(food(), tx, "2026-03-01");
  assert.equal(mar.carriedIn, -100);
  assert.equal(mar.available, 100);
});

test("counting starts in the period it was turned on", () => {
  const tx = [spend("2025-12-05", 10), spend("2026-01-05", 150)];
  const jan = budgetStatus(food({ started_on: "2025-12-01" }), tx, "2026-01-20");
  assert.equal(jan.carriedIn, 0); // December's unused $190 does not carry
  assert.equal(jan.available, 200);
  const feb = budgetStatus(food({ started_on: "2025-12-01" }), tx, "2026-02-20");
  assert.equal(feb.carriedIn, 50);
  assert.equal(feb.available, 250);
});

test("each month uses the limit it had", () => {
  const changes: LimitChange[] = [
    { budget_id: "b1", limit_amount: 200, effective_from: "2026-01-01" },
    { budget_id: "b1", limit_amount: 300, effective_from: "2026-02-01" },
  ];
  assert.equal(limitFor(food(), changes, "2026-01-01"), 200);
  assert.equal(limitFor(food(), changes, "2026-03-01"), 300);
  const feb = budgetStatus(food({ limit_amount: 300 }), [spend("2026-01-05", 100)], "2026-02-10", changes);
  assert.equal(feb.limit, 300);
  assert.equal(feb.carriedIn, 100);
  assert.equal(feb.available, 400);
});

test("a period before any recorded change uses the earliest change", () => {
  const changes: LimitChange[] = [{ budget_id: "b1", limit_amount: 120, effective_from: "2026-03-01" }];
  assert.equal(limitFor(food(), changes, "2026-01-01"), 120);
  assert.equal(limitFor(food(), [], "2026-01-01"), 200); // no changes: the budget's own limit
});

test("only expenses of that category count", () => {
  const tx = [spend("2026-01-05", 40), spend("2026-01-06", 99, "cat-fun"), spend("2026-01-07", 500, FOOD, "income")];
  assert.equal(budgetStatus(food(), tx, "2026-01-20").spent, 40);
});

test("weekly budgets roll week by week (Monday to Sunday)", () => {
  const w = food({ period: "weekly", limit_amount: 50, rollover_since: "2026-11-16", started_on: "2026-11-16" });
  const tx = [spend("2026-11-17", 20), spend("2026-11-22", 10), spend("2026-11-24", 5)];
  const s = budgetStatus(w, tx, "2026-11-27");
  assert.equal(s.start, "2026-11-23");
  assert.equal(s.carriedIn, 20);
  assert.equal(s.available, 70);
  assert.equal(s.left, 65);
});

test("history: last 6 months, newest first, never before the budget started", () => {
  const tx = [spend("2026-06-05", 10), spend("2026-11-05", 30)];
  const h = budgetHistory(food({ rollover: false, started_on: "2026-01-01" }), tx, "2026-11-20");
  assert.equal(h.length, 6);
  assert.deepEqual(h.map((l) => l.start), ["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01"]);
  assert.equal(h[0].spent, 30);
  assert.equal(h[5].spent, 10);
  const young = budgetHistory(food({ rollover: false, started_on: "2026-10-01" }), tx, "2026-11-20");
  assert.equal(young.length, 2);
});

test("history with rollover since before the window still carries correctly", () => {
  const tx = [spend("2026-01-05", 0.5)];
  const h = budgetPeriods(food(), tx, "2026-11-20", [], 2);
  assert.equal(h.length, 2);
  assert.equal(h[1].available, 400); // capped all along
});

test("a budget started this month has one period", () => {
  const h = budgetHistory(food({ started_on: "2026-11-01", rollover: false }), [], "2026-11-27");
  assert.equal(h.length, 1);
  assert.equal(h[0].available, 200);
});

test("pct: 0 with nothing spent, rounded with spending", () => {
  assert.equal(budgetStatus(food({ rollover: false }), [], "2026-01-10").pct, 0);
  assert.equal(budgetStatus(food({ rollover: false }), [spend("2026-01-02", 50)], "2026-01-10").pct, 25);
});

console.log(`budget rollover: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
