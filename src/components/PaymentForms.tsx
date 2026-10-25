"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmPayment, createPayment, skipPayment, stopPaymentTemplate } from "@/app/calendar-actions";
import type { CalResult, FinanceOptions, PaymentTemplate } from "@/lib/calendar/types";
import type { RepeatUnit } from "@/lib/calendar/recurrence";
import { emitCalendarChanged } from "@/components/calendar/util";

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

/** The pre-filled draft of a payment on its day: real amount + confirm (or skip). */
export function PaymentDraft({
  eventId,
  title,
  date,
  template,
  options,
  today,
  run,
  onDone,
  readOnly = false,
}: {
  eventId: string;
  title: string;
  date: string;
  template: PaymentTemplate | null;
  options: Omit<FinanceOptions, "templates">;
  today: string;
  run?: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onDone?: () => void;
  readOnly?: boolean;
}) {
  const { go, msg, busy } = useRun(run);
  const [amount, setAmount] = useState(template?.expected_amount ? String(template.expected_amount) : "");
  const [account, setAccount] = useState(template?.account_id ?? options.accounts[0]?.id ?? "");
  const [category, setCategory] = useState(template?.category_id ?? "");
  const [on, setOn] = useState(date > today ? today : date);
  const kind = template?.type ?? "expense";

  if (readOnly) {
    return (
      <p className="text-sm">
        💳 {title} <span className="text-muted">· due {date}{template?.expected_amount ? ` · expected $${template.expected_amount.toFixed(2)}` : ""} · confirm it on the computer</span>
      </p>
    );
  }
  if (date > today) {
    return (
      <p className="text-sm text-muted">
        Upcoming payment{template?.expected_amount ? ` · expected $${template.expected_amount.toFixed(2)}` : ""}. The draft opens on {date}.
      </p>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await go(() => confirmPayment({ eventId, amount, accountId: account, categoryId: category, date: on, description: title }))) onDone?.();
      }}
      className="space-y-2 text-sm"
    >
      <p className="font-medium">
        💳 {title} <span className="font-normal text-muted">· due {date}{template?.expected_amount ? ` · expected $${template.expected_amount.toFixed(2)}` : ""}</span>
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Real amount $" className={input} />
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={input}>
          <option value="">No account</option>
          {options.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
          <option value="">No category</option>
          {options.categories
            .filter((c) => c.kind === kind)
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>
        <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className={input} />
      </div>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-md bg-success-solid px-3 py-1.5 text-white font-medium disabled:opacity-50">
          Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (await go(() => skipPayment({ eventId }))) onDone?.();
          }}
          className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 disabled:opacity-50"
        >
          Not this time
        </button>
      </div>
      {msg && <p className="text-danger">{msg}</p>}
    </form>
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
