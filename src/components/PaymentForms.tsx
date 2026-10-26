"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmPayment, createPayment, skipPayment, stopPaymentTemplate } from "@/app/calendar-actions";
import type { CalResult, FinanceOptions, PaymentTemplate } from "@/lib/calendar/types";
import type { RepeatUnit } from "@/lib/calendar/recurrence";
import { emitCalendarChanged } from "@/components/calendar/util";
import { getPaymentRecords } from "@/app/payment-actions";

const input = "rounded-md border border-line-strong px-3 py-2 text-sm";

function useRun(run?: (fn: () => Promise<CalResult>) => Promise<boolean>) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(fn: () => Promise<CalResult>) {
    setBusy(true);
    let ok: boolean;
    if (run) ok = await run(fn);
    else {
      const r = await fn();
      ok = !r.error;
      setMsg(r.error ?? null);
      emitCalendarChanged();
      router.refresh();
    }
    setBusy(false);
    return ok;
  }
  return { go, msg, busy };
}

/**
 * New scheduled payment. The same form is used on the Finance page and in the calendar,
 * and both create the same records (a template and its events).
 */
export function PaymentForm({
  options,
  date,
  run,
  onDone,
}: {
  options: Omit<FinanceOptions, "templates">;
  date: string;
  run?: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onDone?: () => void;
}) {
  const { go, msg, busy } = useRun(run);
  const [name, setName] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(options.accounts[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [start, setStart] = useState(date);
  const [unit, setUnit] = useState<RepeatUnit>("months");
  const [every, setEvery] = useState(1);
  const [end, setEnd] = useState("");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await go(() =>
          createPayment({
            name,
            type,
            expectedAmount: amount,
            accountId: account,
            categoryId: category,
            startDate: start,
            repeatUnit: unit,
            repeatEvery: every,
            endDate: end,
          })
        );
        if (ok) {
          setName("");
          setAmount("");
          onDone?.();
        }
      }}
      className="space-y-2 rounded-lg border border-line p-3 text-sm bg-surface shadow-card"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, Internet…" className={`${input} col-span-2`} />
        <select value={type} onChange={(e) => setType(e.target.value as "expense" | "income")} className={input}>
          <option value="expense">Payment (expense)</option>
          <option value="income">Income</option>
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Expected $" className={input} />
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={input}>
          <option value="">No account</option>
          {options.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
          <option value="">No category</option>
          {options.categories
            .filter((c) => c.kind === type)
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>
        <label className="text-xs text-muted">
          First date
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={`${input} w-full`} />
        </label>
        <label className="text-xs text-muted">
          Ends (optional)
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={`${input} w-full`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Repeats</span>
        <select value={unit} onChange={(e) => setUnit(e.target.value as RepeatUnit)} className={input}>
          <option value="none">Only once</option>
          <option value="months">every month(s)</option>
          <option value="weeks">every week(s)</option>
          <option value="days">every day(s)</option>
          <option value="years">every year(s)</option>
        </select>
        {unit !== "none" && (
          <label className="flex items-center gap-1">
            every
            <input type="number" min={1} max={366} value={every} onChange={(e) => setEvery(Number(e.target.value))} className={`${input} w-20`} />
          </label>
        )}
        <button disabled={busy} className="ml-auto rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-accent-fg disabled:opacity-50">
          {busy ? "Saving…" : "Schedule payment"}
        </button>
      </div>
      <p className="text-xs text-muted">It shows on the calendar as an event. On its day you get a pre-filled draft: write the real amount and confirm.</p>
      {msg && <p className="text-danger">{msg}</p>}
    </form>
  );
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const nice = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A payment event's transaction, pre-filled from its template (amount, account, category, date).
 * "Mark as paid" creates the real transaction and marks the event paid. If it is already paid, it says
 * so (with what was recorded) and asks before creating another transaction.
 */
export function PaymentDraft({
  eventId,
  title,
  date,
  template,
  options,
  today,
  onDone,
  readOnly = false,
  status = null,
}: {
  eventId: string;
  title: string;
  date: string;
  template: PaymentTemplate | null;
  options: Omit<FinanceOptions, "templates">;
  today: string;
  /** Kept for old call sites; the draft talks to the server itself so it can show the "already paid" warning. */
  run?: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onDone?: () => void;
  readOnly?: boolean;
  status?: "paid" | "skipped" | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [amount, setAmount] = useState(template?.expected_amount ? template.expected_amount.toFixed(2) : "");
  const [account, setAccount] = useState(template?.account_id ?? options.accounts[0]?.id ?? "");
  const [category, setCategory] = useState(template?.category_id ?? "");
  const [on, setOn] = useState(date > today ? today : date);
  const [description, setDescription] = useState(title);
  const [showForm, setShowForm] = useState(status === null);
  const [warn, setWarn] = useState(false); // "already paid — create another?"
  const [records, setRecords] = useState<{ amount: number; date: string; account: string | null }[] | null>(null);
  const kind = template?.type ?? "expense";
  const paid = status === "paid";

  useEffect(() => {
    if (status === "paid") getPaymentRecords(eventId).then(setRecords).catch(() => setRecords([]));
  }, [eventId, status]);

  const recorded = records && records.length ? records : null;
  const paidLine = recorded
    ? recorded.map((r) => `${usd(r.amount)} on ${nice(r.date)}${r.account ? ` · ${r.account}` : ""}`).join(" + ")
    : null;

  async function pay(again: boolean) {
    setBusy(true);
    const r = await confirmPayment({ eventId, amount, accountId: account, categoryId: category, date: on, description, again });
    setBusy(false);
    if (r.code === "ALREADY_PAID") {
      setWarn(true);
      return;
    }
    if (r.error) {
      setMsg(r.error);
      return;
    }
    setMsg(null);
    setWarn(false);
    emitCalendarChanged();
    router.refresh();
    onDone?.();
  }

  async function skip() {
    setBusy(true);
    const r = await skipPayment({ eventId });
    setBusy(false);
    if (r.error) return setMsg(r.error);
    emitCalendarChanged();
    router.refresh();
    onDone?.();
  }

  const header = (
    <p className="font-medium">
      💳 {title}{" "}
      <span className="font-normal text-muted">
        · {kind === "income" ? "expected" : "due"} {nice(date)}
        {template?.expected_amount ? ` · ${usd(template.expected_amount)}` : ""}
      </span>
    </p>
  );

  if (readOnly) {
    return (
      <div className="space-y-1 text-sm">
        {header}
        <p className="text-muted">{paid ? `✓ Paid${paidLine ? ` · ${paidLine}` : ""}` : status === "skipped" ? "Skipped this time." : "Mark it as paid on the computer."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {header}

      {paid && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface/70 px-3 py-2">
          <span className="font-medium text-success">✓ Paid{paidLine ? ` · ${paidLine}` : records === null ? " · loading…" : ""}</span>
          {!showForm && (
            <button type="button" onClick={() => setShowForm(true)} className="text-xs font-medium text-muted underline hover:text-fg">
              Record another payment
            </button>
          )}
        </div>
      )}
      {status === "skipped" && !showForm && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface/70 px-3 py-2">
          <span className="text-muted">Skipped this time.</span>
          <button type="button" onClick={() => setShowForm(true)} className="text-xs font-medium text-muted underline hover:text-fg">
            Pay it after all
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (paid) setWarn(true);
            else pay(false);
          }}
          className="space-y-2"
        >
          {date > today && <p className="text-xs text-muted">Due {nice(date)} — paying early? The transaction gets today&apos;s date (you can change it).</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-muted">
              Amount
              <input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$" className={`${input} mt-0.5 w-full`} />
            </label>
            <label className="text-xs text-muted">
              Account
              <select value={account} onChange={(e) => setAccount(e.target.value)} className={`${input} mt-0.5 w-full`}>
                <option value="">No account</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${input} mt-0.5 w-full`}>
                <option value="">No category</option>
                {options.categories
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Date
              <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className={`${input} mt-0.5 w-full`} />
            </label>
            <label className="col-span-2 text-xs text-muted sm:col-span-4">
              Description
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mt-0.5 w-full`} />
            </label>
          </div>

          {warn ? (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3">
              <p className="font-medium text-warning">You already marked this as paid{paidLine ? `: ${paidLine}` : ""}.</p>
              <p className="text-xs text-warning">Create another transaction of {amount ? usd(Number(amount.replace(",", ".")) || 0) : "this amount"} for “{title}”?</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => pay(true)} className="rounded-md bg-warning-solid px-3 py-1.5 font-medium text-black disabled:opacity-50">
                  {busy ? "Saving…" : "Yes, record it again"}
                </button>
                <button type="button" disabled={busy} onClick={() => setWarn(false)} className="rounded-md border border-edge bg-surface px-3 py-1.5 hover:bg-subtle">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} className="rounded-md bg-success-solid px-3 py-1.5 font-medium text-white disabled:opacity-50">
                {busy ? "Saving…" : paid ? "Mark as paid again" : kind === "income" ? "Mark as received" : "Mark as paid"}
              </button>
              {!paid && status !== "skipped" && (
                <button type="button" disabled={busy} onClick={skip} className="rounded-md border border-edge px-3 py-1.5 transition-colors hover:bg-subtle disabled:opacity-50">
                  Not this time
                </button>
              )}
              {paid && (
                <button type="button" onClick={() => setShowForm(false)} className="rounded-md px-3 py-1.5 text-muted hover:bg-subtle">
                  Cancel
                </button>
              )}
            </div>
          )}
        </form>
      )}
      {msg && <p className="text-danger">{msg}</p>}
    </div>
  );
}

export function StopPaymentButton({ id, name }: { id: string; name: string }) {
  const { go, busy } = useRun();
  return (
    <button
      disabled={busy}
      onClick={() => window.confirm(`Stop "${name}"? Upcoming unpaid ones are removed; paid ones stay.`) && go(() => stopPaymentTemplate({ id }))}
      className="text-xs text-muted hover:text-danger"
    >
      Stop
    </button>
  );
}
