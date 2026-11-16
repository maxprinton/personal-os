// BL-101 (account page) and BL-28 (monthly summary): ledger, snapshot differences, summary numbers, texts, Telegram and cron.
// Fake database, nothing is sent. Run: npm run test:finance-bl
import { fakeDb, type Row } from "./fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transfer, Txn } from "@/lib/money";
import { buildLedger, filterLedger, ledgerMonths, monthSummary, snapshotDeltas, type SnapshotWithDate } from "@/lib/finance-ledger";
import { balanceBefore, diffText, nextMonth, prevMonth, summarizeMonth, summaryText, type SummaryData, type SummarySnapshot } from "@/lib/finance-summary";
import { loadSummaryData } from "@/lib/finance-summary-data";
import { isSummaryCommand, parseSummaryCommand, runFinanceSummaryCron } from "@/lib/bot/finance-summary";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const A = "acc-a";
const B = "acc-b";
const at = (d: string) => `${d}T15:00:00.000Z`;
let n = 0;
const tx = (date: string, type: "income" | "expense", amount: number, o: Partial<Txn & { worth_it: boolean | null }> = {}) => ({
  id: `t${++n}`, account_id: A, category_id: null, type, amount, description: null, occurred_at: at(date), localDate: date, ...o,
});
const tr = (date: string, from: string, to: string, amount: number): Transfer => ({ id: `r${++n}`, from_account_id: from, to_account_id: to, amount, note: null, occurred_at: at(date), localDate: date });
const snapA: SummarySnapshot = { id: "s1", account_id: A, amount: 700, recorded_at: "2026-10-15T12:00:00.000Z", localDate: "2026-10-15" };

const data: SummaryData = {
  accounts: [{ id: A, name: "Cash" }, { id: B, name: "Bank" }],
  categories: [{ id: "c-food", name: "Groceries" }, { id: "c-bus", name: "Transport" }],
  snapshots: [snapA],
  transfers: [tr("2026-10-25", B, A, 100)],
  txns: [
    tx("2026-10-05", "income", 1000),
    tx("2026-10-10", "expense", 200, { category_id: "c-food", description: "Supermarket", worth_it: true }),
    tx("2026-10-12", "expense", 50, { account_id: null }),
    tx("2026-10-20", "expense", 30, { category_id: "c-bus", worth_it: false }),
    tx("2026-11-02", "income", 500),
    tx("2026-11-03", "expense", 100, { category_id: "c-food" }),
    tx("2026-11-10", "expense", 40, { category_id: "c-bus" }),
    tx("2026-11-20", "expense", 999), // in the future: never counted in "so far"
  ],
};

// ——— BL-101: the account ledger ———
{
  const snaps: SnapshotWithDate[] = [{ ...snapA }];
  const rows = buildLedger(A, snaps, data.txns as Txn[], data.transfers);
  ok("ledger has this account's rows only", rows.every((r) => r.kind !== "txn" || r.account_id === A) && !rows.some((r) => r.kind === "txn" && r.localDate === "2026-10-12"));
  ok("ledger is newest first", rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at));
  ok("rows before the latest snapshot are flagged", rows.filter((r) => r.kind === "txn" && r.beforeSnapshot).length === 2, String(rows.filter((r) => r.beforeSnapshot).length));
  ok("rows after the snapshot are not flagged", rows.filter((r) => r.kind === "txn" && !r.beforeSnapshot).length === 5);
  const t = rows.find((r) => r.kind === "transfer");
  ok("incoming transfer shows the other account", t?.kind === "transfer" && t.direction === "in" && t.otherAccountId === B);
  const bRows = buildLedger(B, [], data.txns as Txn[], data.transfers);
  ok("the other account sees it as outgoing", bRows.length === 1 && bRows[0].kind === "transfer" && bRows[0].direction === "out" && bRows[0].otherAccountId === A);
  ok("no snapshot: nothing is flagged", bRows.every((r) => !r.beforeSnapshot));
  const snapRow = rows.find((r) => r.kind === "snapshot");
  ok("snapshot appears as a row and is not dimmed", snapRow?.kind === "snapshot" && snapRow.amount === 700 && !snapRow.beforeSnapshot);
  const old: SnapshotWithDate[] = [{ ...snapA, id: "s0", recorded_at: "2026-09-01T12:00:00.000Z", localDate: "2026-09-01" }, { ...snapA }];
  const rows2 = buildLedger(A, old, [], []);
  ok("an older snapshot is marked older", rows2.find((r) => r.id === "s0")?.beforeSnapshot === true && rows2.find((r) => r.id === "s1")?.beforeSnapshot === false);
  ok("empty account gives an empty list", buildLedger("nobody", snaps, [], []).length === 0);

  const names = { category: (id: string | null) => (id === "c-food" ? "Groceries" : id === "c-bus" ? "Transport" : ""), account: (id: string) => (id === B ? "Bank" : "Removed account") };
  const f = (o: Partial<{ month: string; type: "all" | "income" | "expense" | "transfer"; category: string; q: string }>) => filterLedger(rows, { month: "all", type: "all", category: "all", q: "", ...o }, names);
  ok("no filters: everything", f({}).length === rows.length);
  ok("month filter", f({ month: "2026-11" }).every((r) => r.localDate.startsWith("2026-11")) && f({ month: "2026-11" }).length === 4);
  ok("type: income", f({ type: "income" }).length === 2 && f({ type: "income" }).every((r) => r.kind === "txn" && r.type === "income"));
  ok("type: transfer", f({ type: "transfer" }).length === 1);
  ok("type filter hides snapshot rows", !f({ type: "expense" }).some((r) => r.kind === "snapshot"));
  ok("category filter", f({ category: "c-food" }).length === 2);
  ok("uncategorized filter", f({ category: "none" }).every((r) => r.kind === "txn" && r.category_id === null));
  ok("search by description", f({ q: "supermarket" }).length === 1);
  ok("search by category name", f({ q: "transport" }).length === 2);
  ok("search finds a transfer by the other account", f({ q: "bank" }).length === 1);
  ok("search by amount", f({ q: "500.00" }).length === 1);
  ok("search with no match", f({ q: "zzz" }).length === 0);
  ok("month picker + type together", f({ month: "2026-10", type: "expense" }).length === 2);

  const sm = monthSummary(rows, "2026-11");
  ok("header month: income, expense, net", sm.income === 500 && sm.expense === 1139 && sm.net === -639, JSON.stringify(sm));
  const so = monthSummary(rows, "2026-10");
  ok("header keeps transfers apart", so.transferIn === 100 && so.transferOut === 0 && so.income === 1000 && so.expense === 230, JSON.stringify(so));
  ok("months list includes the current month and is newest first", ledgerMonths(rows, "2026-12-01").join() === "2026-12,2026-11,2026-10");
}

// ——— BL-101: editing a transaction dated before a snapshot ———
{
  const cut = new Map([[A, "2026-10-15T12:00:00.000Z"]]);
  const old = { type: "expense" as const, amount: 200, account_id: A, occurred_at: at("2026-10-10") };
  ok("amount fixed before the snapshot → the snapshot is off by the difference", JSON.stringify(snapshotDeltas(old, { ...old, amount: 150 }, cut)) === JSON.stringify([{ accountId: A, delta: 50 }]));
  ok("an income edited the same way goes the other direction", snapshotDeltas({ ...old, type: "income" }, { ...old, type: "income", amount: 150 }, cut)[0].delta === -50);
  const after = { type: "expense" as const, amount: 100, account_id: A, occurred_at: at("2026-11-03") };
  ok("edit after the snapshot: no question (the balance moves by itself)", snapshotDeltas(after, { ...after, amount: 80 }, cut).length === 0);
  ok("no snapshot: no question", snapshotDeltas(old, { ...old, amount: 1 }, new Map()).length === 0);
  ok("no change: no question", snapshotDeltas(old, { ...old }, cut).length === 0);
  ok("no account: no question", snapshotDeltas({ ...old, account_id: null }, { ...old, account_id: null, amount: 1 }, cut).length === 0);
  const moved = snapshotDeltas(old, { ...old, account_id: B }, new Map([[A, "2026-10-15T12:00:00.000Z"], [B, "2026-10-15T12:00:00.000Z"]]));
  ok("moved to another account: both snapshots are asked", moved.length === 2 && moved.find((m) => m.accountId === A)?.delta === 200 && moved.find((m) => m.accountId === B)?.delta === -200, JSON.stringify(moved));
  const across = snapshotDeltas(after, { ...after, occurred_at: at("2026-10-10") }, cut);
  ok("date moved from after to before the snapshot: asked for the part now inside it", across.length === 1 && across[0].delta === -100, JSON.stringify(across));
}

// ——— BL-28: the summary ———
{
  ok("month helpers", nextMonth("2026-12") === "2027-01" && prevMonth("2026-01") === "2025-12" && prevMonth("2026-11") === "2026-10");
  const oct = summarizeMonth(data, "2026-10", "2026-11-15");
  ok("closed month: not partial", oct.partial === false && oct.throughDate === "2026-10-31");
  ok("totals leave transfers out", oct.totals.income === 1000 && oct.totals.expense === 280 && oct.totals.net === 720 && oct.totals.count === 4, JSON.stringify(oct.totals));
  ok("no earlier month: no comparison", oct.previous === null);
  ok("categories, largest first, no-account expense included", oct.categories.map((c) => c.name).join() === "Groceries,No category,Transport", oct.categories.map((c) => c.name).join());
  ok("category shares", oct.categories[0].pct === 71 && oct.categories[1].pct === 18 && oct.categories[2].pct === 11);
  ok("worth it: yes / no / not rated", oct.worth.yes.total === 200 && oct.worth.no.total === 30 && oct.worth.unrated.total === 50 && oct.worth.unrated.count === 1);
  ok("biggest 5 across income and expense", oct.biggest.map((b) => b.amount).join() === "1000,200,50,30");
  ok("transaction without account is counted in totals and reported", oct.withoutAccount === 1);
  const bal = (s: typeof oct, id: string) => s.balances.find((b) => b.accountId === id)!;
  ok("balance at month end = snapshot + later movements and transfers", bal(oct, A).balance === 770 && bal(oct, A).noSnapshot === false, JSON.stringify(oct.balances));
  ok("account with no snapshot: movements only, and it says so", bal(oct, B).balance === -100 && bal(oct, B).noSnapshot === true);
  ok("the account without a snapshot yet at that date", balanceBefore(A, "2026-10-01", data).noSnapshot === true);

  const nov = summarizeMonth(data, "2026-11", "2026-11-15");
  ok("open month: partial and counted through today", nov.partial === true && nov.throughDate === "2026-11-15" && nov.totals.expense === 140 && nov.totals.income === 500, JSON.stringify(nov.totals));
  ok("future transactions are not counted so far", nov.totals.count === 3);
  ok("open month compares with the same days of last month", nov.previous?.month === "2026-10" && nov.previous.expense === 250 && nov.previous.income === 1000, JSON.stringify(nov.previous));
  ok("balance now includes this month", nov.balances.find((b) => b.accountId === A)!.balance === 1130, JSON.stringify(nov.balances));
  const empty = summarizeMonth(data, "2026-08", "2026-11-15");
  ok("month with nothing logged", empty.totals.count === 0 && empty.categories.length === 0 && empty.previous === null);
  ok("empty month text says so, no tables", /No income or expenses/.test(summaryText(empty)) && !/Where it went/.test(summaryText(empty)));
  const only = summarizeMonth({ ...data, txns: [tx("2026-09-03", "income", 80)] }, "2026-09", "2026-11-15");
  ok("month with only income: no category block", only.totals.expense === 0 && only.categories.length === 0 && !/Where it went/.test(summaryText(only)));
  const many = summarizeMonth({ ...data, categories: Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, name: `Cat ${i}` })), txns: Array.from({ length: 8 }, (_, i) => tx("2026-09-05", "expense", 10 + i, { category_id: `k${i}` })) }, "2026-09", "2026-11-15");
  ok("more than 5 categories: the rest grouped as Other", many.categories.length === 6 && many.categories[5].name === "Other" && many.categories[5].total === 10 + 11 + 12, JSON.stringify(many.categories.map((c) => c.name)));

  ok("diff wording", diffText(140, 250, "last month") === "▼ $110.00 less than last month" && diffText(5, 5, "x") === "same as x" && diffText(10, 5, "x").startsWith("▲"));
  const text = summaryText(nov);
  ok("text: so far, comparison, categories, balances", /so far/.test(text) && /same days of last month/.test(text) && /Groceries: \$100\.00/.test(text) && /Cash: \$1,130\.00/.test(text) && /Balances now/.test(text));
  ok("text: closed month says month end and the unassigned note", /Balances at month end/.test(summaryText(oct)) && /1 transaction has no account/.test(summaryText(oct)) && /Bank: -\$100\.00 \(no balance set\)/.test(summaryText(oct)));
}

// ——— Telegram command ———
{
  const today = "2026-11-15";
  ok("summary → this month", parseSummaryCommand("summary", today)?.month === "2026-11" && parseSummaryCommand("/summary", today)?.month === "2026-11");
  ok("resumen works too", parseSummaryCommand("Resumen", today)?.month === "2026-11");
  ok("last month", parseSummaryCommand("summary last month", today)?.month === "2026-10" && parseSummaryCommand("resumen mes pasado", today)?.month === "2026-10");
  ok("a given month", parseSummaryCommand("summary 2026-09", today)?.month === "2026-09");
  ok("a future month or nonsense is rejected", parseSummaryCommand("summary 2027-01", today) === null && parseSummaryCommand("summary banana", today) === null);
  ok("not a summary command", !isSummaryCommand("my summary of the day is long") && !isSummaryCommand("spent 5 lunch") && isSummaryCommand("/summary last month"));
}

// ——— The 1st-of-month send ———
{
  const U = "u1";
  const rowsOf = (): Record<string, Row[]> => ({
    accounts: data.accounts.map((a) => ({ ...a, user_id: U, deleted_at: null })),
    categories: data.categories.map((c) => ({ ...c, user_id: U, deleted_at: null })),
    balance_snapshots: data.snapshots.map((s) => ({ id: s.id, account_id: s.account_id, amount: s.amount, recorded_at: s.recorded_at, user_id: U, deleted_at: null })),
    transfers: data.transfers.map((t) => ({ ...t, user_id: U, deleted_at: null })),
    transactions: data.txns.map((t) => ({ id: t.id, account_id: t.account_id, category_id: t.category_id, type: t.type, amount: t.amount, description: t.description, occurred_at: t.occurred_at, worth_it: (t as { worth_it?: boolean | null }).worth_it ?? null, user_id: U, deleted_at: null })),
  });
  const claims: string[] = [];
  const sent: string[] = [];
  const io = (allow = true) => ({ claim: async (_u: string, kind: string, ref: string) => (claims.push(`${kind}:${ref}`), allow), deliver: async (_c: number, t: string) => void sent.push(t) });
  const S = { user_id: U, telegram_chat_id: 5, timezone: "America/Guayaquil" };
  const db = () => fakeDb(rowsOf()) as unknown as SupabaseClient;

  const loaded = await loadSummaryData(db(), U, "America/Guayaquil");
  ok("loader reads everything with local dates", loaded.txns.length === 8 && loaded.txns[0].localDate !== undefined && loaded.snapshots[0].localDate === "2026-10-15" && loaded.transfers.length === 1);

  ok("not the 1st: nothing", (await runFinanceSummaryCron(db(), S, { date: "2026-11-15", minutes: 575 }, io())) === 0);
  ok("the 1st but before 09:30: nothing", (await runFinanceSummaryCron(db(), S, { date: "2026-11-01", minutes: 500 }, io())) === 0);
  ok("the 1st after the window: nothing", (await runFinanceSummaryCron(db(), S, { date: "2026-11-01", minutes: 700 }, io())) === 0);
  ok("nothing was claimed or sent in those cases", claims.length === 0 && sent.length === 0);
  const n1 = await runFinanceSummaryCron(db(), S, { date: "2026-11-01", minutes: 575 }, io());
  ok("the 1st at 09:30: one message for last month", n1 === 1 && sent.length === 1 && /October 2026/.test(sent[0]) && !/so far/.test(sent[0]), sent[0]?.slice(0, 40));
  ok("claimed once per month", claims.join() === "finance_summary:2026-10");
  const n2 = await runFinanceSummaryCron(db(), S, { date: "2026-11-01", minutes: 580 }, io(false));
  ok("already claimed: nothing sent again", n2 === 0 && sent.length === 1);
  const n3 = await runFinanceSummaryCron(db(), S, { date: "2027-01-01", minutes: 575 }, io());
  ok("a month with no transactions: stays quiet (and does not claim)", n3 === 0 && sent.length === 1 && claims.length === 2, `${claims.length}`);
  const n4 = await runFinanceSummaryCron(db(), S, { date: "2026-12-01", minutes: 575 }, io());
  ok("December 1st reports November", n4 === 1 && /November 2026/.test(sent[1]) && /Where it went/.test(sent[1]));
}

console.log(`\nfinance BL-101 + BL-28: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
