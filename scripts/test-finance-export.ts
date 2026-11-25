// BL-119: CSV export of transactions, transfers and balance snapshots.
import { readFileSync } from "node:fs";
import { buildLedger } from "@/lib/finance-ledger";
import { balancesFor, buildExportRows, exportCsv, EXPORT_COLUMNS, parseExportQuery, safeCell, type ExportInput } from "@/lib/finance-export";
import type { Transfer, Txn } from "@/lib/money";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : (fail++, console.error("FAIL", name)); };
const day = (d: string, h = 12) => `${d}T${String(h).padStart(2, "0")}:00:00Z`;

const accounts = [{ id: "A", name: "Cash" }, { id: "B", name: "Pichincha" }];
const categories = [{ id: "c-food", name: "Food" }, { id: "c-gig", name: "Gigs" }];
const t = (id: string, account_id: string | null, type: "income" | "expense", amount: number, date: string, category_id: string | null = null, description: string | null = null): Txn =>
  ({ id, account_id, category_id, type, amount, description, occurred_at: day(date), localDate: date });
const tr = (id: string, from: string, to: string, amount: number, date: string, note: string | null = null): Transfer =>
  ({ id, from_account_id: from, to_account_id: to, amount, note, occurred_at: day(date, 13), localDate: date });
const snap = (id: string, account_id: string, amount: number, date: string) => ({ id, account_id, amount, recorded_at: day(date, 8), localDate: date });

const base: ExportInput = {
  accounts, categories,
  snapshots: [snap("s1", "A", 100, "2026-11-01")],
  txns: [
    t("t0", "A", "expense", 5, "2026-10-20", "c-food", "old lunch"),          // before the snapshot
    t("t1", "A", "income", 200, "2026-11-02", "c-gig", "client, \"big\" job"),
    t("t2", "A", "expense", 30, "2026-11-03", "c-food", "=SUM(A1)"),
    t("t3", "B", "income", 50, "2026-11-04", "c-gig"),
    t("t4", null, "expense", 9, "2026-11-05", "c-food", "no account yet"),
  ],
  transfers: [tr("x1", "A", "B", 50, "2026-11-06", "to bank")],
};

// 1 header and column order
const all = buildExportRows(base);
const csv = exportCsv(all);
ok("header is exactly the listed columns", csv.replace(/^﻿/, "").split("\r\n")[0] === "date,account,type,amount,category,description,other_account,balance");
ok("columns constant order", EXPORT_COLUMNS.join(",") === "date,account,type,amount,category,description,other_account,balance");
// 2 escaping and formula protection
ok("commas and quotes are escaped", csv.includes('"client, ""big"" job"'));
ok("a cell starting with = is neutralized", csv.includes("'=SUM(A1)") && !/,=SUM/.test(csv));
ok("safeCell leaves normal text alone", safeCell("Food") === "Food" && safeCell("-x") === "'-x");
ok("negative amounts are not prefixed", /,-30\.00,/.test(csv));
// 3 a transfer is two rows
const xs = all.filter((r) => r.type.startsWith("transfer"));
ok("transfer gives two rows", xs.length === 2);
const out = xs.find((r) => r.type === "transfer out")!, inn = xs.find((r) => r.type === "transfer in")!;
ok("out row on source with other account", out.account === "Cash" && out.amount === "-50.00" && out.other_account === "Pichincha");
ok("in row on destination with other account", inn.account === "Pichincha" && inn.amount === "50.00" && inn.other_account === "Cash");
// 4 transfers are not income or expense
ok("no income/expense row for the transfer", all.filter((r) => r.type === "income" || r.type === "expense").every((r) => r.description !== "to bank"));
// 5 balances equal the account page's math (snapshot 100, +200, -30, -50 transfer out = 220)
const ledgerA = buildLedger("A", base.snapshots, base.txns, base.transfers);
const balA = balancesFor(ledgerA);
ok("last balance of Cash is 220", all.filter((r) => r.account === "Cash" && r.balance !== "")[0].balance === "220.00");
ok("balance after the income is 300", all.find((r) => r.id === "t1")!.balance === "300.00");
ok("a row before the snapshot has no balance", all.find((r) => r.id === "t0")!.balance === "");
ok("Pichincha: no snapshot, starts at zero: +50 income +50 transfer = 100", all.filter((r) => r.account === "Pichincha")[0].balance === "100.00");
ok("balancesFor marks pre-snapshot rows null", balA.get("txn:t0") === null);
// 6 per-account file
const one = buildExportRows({ ...base, accountId: "A" });
ok("per account: only that account", one.every((r) => r.account === "Cash"));
ok("per account: includes the snapshot", one.some((r) => r.type === "balance snapshot" && r.amount === "100.00" && r.balance === "100.00"));
ok("all accounts: no snapshot rows", !all.some((r) => r.type === "balance snapshot"));
ok("all accounts: includes payments with no account", all.some((r) => r.account === "(no account)" && r.balance === ""));
ok("per account: no payments without an account", !one.some((r) => r.account === "(no account)"));
// 7 date range, both ends in the user's day
const range = buildExportRows({ ...base, from: "2026-11-02", to: "2026-11-03" });
ok("range includes both end days and nothing else", range.map((r) => r.id).sort().join() === "t1,t2");
// 8 filters
ok("type income", buildExportRows({ ...base, type: "income" }).every((r) => r.type === "income"));
ok("type expense", buildExportRows({ ...base, type: "expense" }).every((r) => r.type === "expense"));
ok("type transfer", buildExportRows({ ...base, type: "transfer" }).every((r) => r.type.startsWith("transfer")));
ok("category filter returns only that category and no transfers", buildExportRows({ ...base, categoryId: "c-food" }).every((r) => r.category === "Food"));
ok("filters intersect", buildExportRows({ ...base, accountId: "A", type: "expense", categoryId: "c-food", from: "2026-11-01" }).map((r) => r.id).join() === "t2");
// 9 deleted rows never arrive: the route asks the database only for deleted_at is null
const route = readFileSync(new URL("../src/app/api/export/transactions/route.ts", import.meta.url), "utf8");
ok("route reads only non-deleted rows", (route.match(/\.is\("deleted_at", null\)/g) ?? []).length >= 3);
// 10 empty range: header only, BOM first
const empty = exportCsv(buildExportRows({ ...base, from: "2030-01-01", to: "2030-01-31" }));
ok("empty range is header only", empty.replace(/^﻿/, "").trim().split("\r\n").length === 1);
ok("file starts with the BOM", csv.charCodeAt(0) === 0xfeff);
// 11 route safety
ok("route refuses a signed-out request", /getUser\(\)/.test(route) && /status: 401/.test(route));
ok("route filters every table by user_id", (route.match(/eq\("user_id", user/g) ?? []).length >= 2 && /\.eq\("user_id", user!\.id\)/.test(route));
ok("route pages past 1000 rows", /range\(from, from \+ PAGE - 1\)/.test(route));
// query parsing
const pq = (s: string) => parseExportQuery(new URLSearchParams(s));
ok("query: valid", !("error" in pq("from=2026-11-01&to=2026-11-30&type=transfer")));
ok("query: bad date", "error" in pq("from=2026-13-45"));
ok("query: from after to", "error" in pq("from=2026-12-01&to=2026-11-01"));
ok("query: bad type", "error" in pq("type=zzz"));
ok("query: empty dates mean no limit", (() => { const r = pq("from=&to="); return !("error" in r) && r.from === null && r.to === null; })());

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
