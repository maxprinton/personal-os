"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addAccount, addCategory, addTransaction, addTransfer, setBudget } from "@/app/finance-actions";
import type { ActionState } from "@/app/actions";

type Opt = { id: string; name: string };
type CatOpt = Opt & { kind: "income" | "expense" };

const input = "rounded-md border border-line-strong px-3 py-2 text-sm";

function useResetOnOk(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

function Feedback({ state, ok }: { state: ActionState; ok: string }) {
  if (state.error) return <p className="text-sm text-danger">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-success">{ok}</p>;
  return null;
}

export function TransactionForm({
  today,
  categories,
  accounts,
}: {
  today: string;
  categories: CatOpt[];
  accounts: Opt[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTransaction, {});
  const ref = useResetOnOk(state);
  const [type, setType] = useState<"expense" | "income">("expense");
  const cats = categories.filter((c) => c.kind === type);

  return (
    <form ref={ref} action={action} className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
      <div className="flex gap-2">
        {(["expense", "income"] as const).map((t) => (
          <label
            key={t}
            className={`cursor-pointer rounded-md border px-3 py-1 text-sm ${type === t ? "border-accent bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover text-accent-fg" : "border-edge"}`}
          >
            <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
            {t === "expense" ? "Expense" : "Income"}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input name="amount" required inputMode="decimal" placeholder="Amount (USD)" className={input} />
        <select name="category_id" defaultValue="" className={input}>
          <option value="">No category</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select name="account_id" defaultValue={accounts[0]?.id ?? ""} className={input}>
          <option value="">Unassigned</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input type="date" name="date" defaultValue={today} className={input} />
        <input name="description" placeholder="Description (optional)" className={`${input} col-span-2 sm:col-span-3`} />
        <button disabled={pending} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg disabled:opacity-50">
          {pending ? "Saving..." : "Add"}
        </button>
      </div>
      <Feedback state={state} ok="Saved." />
    </form>
  );
}

export function AccountForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addAccount, {});
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <input name="name" required placeholder="Account name" className={input} />
      <select name="kind" defaultValue="checking" className={input}>
        <option value="checking">Checking</option>
        <option value="savings">Savings</option>
        <option value="credit_card">Credit card</option>
        <option value="cash">Cash</option>
        <option value="other">Other</option>
      </select>
      <input name="balance" inputMode="decimal" placeholder="Current balance" className={input} />
      <button disabled={pending} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-2 text-sm disabled:opacity-50">
        Add account
      </button>
      <div className="col-span-2 sm:col-span-4"><Feedback state={state} ok="Account added." /></div>
    </form>
  );
}

export function CategoryForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCategory, {});
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="flex flex-wrap gap-2">
      <input name="name" required placeholder="New category" className={`${input} flex-1`} />
      <select name="kind" defaultValue="expense" className={input}>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <button disabled={pending} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-2 text-sm disabled:opacity-50">
        Add
      </button>
      <div className="w-full"><Feedback state={state} ok="Category added." /></div>
    </form>
  );
}

export function BudgetForm({ categories }: { categories: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setBudget, {});
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <select name="category_id" required defaultValue="" className={input}>
        <option value="" disabled>Category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <input name="limit_amount" required inputMode="decimal" placeholder="Limit (USD)" className={input} />
      <select name="period" defaultValue="monthly" className={input}>
        <option value="monthly">Monthly</option>
        <option value="weekly">Weekly</option>
      </select>
      <button disabled={pending} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-2 text-sm disabled:opacity-50">
        Set budget
      </button>
      <div className="col-span-2 sm:col-span-4"><Feedback state={state} ok="Budget saved." /></div>
    </form>
  );
}

export function TransferForm({ today, accounts }: { today: string; accounts: Opt[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTransfer, {});
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={action} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <select name="from_account_id" required defaultValue="" className={input}>
        <option value="" disabled>From account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <select name="to_account_id" required defaultValue="" className={input}>
        <option value="" disabled>To account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <input name="amount" required inputMode="decimal" placeholder="Amount (USD)" className={input} />
      <input type="date" name="date" defaultValue={today} className={input} />
      <input name="note" placeholder="Note (optional)" className={`${input} col-span-2 sm:col-span-3`} />
      <button disabled={pending} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg disabled:opacity-50">
        {pending ? "Moving..." : "Transfer"}
      </button>
      <div className="col-span-2 sm:col-span-4"><Feedback state={state} ok="Transfer saved." /></div>
    </form>
  );
}
