// Tests of category budgets with rollover and their history: src/lib/budget-rollover.ts (pure).
// Run: npm run test:budget-rollover
import assert from "node:assert/strict";
import { budgetHistory, budgetPeriods, budgetStatus, categoriesOf, envelopeCharge, envelopeName, goalProgress, limitFor, type BudgetRow, type LimitChange } from "@/lib/budget-rollover";
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
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
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

test("an envelope spends from all of its categories", () => {
  const e = food({ rollover: false, category_ids: [FOOD, "cat-fun"] });
  const tx = [spend("2026-01-05", 40), spend("2026-01-06", 10, "cat-fun"), spend("2026-01-07", 99, "cat-other")];
  assert.equal(budgetStatus(e, tx, "2026-01-20").spent, 50);
  assert.deepEqual(categoriesOf(food({ category_ids: [] })), []); // a plain pot
  assert.deepEqual(categoriesOf(food()), [FOOD]); // old single category
});

test("envelope name: typed, else its categories, else Envelope", () => {
  const names: Record<string, string> = { [FOOD]: "Food", "cat-fun": "Fun" };
  assert.equal(envelopeName(food({ name: " Trip " }), (id) => names[id]), "Trip");
  assert.equal(envelopeName(food({ category_ids: [FOOD, "cat-fun"] }), (id) => names[id]), "Food + Fun");
  assert.equal(envelopeName(food({ category_ids: [] }), (id) => names[id]), "Envelope");
});

test("charge, rollover off: past months take what was spent, this month holds its amount (or more if overspent)", () => {
  const e = food({ rollover: false });
  const tx = [spend("2026-01-05", 50), spend("2026-02-05", 260)];
  assert.equal(envelopeCharge(e, tx, "2026-01-20", [], "2026-01-01"), 200);
  assert.equal(envelopeCharge(e, tx, "2026-02-20", [], "2026-01-01"), 50 + 260);
  assert.equal(envelopeCharge(e, tx, "2026-03-02", [], "2026-01-01"), 50 + 260 + 200);
});

test("charge, rollover on: the amounts, minus what went back above the cap", () => {
  const tx = [spend("2026-01-05", 50), spend("2026-02-05", 50), spend("2026-03-05", 50)];
  // Jan 200 + Feb 200 + Mar (200 − 100 returned above the $400 cap) = 500 = $150 spent + $350 still in the envelope
  assert.equal(envelopeCharge(food(), tx, "2026-03-20", [], "2026-01-01"), 500);
  assert.equal(budgetStatus(food(), tx, "2026-03-20").left, 350);
});

test("charge, rollover on and overspent: the money already gone is taken too", () => {
  const tx = [spend("2026-01-12", 500)];
  assert.equal(envelopeCharge(food(), tx, "2026-01-20", [], "2026-01-01"), 500);
  assert.equal(envelopeCharge(food(), tx, "2026-02-10", [], "2026-01-01"), 500); // Feb's $200 pays back; still −$100
  assert.equal(envelopeCharge(food(), tx, "2026-03-10", [], "2026-01-01"), 600); // back to +$100 in the envelope
});

test("charge: nothing before the budget's start date, and an envelope newer than the budget starts in its own month", () => {
  assert.equal(envelopeCharge(food({ rollover: false }), [], "2026-01-20", [], "2026-02-01"), 0);
  assert.equal(envelopeCharge(food({ rollover: false, started_on: "2026-03-01" }), [], "2026-03-10", [], "2026-01-01"), 200);
});

// ---- Budget v2 (BL-124): percentage envelopes and goals ----
const WORK = "cat-work";
const FUN = "cat-fun";
const ctx = { workPayIds: new Set([WORK]), planIncome: 320 };
const funEnv = (over: Partial<BudgetRow> = {}): BudgetRow => ({
  id: "fun", category_id: FUN, category_ids: [FUN], limit_amount: 38, period: "monthly", rollover: true, rollover_since: "2026-12-01", started_on: "2026-12-01", percent: 12, ...over,
});

test("percentage envelope: 12% of each payment logged this month", () => {
  const tx = [spend("2026-12-05", 93, WORK, "income"), spend("2026-12-12", 93, WORK, "income"), spend("2026-12-13", 20, FUN)];
  const s = budgetStatus(funEnv(), tx, "2026-12-20", [], ctx);
  assert.equal(s.limit, 22.32);
  assert.equal(s.available, 22.32);
  assert.equal(s.left, 2.32);
});

test("percentage envelope: unused carries over, capped at double 12% of the $320 plan ($76.80)", () => {
  const tx = [spend("2026-12-05", 400, WORK, "income"), spend("2027-01-05", 400, WORK, "income")];
  const s = budgetStatus(funEnv(), tx, "2027-01-20", [], ctx);
  // Dec 48 kept; Jan 48 + 48 = 96 → capped at 96? the cap is 2 × max(48, 38.40) = 96
  assert.equal(s.available, 96);
  const low = [spend("2026-12-05", 100, WORK, "income"), spend("2027-01-05", 100, WORK, "income"), spend("2027-02-05", 300, WORK, "income")];
  // Dec 12, Jan 24, Feb 24 + 36 = 60 (cap 2 × max(36, 38.40) = 76.80): no cap yet
  assert.equal(budgetStatus(funEnv(), low, "2027-02-20", [], ctx).available, 60);
});

test("percentage envelope: an overspent month is refilled first by the next payments", () => {
  const tx = [spend("2026-12-05", 93, WORK, "income"), spend("2026-12-06", 30, FUN), spend("2027-01-05", 93, WORK, "income")];
  const dec = budgetStatus(funEnv(), tx, "2026-12-20", [], ctx);
  assert.equal(dec.left, r2(11.16 - 30));
  const jan = budgetStatus(funEnv(), tx, "2027-01-10", [], ctx);
  assert.equal(jan.available, r2(11.16 + 11.16 - 30)); // still behind
  assert.ok(jan.available < 0);
});

test("percentage envelope: rollover is always on, even with the switch off; no ctx falls back to the typed amount", () => {
  const tx = [spend("2026-12-05", 100, WORK, "income"), spend("2027-01-05", 100, WORK, "income")];
  assert.equal(budgetStatus(funEnv({ rollover: false, rollover_since: null }), tx, "2027-01-10", [], ctx).available, 24);
  assert.equal(budgetStatus(funEnv(), tx, "2026-12-10").available, 38);
});

test("percentage envelope charge = the shares that came in (what Spending money gives it)", () => {
  const tx = [spend("2026-12-05", 93, WORK, "income"), spend("2026-12-12", 93, WORK, "income"), spend("2026-12-13", 5, FUN)];
  assert.equal(envelopeCharge(funEnv(), tx, "2026-12-20", [], "2026-12-01", ctx), 22.32);
});

test("goal envelope: grows past double, stops at the target, the rest goes back", () => {
  const goal: BudgetRow = { id: "g", category_id: null, category_ids: [], limit_amount: 37, period: "monthly", rollover: true, rollover_since: "2026-12-01", started_on: "2026-12-01", target_amount: 220, target_date: "2027-05-31" };
  assert.equal(budgetStatus(goal, [], "2027-02-10").available, 111); // 3 × 37, past the old $74 cap
  const june = budgetStatus(goal, [], "2027-06-10");
  assert.equal(june.available, 220);
  assert.equal(envelopeCharge(goal, [], "2027-06-10", [], "2026-12-01"), 220);
  const p = goalProgress(goal, budgetStatus(goal, [], "2026-12-10"), "2026-12-10");
  assert.deepEqual(p, { target: 220, have: 37, left: 183, monthsLeft: 6, perMonth: 30.5, done: false, pct: 17 });
  assert.equal(goalProgress({ ...goal, target_amount: null }, june, "2027-06-10"), null);
});

console.log(`budget rollover: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
