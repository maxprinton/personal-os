"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTransaction, splitAdjustment, updateTransaction } from "@/app/finance-actions";
import type { ActionState } from "@/app/actions";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";

import { WritingInput } from "@/components/WritingField";
type Kind = "income" | "expense";
export type ListTxn = {
  id: string;
  type: Kind;
  amount: number;
  description: string | null;
  category_id: string | null;
  account_id: string | null;
  localDate: string;
};
type Cat = { id: string; name: string; kind: Kind };
type Acc = { id: string; name: string };

const PAGE = 40;
const ADJ = "adjustment";
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const sel = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm";

/** Every transaction, searchable and filterable; tap one to edit any of its fields. */
export default function TransactionList({
  txns,
  categories,
  accounts,
  today,
}: {
  txns: ListTxn[];
  categories: Cat[];
  accounts: Acc[];
  today: string;
}) {
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("all");
  const [cat, setCat] = useState("all");
  const [acc, setAcc] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<ListTxn | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const months = useMemo(() => [...new Set(txns.map((t) => t.localDate.slice(0, 7)))].sort().reverse(), [txns]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter((t) => {
      if (month !== "all" && !t.localDate.startsWith(month)) return false;
      if (cat === "none" ? t.category_id : cat !== "all" && t.category_id !== cat) return false;
      if (acc === "none" ? t.account_id : acc !== "all" && t.account_id !== acc) return false;
      if (!needle) return true;
      const hay = [
        t.description ?? "",
        t.category_id ? catById.get(t.category_id)?.name ?? "" : "",
        t.account_id ? accName.get(t.account_id) ?? "" : "",
        t.amount.toFixed(2),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [txns, q, month, cat, acc, catById, accName]);

  const filtering = q.trim() !== "" || month !== "all" || cat !== "all" || acc !== "all";
  const spent = filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const earned = filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const shown = filtered.slice(0, limit);

  function clear() {
    setQ("");
    setMonth("all");
    setCat("all");
    setAcc("all");
    setLimit(PAGE);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search description, category, amount…"
          aria-label="Search transactions"
          className={`${sel} min-w-0 flex-1 basis-48`}
        />
        <select value={month} onChange={(e) => { setMonth(e.target.value); setLimit(PAGE); }} aria-label="Month" className={sel}>
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <select value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE); }} aria-label="Category" className={`${sel} max-w-[11rem]`}>
          <option value="all">All categories</option>
          <option value="none">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.kind === "income" ? " (income)" : ""}</option>
          ))}
        </select>
        {accounts.length > 0 && (
          <select value={acc} onChange={(e) => { setAcc(e.target.value); setLimit(PAGE); }} aria-label="Account" className={`${sel} max-w-[10rem]`}>
            <option value="all">All accounts</option>
            <option value="none">Unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>

      {filtering && (
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span>{filtered.length} transaction{filtered.length === 1 ? "" : "s"}</span>
          {spent > 0 && <span>spent <span className="font-medium text-fg">{usd(spent)}</span></span>}
          {earned > 0 && <span>income <span className="font-medium text-success">{usd(earned)}</span></span>}
          <button type="button" onClick={clear} className="ml-auto text-accent hover:underline">Clear filters</button>
        </p>
      )}

      <ul className="card divide-y divide-line overflow-hidden">
        {shown.map((t) => {
          const c = t.category_id ? catById.get(t.category_id) : undefined;
          const label = t.description || c?.name || (t.type === "income" ? "Income" : "Expense");
          const isAdj = c?.name.toLowerCase() === ADJ;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setEditing(t)}
                title="Edit"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-subtle/60"
              >
                <span className="w-12 shrink-0 tabular-nums text-muted">
                  {t.localDate.slice(0, 4) === today.slice(0, 4) ? t.localDate.slice(5) : t.localDate.slice(2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{label}</span>
                  <span className="block truncate text-xs text-faint">
                    {[t.description ? c?.name ?? "Uncategorized" : null, t.account_id ? accName.get(t.account_id) ?? "Removed account" : accounts.length ? "Unassigned" : null]
                      .filter(Boolean)
                      .join(" · ")}
                    {isAdj && <span className="text-warning"> · tap to say what it was</span>}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums font-medium ${t.type === "income" ? "text-success" : ""}`}>
                  {t.type === "income" ? "+" : "−"}{usd(t.amount)}
                </span>
              </button>
            </li>
          );
        })}
        {txns.length === 0 && <li className="p-4 text-sm text-faint">No transactions yet.</li>}
        {txns.length > 0 && filtered.length === 0 && <li className="p-4 text-sm text-faint">Nothing matches these filters.</li>}
      </ul>
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={`${btnSecondary} w-full`}>
          Show {Math.min(PAGE, filtered.length - limit)} more ({filtered.length - limit} left)
        </button>
      )}

      {editing && (
        <EditTransaction
          key={editing.id}
          txn={editing}
          categories={categories}
          accounts={accounts}
          isAdjustment={(editing.category_id ? catById.get(editing.category_id)?.name.toLowerCase() : "") === ADJ}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditTransaction({
  txn,
  categories,
  accounts,
  isAdjustment,
  onClose,
}: {
  txn: ListTxn;
  categories: Cat[];
  accounts: Acc[];
  isAdjustment: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTransaction, {});
  const [type, setType] = useState<Kind>(txn.type);
  const [category, setCategory] = useState(txn.category_id ?? "");
  const [deleting, setDeleting] = useState(false);
  const cats = categories.filter((c) => c.kind === type);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);

  function pickType(t: Kind) {
    setType(t);
    // A category of the other kind doesn't fit anymore
    if (category && categories.find((c) => c.id === category)?.kind !== t) setCategory("");
  }

  async function remove() {
    if (!window.confirm(`Delete this ${txn.type} of ${usd(txn.amount)} for good?`)) return;
    setDeleting(true);
    const fd = new FormData();
    fd.set("id", txn.id);
    await deleteTransaction(fd);
    router.refresh();
    onClose();
  }

  return (
    <Modal title={isAdjustment ? "Edit balance adjustment" : "Edit transaction"} onClose={onClose} wide>
      {isAdjustment && <SplitAdjustment txn={txn} categories={categories} onDone={onClose} />}

      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={txn.id} />
        {isAdjustment && <p className="text-xs font-medium text-muted">Or change the whole adjustment:</p>}
        <div className="flex gap-2">
          {(["expense", "income"] as const).map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-md border px-3 py-1 text-sm ${type === t ? "border-accent bg-accent font-medium text-accent-fg shadow-sm" : "border-edge"}`}
            >
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => pickType(t)} className="sr-only" />
              {t === "expense" ? "Expense" : "Income"}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Amount (USD)
            <input name="amount" required inputMode="decimal" defaultValue={txn.amount.toFixed(2)} autoFocus={!isAdjustment} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block text-sm">
            Date
            <input type="date" name="date" required defaultValue={txn.localDate} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block text-sm">
            Category
            <select name="category_id" value={category} onChange={(e) => setCategory(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="">No category</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Account
            <select name="account_id" defaultValue={txn.account_id ?? ""} className={`mt-1 ${inputCls}`}>
              <option value="">Unassigned</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              {txn.account_id && !accounts.some((a) => a.id === txn.account_id) && <option value={txn.account_id}>Removed account</option>}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Description
          <WritingInput area="finance" name="description" defaultValue={txn.description ?? ""} placeholder="What was it?" className={`mt-1 ${inputCls}`} />
        </label>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="mr-auto rounded-md px-2 py-2 text-sm text-faint transition-colors hover:bg-danger-soft hover:text-danger"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={pending} className={btnPrimary}>{pending ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** For a Balance adjustment: "part of it was the $1 water" → that part becomes its own transaction. */
function SplitAdjustment({ txn, categories, onDone }: { txn: ListTxn; categories: Cat[]; onDone: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(splitAdjustment, {});
  const cats = categories.filter((c) => c.kind === txn.type && c.name.toLowerCase() !== ADJ);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onDone();
    }
  }, [state, router, onDone]);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-accent/30 bg-subtle p-3">
      <input type="hidden" name="id" value={txn.id} />
      <div>
        <p className="text-sm font-medium">Remember what some of it was?</p>
        <p className="text-xs text-muted">
          {txn.type === "expense" ? `${usd(txn.amount)} went missing.` : `${usd(txn.amount)} extra showed up.`} Enter the part you remember; it
          gets its own line and the adjustment shrinks by that much. Your balance stays the same.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="amount" required inputMode="decimal" autoFocus placeholder={`Amount (up to ${usd(txn.amount)})`} aria-label="Amount" className={inputCls} />
        <select name="category_id" defaultValue="" aria-label="Category" className={inputCls}>
          <option value="">No category</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <WritingInput area="finance" name="description" placeholder="What was it? (e.g. water)" aria-label="Description" className={inputCls} />
        <input type="date" name="date" defaultValue={txn.localDate} aria-label="Date" className={inputCls} />
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <div className="flex justify-end">
        <button disabled={pending} className={btnPrimary}>{pending ? "Saving…" : "Split it off"}</button>
      </div>
    </form>
  );
}
