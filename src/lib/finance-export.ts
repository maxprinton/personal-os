// BL-119: transactions, transfers and (for one account) balance snapshots as CSV.
// Built on buildLedger so the balances are exactly the ones the account page shows.
import { buildLedger, type LedgerRow, type SnapshotWithDate } from "@/lib/finance-ledger";
import { toCsv } from "@/lib/files";
import type { Transfer, Txn } from "@/lib/money";

export const EXPORT_COLUMNS = ["date", "account", "type", "amount", "category", "description", "other_account", "balance"] as const;
export type ExportType = "all" | "income" | "expense" | "transfer";
export type ExportRow = { at: string; id: string; date: string; account: string; type: string; amount: string; category: string; description: string; other_account: string; balance: string };

export type ExportInput = {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  snapshots: SnapshotWithDate[];
  txns: Txn[];
  transfers: Transfer[];
  /** YYYY-MM-DD, inclusive, in the user's timezone. */
  from?: string | null;
  to?: string | null;
  /** One account (then its balance snapshots are included), or all of them. */
  accountId?: string | null;
  categoryId?: string | null;
  type?: ExportType;
};

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const NO_ACCOUNT = "(no account)";
const REMOVED = "(removed account)";

/** Running balance of each row of one account (oldest to newest). Rows already counted in the latest balance snapshot have none. */
export function balancesFor(rows: LedgerRow[]): Map<string, number | null> {
  const asc = [...rows].reverse();
  const latest = [...rows].filter((r) => r.kind === "snapshot" && !r.beforeSnapshot)[0];
  let bal = latest ? latest.amount : 0;
  const out = new Map<string, number | null>();
  for (const r of asc) {
    const key = `${r.kind}:${r.id}`;
    if (r.beforeSnapshot) {
      out.set(key, null);
      continue;
    }
    if (r.kind === "snapshot") bal = r.amount;
    else if (r.kind === "transfer") bal += r.direction === "in" ? r.amount : -r.amount;
    else bal += r.direction === "in" ? r.amount : -r.amount;
    out.set(key, Math.round(bal * 100) / 100);
  }
  return out;
}

export function buildExportRows(input: ExportInput): ExportRow[] {
  const type = input.type ?? "all";
  const accName = new Map(input.accounts.map((a) => [a.id, a.name]));
  const catName = new Map(input.categories.map((c) => [c.id, c.name]));
  const inRange = (d: string) => (!input.from || d >= input.from) && (!input.to || d <= input.to);
  const accounts = input.accountId ? input.accounts.filter((a) => a.id === input.accountId) : input.accounts;
  const out: ExportRow[] = [];

  const wantTxn = (t: "income" | "expense") => type === "all" || type === t;

  for (const a of accounts) {
    const ledger = buildLedger(a.id, input.snapshots, input.txns, input.transfers);
    const bal = balancesFor(ledger);
    for (const r of ledger) {
      if (!inRange(r.localDate)) continue;
      const b = bal.get(`${r.kind}:${r.id}`);
      const balance = b === null || b === undefined ? "" : money(b);
      if (r.kind === "txn") {
        if (!wantTxn(r.type)) continue;
        if (input.categoryId && r.category_id !== input.categoryId) continue;
        out.push({
          at: r.at, id: r.id, date: r.localDate, account: a.name, type: r.type,
          amount: money(r.direction === "in" ? r.amount : -r.amount),
          category: r.category_id ? catName.get(r.category_id) ?? "" : "", description: r.description ?? "", other_account: "", balance,
        });
      } else if (r.kind === "transfer") {
        if (input.categoryId || !(type === "all" || type === "transfer")) continue;
        out.push({
          at: r.at, id: r.id, date: r.localDate, account: a.name, type: r.direction === "in" ? "transfer in" : "transfer out",
          amount: money(r.direction === "in" ? r.amount : -r.amount), category: "", description: r.note ?? "",
          other_account: accName.get(r.otherAccountId) ?? REMOVED, balance,
        });
      } else if (input.accountId && type === "all" && !input.categoryId) {
        out.push({ at: r.at, id: r.id, date: r.localDate, account: a.name, type: "balance snapshot", amount: money(r.amount), category: "", description: "Balance set", other_account: "", balance });
      }
    }
  }

  // Payments that have no account yet: only in the all-accounts file (they have no balance)
  if (!input.accountId) {
    for (const t of input.txns) {
      if (t.account_id || !inRange(t.localDate) || !wantTxn(t.type)) continue;
      if (input.categoryId && t.category_id !== input.categoryId) continue;
      out.push({
        at: t.occurred_at, id: t.id, date: t.localDate, account: NO_ACCOUNT, type: t.type, amount: money(t.type === "income" ? t.amount : -t.amount),
        category: t.category_id ? catName.get(t.category_id) ?? "" : "", description: t.description ?? "", other_account: "", balance: "",
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.account < b.account ? -1 : a.id < b.id ? -1 : 1));
}

/** Text cells that start like a formula are made harmless for Excel / Sheets. */
export const safeCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function exportCsv(rows: ExportRow[]): string {
  const body = rows.map((r) => ({
    date: r.date,
    account: safeCell(r.account),
    type: r.type,
    amount: r.amount,
    category: safeCell(r.category),
    description: safeCell(r.description),
    other_account: safeCell(r.other_account),
    balance: r.balance,
  }));
  return "﻿" + toCsv(body, [...EXPORT_COLUMNS]);
}

export type ExportQuery = { from: string | null; to: string | null; accountId: string | null; categoryId: string | null; type: ExportType };

/** Reads and checks the query string of the export link. */
export function parseExportQuery(q: URLSearchParams): ExportQuery | { error: string } {
  const date = (k: string) => {
    const v = (q.get(k) ?? "").trim();
    return v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined;
  };
  const from = date("from");
  const to = date("to");
  if (from === undefined) return { error: "The start date is not a valid date." };
  if (to === undefined) return { error: "The end date is not a valid date." };
  if (from && to && from > to) return { error: "The start date is after the end date." };
  const type = (q.get("type") ?? "all") || "all";
  if (!["all", "income", "expense", "transfer"].includes(type)) return { error: "Unknown type." };
  return { from, to, accountId: q.get("account") || null, categoryId: q.get("category") || null, type: type as ExportType };
}
