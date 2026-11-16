"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { adjustSnapshot, deleteTransfer, updateTransactionForAccount } from "@/app/finance-actions";
import { EditTransaction, type Acc, type Cat, type ListTxn, type SaveState } from "@/components/TransactionList";
import Modal, { btnPrimary, btnSecondary } from "@/components/calendar/Modal";
import {
  filterLedger,
  ledgerMonths,
  LEDGER_LIMITS,
  monthSummary,
  type LedgerFilter,
  type LedgerRow,
  type LedgerType,
  type SnapshotPrompt,
} from "@/lib/finance-ledger";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const sel = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm";
const ADJ = "adjustment";

type Header = { balance: number; kindLabel: string; snapshotText: string };

/** BL-101: the whole history of one account, with filters, editing and the "adjust the snapshot?" question. */
export default function AccountLedger({
  accountId,
  rows,
  categories,
  accounts,
  today,
  header,
  worthById,
  unassignedCount,
}: {
  accountId: string;
  rows: LedgerRow[];
  categories: Cat[];
  accounts: Acc[];
  today: string;
  header: Header;
  worthById: Record<string, boolean | null>;
  unassignedCount: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<LedgerFilter>({ month: "all", type: "all", category: "all", q: "" });
  const [limit, setLimit] = useState<number>(LEDGER_LIMITS[0]);
  const [editing, setEditing] = useState<ListTxn | null>(null);
  const [prompts, setPrompts] = useState<SnapshotPrompt[]>([]);
  const [busy, setBusy] = useState(false);
  const [promptError, setPromptError] = useState("");

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const names = useMemo(
    () => ({
      category: (id: string | null) => (id ? catById.get(id)?.name ?? "" : ""),
      account: (id: string) => accById.get(id) ?? "Removed account",
    }),
    [catById, accById]
  );
  const months = useMemo(() => ledgerMonths(rows, today), [rows, today]);
  const filtered = useMemo(() => filterLedger(rows, filter, names), [rows, filter, names]);
  const shown = filtered.slice(0, limit);
  // The header follows the month picked; with "all months" it shows the current one
  const headerMonth = filter.month === "all" ? today.slice(0, 7) : filter.month;
  const sum = useMemo(() => monthSummary(rows, headerMonth), [rows, headerMonth]);
  const filtering = filter.q.trim() !== "" || filter.month !== "all" || filter.type !== "all" || filter.category !== "all";

  const set = (patch: Partial<LedgerFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(LEDGER_LIMITS[0]);
  };
  const onSaved = useCallback((state: SaveState) => {
    if (state.prompts?.length) setPrompts(state.prompts);
  }, []);
  const closeEdit = useCallback(() => setEditing(null), []);
  const prompt = prompts[0];

  async function answer(adjust: boolean) {
    if (!prompt) return;
    setBusy(true);
    setPromptError("");
    if (adjust) {
      const r = await adjustSnapshot(prompt.snapshotId, prompt.delta);
      if (r.error) {
        setPromptError(r.error);
        setBusy(false);
        return;
      }
      router.refresh();
    }
    setPrompts((p) => p.slice(1));
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <p className="text-xs text-muted">Balance now</p>
          <p className={`text-xl font-semibold tabular-nums ${header.balance < 0 ? "text-danger" : ""}`}>{usd(header.balance)}</p>
          <p className="text-xs text-faint">{header.snapshotText}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Money in · {monthLabel(headerMonth)}</p>
          <p className="text-xl font-semibold tabular-nums text-success">{usd(sum.income)}</p>
          {(sum.transferIn > 0 || sum.transferOut > 0) && <p className="text-xs text-faint">+{usd(sum.transferIn)} in by transfer</p>}
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Money out · {monthLabel(headerMonth)}</p>
          <p className="text-xl font-semibold tabular-nums">{usd(sum.expense)}</p>
          {(sum.transferIn > 0 || sum.transferOut > 0) && <p className="text-xs text-faint">−{usd(sum.transferOut)} out by transfer</p>}
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Net change · {monthLabel(headerMonth)}</p>
          <p className={`text-xl font-semibold tabular-nums ${sum.net < 0 ? "text-danger" : sum.net > 0 ? "text-success" : ""}`}>{signedUsd(sum.net)}</p>
          <p className="text-xs text-faint">{header.kindLabel}</p>
        </div>
      </section>

      {unassignedCount > 0 && (
        <p className="text-xs text-muted">
          {unassignedCount} transaction{unassignedCount > 1 ? "s have" : " has"} no account, so {unassignedCount > 1 ? "they do" : "it does"} not show here.{" "}
          <Link href="/finance" className="text-accent hover:underline">See them on Finance</Link>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={filter.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search description, category, amount…"
          aria-label="Search this account"
          className={`${sel} min-w-0 flex-1 basis-48`}
        />
        <select value={filter.month} onChange={(e) => set({ month: e.target.value })} aria-label="Month" className={sel}>
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <select value={filter.type} onChange={(e) => set({ type: e.target.value as LedgerType })} aria-label="Type" className={sel}>
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfers</option>
        </select>
        <select value={filter.category} onChange={(e) => set({ category: e.target.value })} aria-label="Category" className={`${sel} max-w-[11rem]`}>
          <option value="all">All categories</option>
          <option value="none">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.kind === "income" ? " (income)" : ""}</option>
          ))}
        </select>
      </div>

      {filtering && (
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span>{filtered.length} row{filtered.length === 1 ? "" : "s"}</span>
          <button type="button" onClick={() => { setFilter({ month: "all", type: "all", category: "all", q: "" }); setLimit(LEDGER_LIMITS[0]); }} className="ml-auto text-accent hover:underline">
            Clear filters
          </button>
        </p>
      )}

      <ul className="card divide-y divide-line overflow-hidden">
        {shown.map((r) => {
          const dim = r.beforeSnapshot ? "opacity-60" : "";
          const date = r.localDate.slice(0, 4) === today.slice(0, 4) ? r.localDate.slice(5) : r.localDate.slice(2);
          if (r.kind === "snapshot") {
            return (
              <li key={`s-${r.id}`} className={`flex items-center gap-3 bg-subtle/60 px-3 py-2 text-sm ${dim}`}>
                <span className="w-12 shrink-0 tabular-nums text-muted">{date}</span>
                <span className="min-w-0 flex-1 text-muted">Balance set to <span className="font-medium text-fg">{usd(r.amount)}</span></span>
                {r.beforeSnapshot && <span className="shrink-0 text-xs text-faint">older snapshot</span>}
              </li>
            );
          }
          if (r.kind === "transfer") {
            const other = names.account(r.otherAccountId);
            return (
              <li key={`t-${r.id}`} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${dim}`}>
                <span className="w-12 shrink-0 tabular-nums text-muted">{date}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.direction === "in" ? `Transfer from ${other}` : `Transfer to ${other}`}</span>
                  <span className="block truncate text-xs text-faint">
                    {[r.note, r.beforeSnapshot ? "before snapshot" : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums font-medium ${r.direction === "in" ? "text-success" : "text-danger"}`}>
                  {r.direction === "in" ? "+" : "−"}{usd(r.amount)}
                </span>
                <form action={deleteTransfer}>
                  <input type="hidden" name="id" value={r.id} />
                  <button aria-label="Delete transfer" className="text-xs text-faint hover:text-danger">×</button>
                </form>
              </li>
            );
          }
          const c = r.category_id ? catById.get(r.category_id) : undefined;
          const label = r.description || c?.name || (r.type === "income" ? "Income" : "Expense");
          return (
            <li key={`x-${r.id}`} className={dim}>
              <button
                type="button"
                title="Edit"
                onClick={() =>
                  setEditing({
                    id: r.id,
                    type: r.type,
                    amount: r.amount,
                    description: r.description,
                    category_id: r.category_id,
                    account_id: r.account_id,
                    localDate: r.localDate,
                    worth_it: worthById[r.id] ?? null,
                  })
                }
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-subtle/60"
              >
                <span className="w-12 shrink-0 tabular-nums text-muted">{date}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{label}</span>
                  <span className="block truncate text-xs text-faint">
                    {[r.description ? c?.name ?? "Uncategorized" : null, r.beforeSnapshot ? "before snapshot" : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums font-medium ${r.direction === "in" ? "text-success" : "text-danger"}`}>
                  {r.direction === "in" ? "+" : "−"}{usd(r.amount)}
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-4 text-sm text-faint">Nothing on this account yet.</li>}
        {rows.length > 0 && filtered.length === 0 && <li className="p-4 text-sm text-faint">Nothing matches these filters.</li>}
      </ul>

      {filtered.length > shown.length && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Showing {shown.length} of {filtered.length}. Load more:</span>
          {LEDGER_LIMITS.filter((n) => n > limit).map((n) => (
            <button key={n} type="button" onClick={() => setLimit(n)} className={btnSecondary}>
              Up to {n}
            </button>
          ))}
        </div>
      )}
      {filtered.length > 0 && filtered.length <= shown.length && limit > LEDGER_LIMITS[0] && (
        <button type="button" onClick={() => setLimit(LEDGER_LIMITS[0])} className="text-xs text-accent hover:underline">Show 100 only</button>
      )}

      {editing && (
        <EditTransaction
          key={editing.id}
          txn={editing}
          categories={categories}
          accounts={accounts}
          isAdjustment={(editing.category_id ? catById.get(editing.category_id)?.name.toLowerCase() : "") === ADJ}
          saveAction={updateTransactionForAccount}
          onSaved={onSaved}
          onClose={closeEdit}
        />
      )}

      {prompt && (
        <Modal title="Adjust the balance snapshot?" onClose={() => (busy ? undefined : answer(false))}>
          <p className="text-sm">
            This transaction is dated before the balance you set for <span className="font-medium">{prompt.accountName}</span> on {prompt.snapshotDate}, so that balance already includes it.
            Your edit changes the account by <span className="font-medium">{signedUsd(prompt.delta)}</span>.
          </p>
          <p className="text-sm text-muted">
            Adjust the snapshot by {signedUsd(prompt.delta)} too, and today&apos;s balance moves by the same amount. Or leave it, and today&apos;s balance stays as it is.
          </p>
          {promptError && <p className="text-sm text-danger">{promptError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => answer(false)} className={btnSecondary}>Leave the balance</button>
            <button type="button" disabled={busy} onClick={() => answer(true)} className={btnPrimary}>{busy ? "Saving…" : `Adjust by ${signedUsd(prompt.delta)}`}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
