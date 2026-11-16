// BL-101: everything about ONE account in a single list (pure, no database).
// Transactions, transfers and balance snapshots are merged, newest first. Rows dated before the latest
// snapshot are flagged: they are already counted inside it (see accountBalance in money.ts).
import { signed, type Snapshot, type Transfer, type Txn, type TxnType } from "@/lib/money";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SnapshotWithDate = Snapshot & { localDate: string };

export type LedgerRow =
  | {
      kind: "txn";
      id: string;
      at: string;
      localDate: string;
      type: TxnType;
      amount: number;
      description: string | null;
      category_id: string | null;
      account_id: string | null;
      direction: "in" | "out";
      beforeSnapshot: boolean;
    }
  | {
      kind: "transfer";
      id: string;
      at: string;
      localDate: string;
      amount: number;
      note: string | null;
      direction: "in" | "out";
      /** The account on the other side (may be a removed one). */
      otherAccountId: string;
      beforeSnapshot: boolean;
    }
  | { kind: "snapshot"; id: string; at: string; localDate: string; amount: number; beforeSnapshot: boolean };

const KIND_ORDER = { snapshot: 0, transfer: 1, txn: 2 } as const;

/** All the rows of one account, newest first. */
export function buildLedger(accountId: string, snapshots: SnapshotWithDate[], txns: Txn[], transfers: Transfer[]): LedgerRow[] {
  const mine = snapshots.filter((s) => s.account_id === accountId);
  const cutoff = mine.reduce<string | null>((m, s) => (m === null || s.recorded_at > m ? s.recorded_at : m), null);
  const rows: LedgerRow[] = [];
  for (const t of txns) {
    if (t.account_id !== accountId) continue;
    rows.push({
      kind: "txn",
      id: t.id,
      at: t.occurred_at,
      localDate: t.localDate,
      type: t.type,
      amount: t.amount,
      description: t.description,
      category_id: t.category_id,
      account_id: t.account_id,
      direction: t.type === "income" ? "in" : "out",
      beforeSnapshot: cutoff !== null && t.occurred_at <= cutoff,
    });
  }
  for (const t of transfers) {
    if (t.from_account_id !== accountId && t.to_account_id !== accountId) continue;
    const incoming = t.to_account_id === accountId;
    rows.push({
      kind: "transfer",
      id: t.id,
      at: t.occurred_at,
      localDate: t.localDate,
      amount: t.amount,
      note: t.note,
      direction: incoming ? "in" : "out",
      otherAccountId: incoming ? t.from_account_id : t.to_account_id,
      beforeSnapshot: cutoff !== null && t.occurred_at <= cutoff,
    });
  }
  for (const s of mine) {
    rows.push({ kind: "snapshot", id: s.id, at: s.recorded_at, localDate: s.localDate, amount: s.amount, beforeSnapshot: cutoff !== null && s.recorded_at < cutoff });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : 1)));
}

export type LedgerType = "all" | "income" | "expense" | "transfer";
export type LedgerFilter = {
  /** "all" or "YYYY-MM" */
  month: string;
  type: LedgerType;
  /** "all", "none" (no category) or a category id */
  category: string;
  q: string;
};
export type LedgerNames = { category: (id: string | null) => string; account: (id: string) => string };

/** Applies the page filters. Snapshot rows only show when nothing narrows the list except the month. */
export function filterLedger(rows: LedgerRow[], f: LedgerFilter, names: LedgerNames): LedgerRow[] {
  const needle = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.month !== "all" && !r.localDate.startsWith(f.month)) return false;
    if (r.kind === "snapshot") return f.type === "all" && f.category === "all" && needle === "";
    if (f.type === "transfer" && r.kind !== "transfer") return false;
    if ((f.type === "income" || f.type === "expense") && !(r.kind === "txn" && r.type === f.type)) return false;
    if (f.category !== "all") {
      if (r.kind !== "txn") return false;
      if (f.category === "none" ? r.category_id !== null : r.category_id !== f.category) return false;
    }
    if (!needle) return true;
    const hay =
      r.kind === "txn"
        ? [r.description ?? "", names.category(r.category_id), r.amount.toFixed(2)]
        : [r.note ?? "", "transfer", names.account(r.otherAccountId), r.amount.toFixed(2)];
    return hay.join(" ").toLowerCase().includes(needle);
  });
}

/** Header numbers for one month ("YYYY-MM"). Transfers are counted apart, not as income or expense. */
export function monthSummary(rows: LedgerRow[], month: string) {
  let income = 0;
  let expense = 0;
  let transferIn = 0;
  let transferOut = 0;
  for (const r of rows) {
    if (!r.localDate.startsWith(month)) continue;
    if (r.kind === "txn") {
      if (r.type === "income") income += r.amount;
      else expense += r.amount;
    } else if (r.kind === "transfer") {
      if (r.direction === "in") transferIn += r.amount;
      else transferOut += r.amount;
    }
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense), transferIn: round2(transferIn), transferOut: round2(transferOut) };
}

/** Months that have rows, plus the current one, newest first. */
export function ledgerMonths(rows: LedgerRow[], today: string): string[] {
  const set = new Set(rows.map((r) => r.localDate.slice(0, 7)));
  set.add(today.slice(0, 7));
  return [...set].sort().reverse();
}

export const LEDGER_LIMITS = [100, 500, 1000] as const;

// ——— Editing a transaction dated before a snapshot ———
export type SnapshotPrompt = { accountId: string; accountName: string; snapshotId: string; snapshotDate: string; delta: number };
type TxnLike = { type: TxnType; amount: number; account_id: string | null; occurred_at: string };

/**
 * When a transaction dated at or before an account's latest snapshot is edited, that snapshot no longer matches
 * the history. Returns, per account, how much the snapshot would have to move to match (new part − old part).
 * Only the part dated at or before the snapshot counts: the rest already moves the balance by itself.
 * cutoffByAccount = recorded_at of each account's latest snapshot (accounts without one are left out).
 */
export function snapshotDeltas(before: TxnLike, after: TxnLike, cutoffByAccount: Map<string, string>): { accountId: string; delta: number }[] {
  const out = new Map<string, number>();
  const add = (t: TxnLike, sign: 1 | -1) => {
    if (!t.account_id) return;
    const cut = cutoffByAccount.get(t.account_id);
    if (!cut || t.occurred_at > cut) return;
    out.set(t.account_id, round2((out.get(t.account_id) ?? 0) + sign * signed(t)));
  };
  add(before, -1);
  add(after, 1);
  return [...out].filter(([, d]) => d !== 0).map(([accountId, delta]) => ({ accountId, delta }));
}
