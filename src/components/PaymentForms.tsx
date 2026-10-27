"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmPayment, createPayment, editPaymentOccurrence, skipPayment, stopPaymentTemplate, updatePayment } from "@/app/calendar-actions";
import type { CalResult, FinanceOptions, PaymentTemplate } from "@/lib/calendar/types";
import type { RepeatUnit } from "@/lib/calendar/recurrence";
import { emitCalendarChanged } from "@/components/calendar/util";
import Modal from "@/components/calendar/Modal";
import { getPaymentRecords, getSuggestedPaymentAccount, setPaymentTemplateAccount } from "@/app/payment-actions";

const input = "rounded-md border border-line-strong px-3 py-2 text-sm";

function useRun(run?: (fn: () => Promise<CalResult>) => Promise<boolean>) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The last success message from the server (e.g. "2 overdue payments stay to pay"). */
  const lastNote = useRef<string | null>(null);
  async function go(fn: () => Promise<CalResult>) {
    setBusy(true);
    let ok: boolean;
    lastNote.current = null;
    if (run) ok = await run(fn); // the calendar shows errors and notices itself
    else {
      const r = await fn();
      ok = !r.error;
      setMsg(r.error ?? null);
      lastNote.current = r.notice ?? null;
      setNote(r.notice ?? null);
      emitCalendarChanged();
      router.refresh();
    }
    setBusy(false);
    return ok;
  }
  return { go, msg, busy, note, lastNote };
}

/**
 * New scheduled payment, or (with `template`) edit one. The same form is used on the Finance page and
 * in the calendar, and both create the same records (a template and its events).
 */
export function PaymentForm({
  options,
  date,
  run,
  onDone,
  template,
  onCancel,
}: {
  options: Omit<FinanceOptions, "templates">;
  date: string;
  run?: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onDone?: () => void;
  /** Edit this scheduled payment instead of creating a new one. */
  template?: PaymentTemplate;
  onCancel?: () => void;
}) {
  const { go, msg, busy, note, lastNote } = useRun(run);
  const [saved, setSaved] = useState(false);
  const t = template;
  const [name, setName] = useState(t?.name ?? "");
  const [type, setType] = useState<"expense" | "income">(t?.type ?? "expense");
  const [amount, setAmount] = useState(t?.expected_amount ? t.expected_amount.toFixed(2) : "");
  const [account, setAccount] = useState(t ? t.account_id ?? "" : options.accounts[0]?.id ?? "");
  const [category, setCategory] = useState(t?.category_id ?? "");
  const [start, setStart] = useState(t?.start_date ?? date);
  const [unit, setUnit] = useState<RepeatUnit>((t?.repeat_unit as RepeatUnit | undefined) ?? "months");
  const [every, setEvery] = useState(t?.repeat_every ?? 1);
  const [end, setEnd] = useState(t?.end_date ?? "");
  const datesChanged =
    !!t && (start !== t.start_date || unit !== t.repeat_unit || every !== t.repeat_every || (end || null) !== (t.end_date ?? null));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const values = {
          name,
          type,
          expectedAmount: amount,
          accountId: account,
          categoryId: category,
          startDate: start,
          repeatUnit: unit,
          repeatEvery: every,
          endDate: end,
        };
        const ok = await go(() => (t ? updatePayment({ id: t.id, ...values }) : createPayment(values)));
        if (ok) {
          if (!t) {
            setName("");
            setAmount("");
          }
          // Something to read first (e.g. overdue payments that stay): keep the form open with the message
          if (lastNote.current) setSaved(true);
          else onDone?.();
        }
      }}
      className="space-y-2 rounded-lg border border-line p-3 text-sm bg-surface shadow-card"
    >
      {t && <p className="text-xs font-medium text-muted">Edit scheduled payment</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, Internet…" className={`${input} col-span-2`} />
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as "expense" | "income");
            setCategory(""); // categories are per kind
          }}
          className={input}
        >
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
          {unit === "none" ? "Date" : "First date"}
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={`${input} w-full`} />
        </label>
        {unit !== "none" && (
          <label className="text-xs text-muted">
            Ends (optional)
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={`${input} w-full`} />
          </label>
        )}
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
        <span className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-md border border-edge px-3 py-2 transition-colors hover:bg-subtle">
              Cancel
            </button>
          )}
          <button disabled={busy} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-accent-fg disabled:opacity-50">
            {busy ? "Saving…" : t ? "Save changes" : "Schedule payment"}
          </button>
        </span>
      </div>
      {saved && note && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-success-soft px-3 py-2 text-xs text-success">
          <span>✓ Saved. {note}</span>
          <button type="button" onClick={() => onDone?.()} className="font-medium underline">
            OK
          </button>
        </div>
      )}
      {t ? (
        <p className="text-xs text-muted">
          Every payment not paid yet follows these details, overdue ones too. Paid and skipped ones keep what was recorded.
          {datesChanged &&
            (unit === "none" && t.repeat_unit === "none"
              ? " New date: the payment moves there (if it isn't paid yet)."
              : " New dates: upcoming unpaid payments are redone with the new schedule; overdue ones stay to pay.")}{" "}
          A payment you edited on its own keeps its own amount.
        </p>
      ) : (
        <p className="text-xs text-muted">It shows on the calendar as an event. Pay it from here, the calendar or Events: the transaction comes pre-filled with these details.</p>
      )}
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
  expected = null,
}: {
  eventId: string;
  title: string;
  date: string;
  /** The series this payment belongs to (null = a payment on its own). */
  template: PaymentTemplate | null;
  options: Omit<FinanceOptions, "templates">;
  today: string;
  /** This payment's own expected amount ("edit only this one"); null = the series amount. */
  expected?: number | null;
  /** Kept for old call sites; the draft talks to the server itself so it can show the "already paid" warning. */
  run?: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onDone?: () => void;
  readOnly?: boolean;
  status?: "paid" | "skipped" | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const own = expected ?? null;
  const expectedAmount = own ?? template?.expected_amount ?? null;
  const [amount, setAmount] = useState(expectedAmount ? expectedAmount.toFixed(2) : "");
  const [editing, setEditing] = useState<null | "one" | "series">(null);
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

  // Suggest the account used the last time this payment was paid (you can still pick another)
  const [accountHint, setAccountHint] = useState<string | null>(null);
  const [touchedAccount, setTouchedAccount] = useState(false);
  useEffect(() => {
    if (!showForm || readOnly) return;
    let alive = true;
    getSuggestedPaymentAccount(eventId)
      .then((r) => {
        if (!alive) return;
        const name = r.accountId ? options.accounts.find((a) => a.id === r.accountId)?.name : null;
        if (r.accountId && name && !touchedAccount) setAccount(r.accountId);
        setAccountHint(
          r.source === "last" && name
            ? `Last paid from ${name}${r.lastDate ? ` (${nice(r.lastDate)})` : ""}`
            : r.source === "template" && name
              ? `First payment · its usual account is ${name}`
              : null
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, showForm, readOnly]);

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
        {expectedAmount ? ` · ${usd(expectedAmount)}` : ""}
        {own !== null && template?.expected_amount && own !== template.expected_amount ? " (this one only)" : ""}
      </span>
    </p>
  );

  const editLinks = !readOnly && (
    <p className="flex flex-wrap gap-3 text-xs">
      {status === null && (
        <button type="button" onClick={() => setEditing(editing === "one" ? null : "one")} className="text-muted underline hover:text-fg">
          {editing === "one" ? "Close" : "Edit only this one"}
        </button>
      )}
      {template && (
        <button type="button" onClick={() => setEditing(editing === "series" ? null : "series")} className="text-muted underline hover:text-fg">
          {editing === "series" ? "Close" : "Edit the series"}
        </button>
      )}
    </p>
  );
  const editPanel =
    editing === "one" ? (
      <EditOnePayment
        eventId={eventId}
        date={date}
        own={own}
        seriesAmount={template?.expected_amount ?? null}
        onDone={() => {
          setEditing(null);
          onDone?.();
        }}
        onCancel={() => setEditing(null)}
      />
    ) : editing === "series" && template ? (
      <PaymentForm
        options={options}
        date={today}
        template={template}
        onCancel={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          onDone?.();
        }}
      />
    ) : null;

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
      {editLinks}
      {editPanel}

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

      {showForm && !editing && (
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
              <select
                value={account}
                onChange={(e) => {
                  setTouchedAccount(true);
                  setAccount(e.target.value);
                }}
                className={`${input} mt-0.5 w-full`}
              >
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
            {accountHint && (
              <p className="col-span-2 -mt-1 text-[11px] text-muted sm:col-span-4">
                {accountHint}
                {touchedAccount ? " · you picked another account for this one" : " · change it above if you pay from another account"}
              </p>
            )}
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

/**
 * One payment in the Finance list: a compact line that opens the same pre-filled transaction as the
 * calendar ("Pay" before or on its day, "Details" once paid — paying again asks first).
 */
export function PaymentRow({
  eventId,
  title,
  date,
  template,
  options,
  today,
  status = null,
  readOnly = false,
  prefix,
  expected = null,
}: {
  eventId: string;
  title: string;
  date: string;
  template: PaymentTemplate | null;
  options: Omit<FinanceOptions, "templates">;
  today: string;
  status?: "paid" | "skipped" | null;
  readOnly?: boolean;
  /** Optional text before the title (e.g. "Next:"). */
  prefix?: string;
  /** This payment's own expected amount; null = the series amount. */
  expected?: number | null;
}) {
  const amountShown = expected ?? template?.expected_amount ?? null;
  const [open, setOpen] = useState(false);
  const due = !status && date <= today;
  const badge =
    status === "paid"
      ? { text: "✓ Paid", cls: "bg-success-soft text-success" }
      : status === "skipped"
        ? { text: "Skipped", cls: "bg-subtle-2 text-muted" }
        : due
          ? { text: date < today ? "Overdue" : "Due today", cls: "bg-warning-soft text-warning" }
          : null;
  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {prefix && <span className="text-muted">{prefix} </span>}💳 {title} <span className="text-faint">· {nice(date)}</span>
        </span>
        <span className="tabular-nums text-muted">{amountShown ? usd(amountShown) : "—"}</span>
        {badge && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.text}</span>}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`compact rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            open
              ? "bg-subtle text-fg"
              : status
                ? "border border-edge text-muted hover:bg-subtle"
                : "bg-success-solid text-white hover:opacity-90"
          }`}
        >
          {open ? "Close" : status === "paid" ? "Details" : status === "skipped" ? "Open" : template?.type === "income" ? "Receive" : "Pay"}
        </button>
      </div>
      {open && (
        <div className="border-t border-success/30 bg-success-soft p-3">
          <PaymentDraft
            eventId={eventId}
            title={title}
            date={date}
            template={template}
            options={options}
            today={today}
            status={status}
            readOnly={readOnly}
            expected={expected}
            onDone={() => setOpen(false)}
          />
        </div>
      )}
    </li>
  );
}

/** Finance → Scheduled payments: change a payment's usual account at any time. */
export function TemplateAccountSelect({
  templateId,
  accountId,
  accounts,
  disabled = false,
}: {
  templateId: string;
  accountId: string | null;
  accounts: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(accountId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      Account
      <select
        value={value}
        disabled={disabled || state === "saving"}
        onChange={async (e) => {
          const v = e.target.value;
          setValue(v);
          setState("saving");
          const r = await setPaymentTemplateAccount({ templateId, accountId: v || null });
          setState(r.error ? "error" : "saved");
          router.refresh();
        }}
        className="compact rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-xs"
      >
        <option value="">No account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      {state === "saved" && <span className="text-success">✓</span>}
      {state === "error" && <span className="text-danger">Not saved</span>}
    </label>
  );
}

/** "Edit only this one": a payment's own date and expected amount. The series is not touched. */
function EditOnePayment({
  eventId,
  date,
  own,
  seriesAmount,
  onDone,
  onCancel,
}: {
  eventId: string;
  date: string;
  own: number | null;
  seriesAmount: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { go, msg, busy } = useRun();
  const [on, setOn] = useState(date);
  const [amount, setAmount] = useState(own !== null ? own.toFixed(2) : "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await go(() => editPaymentOccurrence({ eventId, date: on, expectedAmount: amount }))) onDone();
      }}
      className="space-y-2 rounded-md border border-line bg-surface p-3"
    >
      <p className="text-xs font-medium text-muted">Only this payment (the series stays as it is)</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Date
          <input type="date" required value={on} onChange={(e) => setOn(e.target.value)} className={`${input} mt-0.5 w-full`} />
        </label>
        <label className="text-xs text-muted">
          Expected amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={seriesAmount ? `${usd(seriesAmount)} (series)` : "$"}
            className={`${input} mt-0.5 w-full`}
          />
        </label>
      </div>
      <p className="text-[11px] text-muted">Leave the amount empty to use the series amount.</p>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg shadow-sm hover:bg-accent-hover disabled:opacity-50">
          {busy ? "Saving…" : "Save this one"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-edge px-3 py-1.5 hover:bg-subtle">
          Cancel
        </button>
      </div>
      {msg && <p className="text-danger">{msg}</p>}
    </form>
  );
}

/** Finance → Scheduled payments: "Edit" opens the whole payment (name, amount, type, account, category, dates). */
export function EditPaymentButton({
  template,
  options,
  today,
}: {
  template: PaymentTemplate;
  options: Omit<FinanceOptions, "templates">;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted underline hover:text-fg">
        Edit
      </button>
      {open && (
        <Modal title={`Edit “${template.name}”`} onClose={() => setOpen(false)} wide>
          <PaymentForm options={options} date={today} template={template} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
