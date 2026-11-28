"use client";
// Budget v2 (BL-124) on the Finance page: the real-money check with its Fix button, and the debts you owe.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBudgetCorrection, addDebt, payDebt, removeDebt, undoLastCorrection } from "@/app/budget-actions";
import type { Debt } from "@/lib/budget/data";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const input = "rounded-md border border-line-strong px-2.5 py-1.5 text-sm";
const btn = "rounded-md border border-edge px-2.5 py-1 text-xs transition-colors hover:bg-subtle disabled:opacity-50";

/**
 * "Budget $X · accounts $Y · gap $Z" (decision 9). Fix asks where the gap goes (Spending money by default).
 * When an account's balance is older than 3 days, it says so first: the gap may only be missing logs.
 */
export function RealMoneyCheck({
  budgetTotal,
  accountsTotal,
  gap,
  stale,
  spendingName,
  savingsName,
  hasCorrections,
}: {
  budgetTotal: number;
  accountsTotal: number;
  gap: number;
  stale: string[];
  spendingName: string;
  savingsName: string;
  hasCorrections: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"spending" | "savings">("spending");
  const [error, setError] = useState<string | null>(null);
  const even = Math.abs(gap) < 0.005;

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Could not save it." }));
      if (r.error) return setError(r.error);
      setOpen(false);
      router.refresh();
    });

  return (
    <div className={`space-y-1.5 rounded-lg border p-3 shadow-card ${even ? "border-line bg-surface" : "border-warning/40 bg-warning-soft"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">Real-money check</p>
        <p className={`text-sm tabular-nums ${even ? "text-success" : "text-warning"}`}>{even ? "matches" : `gap ${gap > 0 ? "+" : "−"}${usd(Math.abs(gap))}`}</p>
      </div>
      <p className="break-words text-xs tabular-nums">
        Budget {usd(budgetTotal)} · accounts {usd(accountsTotal)} · gap {gap >= 0 ? "" : "−"}
        {usd(Math.abs(gap))}
      </p>
      <p className="text-xs text-muted">
        The budget ({spendingName} + {savingsName} + what envelopes hold) should add up to the money in all your accounts.
        {!even && (gap > 0 ? " Your accounts hold more than the budget knows." : " Your accounts hold less than the budget thinks.")}
      </p>
      {!even && stale.length > 0 && (
        <p className="text-xs text-warning">
          Update your balances first: {stale.join(", ")} {stale.length === 1 ? "was" : "were"} last set more than 3 days ago, so the gap may only be things you
          haven&apos;t logged.
        </p>
      )}
      {!even && !open && (
        <button type="button" className={btn} onClick={() => setOpen(true)}>
          Fix
        </button>
      )}
      {!even && open && (
        <div className="space-y-2 border-t border-line pt-2">
          <p className="text-xs text-muted">
            Where should the {gap > 0 ? "extra" : "missing"} {usd(Math.abs(gap))} go? This only changes the budget, never an account.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={target} onChange={(e) => setTarget(e.target.value === "savings" ? "savings" : "spending")} className={input} aria-label="Where the gap goes">
              <option value="spending">{spendingName} (default)</option>
              <option value="savings">{savingsName}</option>
            </select>
            <button type="button" className={btn} disabled={pending} onClick={() => run(() => addBudgetCorrection({ amount: gap, target, note: `Real-money check: budget ${usd(budgetTotal)}, accounts ${usd(accountsTotal)}` }))}>
              {pending ? "Saving…" : "Fix it"}
            </button>
            <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {hasCorrections && (
        <button type="button" className="text-xs text-faint hover:text-fg" disabled={pending} onClick={() => run(() => undoLastCorrection())}>
          Undo the last fix
        </button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Debts you owe (decision 10): who, how much, what is left; pay part back from here. */
export function DebtsCard({
  debts,
  accounts,
  today,
  hasCategory,
  envelopeLeft,
}: {
  debts: Debt[];
  accounts: { id: string; name: string }[];
  today: string;
  hasCategory: boolean;
  /** What the Debt payback envelope has left this month (null = no such envelope). */
  envelopeLeft: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [paying, setPaying] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAccount, setPayAccount] = useState(accounts[0]?.id ?? "");
  const [payDate, setPayDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const totalLeft = debts.reduce((n, d) => n + d.left, 0);

  const run = (fn: () => Promise<{ ok?: true; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Could not save it." }));
      if (r.error) return setError(r.error);
      after?.();
      router.refresh();
    });

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">Debts you owe</p>
        <p className="text-sm tabular-nums">{usd(totalLeft)} left</p>
      </div>
      <p className="text-xs text-muted">
        Pay them back from the Debt payback envelope.{envelopeLeft !== null ? ` It has ${usd(envelopeLeft)} this month.` : " Add an envelope with the Debt payback category to set money aside for it."}
        {!hasCategory && " (The Debt payback category is created by migration 0079.)"}
      </p>
      {debts.length === 0 && <p className="text-xs text-faint">No debts. Add the ones you have so you can see them go down.</p>}
      <ul className="divide-y divide-line text-sm">
        {debts.map((d) => (
          <li key={d.id} className="space-y-1.5 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{d.person}</span>
              <span className="text-xs tabular-nums text-muted">
                {usd(d.paid)} paid of {usd(d.amount)}
              </span>
              <span className={`w-20 text-right tabular-nums ${d.left === 0 ? "text-success" : ""}`}>{d.left === 0 ? "paid ✓" : `${usd(d.left)} left`}</span>
              {d.left > 0 && (
                <button type="button" className={btn} onClick={() => { setPaying(paying === d.id ? null : d.id); setPayAmount(String(Math.min(d.left, 25))); }}>
                  Pay
                </button>
              )}
              <button
                type="button"
                className="text-xs text-faint hover:text-danger"
                onClick={() => {
                  if (window.confirm(`Remove the debt to ${d.person} from the list? Its payments stay as normal transactions.`)) run(() => removeDebt(d.id));
                }}
              >
                Remove
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
              <div className="h-1.5 rounded-full bg-success-solid" style={{ width: `${Math.min(100, Math.round((d.paid / d.amount) * 100))}%` }} />
            </div>
            {paying === d.id && (
              <div className="flex flex-wrap items-center gap-2">
                <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" aria-label="Amount" className={`${input} w-24`} />
                <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)} aria-label="From account" className={input}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} aria-label="Date" className={input} />
                <button
                  type="button"
                  className={btn}
                  disabled={pending}
                  onClick={() => run(() => payDebt({ debtId: d.id, amount: payAmount, accountId: payAccount, date: payDate }), () => setPaying(null))}
                >
                  {pending ? "Saving…" : "Save payment"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <input value={person} onChange={(e) => setPerson(e.target.value)} maxLength={80} placeholder="Who" className={`${input} w-40`} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="How much" className={`${input} w-28`} />
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() => run(() => addDebt({ person, amount }), () => { setAdding(false); setPerson(""); setAmount(""); })}
          >
            {pending ? "Saving…" : "Add debt"}
          </button>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={btn} onClick={() => setAdding(true)}>
          + Add a debt
        </button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
