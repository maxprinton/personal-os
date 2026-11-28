"use client";
// Envelopes on the Finance page (27 Nov 2026): each one with its rollover switch in view, Edit (name, monthly
// amount, categories, Set aside / Just watch), Remove, and its last 6 months when you tap its name; plus "+ New envelope".
// Numbers come from lib/budget-rollover.ts; what envelopes take out of Spending money is shown in the Budget section.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBudget, saveEnvelope, setBudgetRollover } from "@/app/finance-actions";
import type { PeriodLine } from "@/lib/budget-rollover";

export type CategoryBudgetView = {
  id: string;
  name: string;
  /** The typed name ("" = named after its categories). */
  typedName: string;
  period: "weekly" | "monthly";
  limit: number;
  rollover: boolean;
  /** set_aside: holds its money from Spending money. watch: only tracks spending against the limit. */
  mode: "set_aside" | "watch";
  categoryIds: string[];
  categoryNames: string[];
  status: PeriodLine & { pct: number };
  /** Newest first. */
  history: PeriodLine[];
};
export type EnvelopeCategory = { id: string; name: string; envelopeId: string | null };

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const signedUsd = (n: number) => (n > 0 ? `+${usd(n)}` : n < 0 ? `−${usd(-n)}` : usd(0));
const input = "rounded-md border border-line-strong px-3 py-1.5 text-sm";
const btn = "rounded-md border border-edge px-2.5 py-1 text-xs transition-colors hover:bg-subtle disabled:opacity-50";

function periodLabel(start: string, period: "weekly" | "monthly") {
  const d = new Date(`${start}T12:00:00Z`);
  return period === "weekly"
    ? `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function Switch({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      title={on ? "Rollover on: what is left (or overspent) stays in the envelope for next month" : "Rollover off: each month starts fresh; the leftover goes back to Spending money"}
      className="flex items-center gap-1.5 text-xs text-muted disabled:opacity-50"
    >
      <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${on ? "bg-accent" : "bg-subtle-2"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </span>
      Rollover
    </button>
  );
}

/** Name + monthly amount + categories. Categories in another envelope are shown but can't be picked. */
function EnvelopeForm({
  initial,
  categories,
  onDone,
}: {
  initial: { id: string | null; name: string; amount: string; categoryIds: string[]; mode: "set_aside" | "watch" };
  categories: EnvelopeCategory[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initial.name);
  const [amount, setAmount] = useState(initial.amount);
  const [ids, setIds] = useState<string[]>(initial.categoryIds);
  const [mode, setMode] = useState(initial.mode);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <form
      className="space-y-2 border-t border-line pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveEnvelope({ id: initial.id, name, amount, categoryIds: ids, mode }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : "Could not save it." }));
          if (r.error) return setError(r.error);
          onDone();
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name (optional with a category)" className={`${input} w-56`} />
        <label className="flex items-center gap-1 text-xs text-muted">
          $ per month
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${input} w-24`} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of envelope">
        {(
          [
            ["set_aside", "Set aside money", "Holds this amount from Spending money every month; spending in its categories comes out of it."],
            ["watch", "Just watch", "Holds no money: its payments count as usual (recurring ones in Fixed costs). It only warns you at 80% and 100%."],
          ] as const
        ).map(([v, label, hint]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            title={hint}
            onClick={() => setMode(v)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${mode === v ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-subtle"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-faint">
        {mode === "watch"
          ? "Just watch: no money is held. Its payments stay in Fixed costs or spending, subtracted when paid; you get a warning at 80% and 100% of the limit."
          : "Set aside: this amount is held from Spending money every month; spending in its categories comes out of the envelope."}
      </p>
      <div className="space-y-1">
        <p className="text-xs text-muted">Categories that spend from it {mode === "watch" ? "(pick at least one)" : "(none = a pot that only sets money aside)"}</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const elsewhere = c.envelopeId !== null && c.envelopeId !== initial.id;
            const on = ids.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={elsewhere}
                onClick={() => toggle(c.id)}
                title={elsewhere ? "Already in another envelope" : undefined}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-subtle"
                }`}
              >
                {on ? "✓ " : ""}
                {c.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={pending}>
          {pending ? "Saving…" : initial.id ? "Save" : "Create envelope"}
        </button>
        <button type="button" className="text-xs text-muted hover:text-fg" onClick={onDone}>
          Cancel
        </button>
        {initial.id && <span className="text-xs text-faint">A new amount counts for this whole month.</span>}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

function EnvelopeCard({ b, categories }: { b: CategoryBudgetView; categories: EnvelopeCategory[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = b.status;
  const pot = b.categoryIds.length === 0;
  const over = s.left < 0;
  const unit = b.period === "weekly" ? "week" : "month";

  const toggleRollover = () =>
    start(async () => {
      setError(null);
      const r = await setBudgetRollover(b.id, !b.rollover).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Could not save it." }));
      if (r.error) return setError(r.error);
      router.refresh();
    });

  return (
    <li className="space-y-1.5 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 text-left" aria-expanded={open} title="Show the last months">
          <span className="font-medium">{b.name}</span> <span className="text-xs text-faint">{open ? "▾" : "▸"}</span>
          <span className="block text-xs text-muted">
            {b.mode === "watch" ? "👁 Just watching · " : ""}
            {pot ? "Pot: money set aside, no categories" : b.categoryNames.join(", ")}
          </span>
        </button>
        <p className={`text-sm tabular-nums ${over ? "text-danger" : "text-muted"}`}>
          {pot ? `${usd(s.available)} set aside` : `${usd(s.spent)} / ${usd(s.available)} · ${over ? `${usd(-s.left)} over` : `${usd(s.left)} left`}`}
        </p>
      </div>
      {!pot && (
        <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
          <div
            className={`h-1.5 rounded-full ${over ? "bg-danger-solid" : s.pct > 80 ? "bg-warning-solid" : "bg-success-solid"}`}
            style={{ width: `${Math.min(100, Math.max(0, s.pct))}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted">
        {usd(s.limit)} {b.mode === "watch" ? "limit" : "set aside"} a {unit}
        {s.rollover ? ` ${signedUsd(s.carriedIn)} carried from last ${unit}` : ""}
        {s.capped ? ` (capped at ${usd(s.limit * 2)}${b.mode === "watch" ? "" : `; ${usd(s.returned)} went back to Spending money`})` : ""}
        {s.available < 0 ? ` · you start this ${unit} behind` : ""}
        {pot && !s.rollover ? ` · turn Rollover on to let it grow (up to ${usd(s.limit * 2)})` : ""}
        {b.mode === "watch" ? " · no money held: payments count as usual" : ""}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <Switch on={b.rollover} disabled={pending} onToggle={toggleRollover} />
        <div className="flex items-center gap-2">
          {!editing && (
            <button type="button" className={btn} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <form
            action={deleteBudget}
            onSubmit={(e) => {
              if (!window.confirm(`Remove the “${b.name}” envelope?${b.mode === "watch" ? "" : " Its money goes back to Spending money."}`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={b.id} />
            <button className="text-xs text-faint hover:text-danger">Remove</button>
          </form>
        </div>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}

      {editing && (
        <EnvelopeForm
          initial={{ id: b.id, name: b.typedName, amount: String(b.limit), categoryIds: b.categoryIds, mode: b.mode }}
          categories={categories}
          onDone={() => setEditing(false)}
        />
      )}

      {open && (
        <div className="overflow-x-auto border-t border-line pt-2">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-faint">
              <tr>
                <th className="py-1 text-left font-normal">{b.period === "weekly" ? "Week" : "Month"}</th>
                <th className="py-1 text-right font-normal">Amount</th>
                {b.history.some((h) => h.rollover) && <th className="py-1 text-right font-normal">Carried</th>}
                <th className="py-1 text-right font-normal">Available</th>
                <th className="py-1 text-right font-normal">Spent</th>
                <th className="py-1 text-right font-normal">Left</th>
              </tr>
            </thead>
            <tbody>
              {b.history.map((h) => (
                <tr key={h.start} className="border-t border-line/60">
                  <td className="py-1 text-left">{periodLabel(h.start, b.period)}</td>
                  <td className="py-1 text-right text-muted">{usd(h.limit)}</td>
                  {b.history.some((x) => x.rollover) && <td className="py-1 text-right text-muted">{h.rollover ? signedUsd(h.carriedIn) : "—"}</td>}
                  <td className="py-1 text-right">{usd(h.available)}</td>
                  <td className="py-1 text-right">{usd(h.spent)}</td>
                  <td className={`py-1 text-right ${h.left < 0 ? "text-danger" : "text-success"}`}>{h.left < 0 ? `${usd(-h.left)} over` : usd(h.left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.history.length < 6 && <p className="pt-1 text-xs text-faint">History starts when the envelope was created{b.history.length === 1 ? ", so there is only this month so far" : ""}.</p>}
        </div>
      )}
    </li>
  );
}

export default function CategoryBudgets({ budgets, categories }: { budgets: CategoryBudgetView[]; categories: EnvelopeCategory[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2">
      {budgets.length === 0 && <p className="text-sm text-faint">No envelopes yet.</p>}
      <ul className="space-y-2">
        {budgets.map((b) => (
          <EnvelopeCard key={b.id} b={b} categories={categories} />
        ))}
      </ul>
      {adding ? (
        <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
          <p className="text-sm font-medium">New envelope</p>
          <EnvelopeForm initial={{ id: null, name: "", amount: "", categoryIds: [], mode: "set_aside" }} categories={categories} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button type="button" className={btn} onClick={() => setAdding(true)}>
          + New envelope
        </button>
      )}
    </div>
  );
}
