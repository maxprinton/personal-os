"use client";
// Category budgets on the Finance page: each one with its rollover switch in view, an Edit form
// (limit and period) and its last 6 periods when you tap it. Numbers come from lib/budget-rollover.ts.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBudget, setBudgetRollover, updateBudget } from "@/app/finance-actions";
import type { PeriodLine } from "@/lib/budget-rollover";

export type CategoryBudgetView = {
  id: string;
  name: string;
  period: "weekly" | "monthly";
  limit: number;
  rollover: boolean;
  status: PeriodLine & { pct: number };
  /** Newest first. */
  history: PeriodLine[];
};

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
      title={on ? "Rollover on: unused money and overspending carry to the next period" : "Rollover off: every period starts at its limit"}
      className="flex items-center gap-1.5 text-xs text-muted disabled:opacity-50"
    >
      <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${on ? "bg-accent" : "bg-subtle-2"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </span>
      Rollover
    </button>
  );
}

function BudgetCard({ b }: { b: CategoryBudgetView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(String(b.limit));
  const [period, setPeriod] = useState(b.period);
  const [error, setError] = useState<string | null>(null);
  const s = b.status;
  const over = s.left < 0;
  const unit = b.period === "weekly" ? "week" : "month";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Could not save it." }));
      if (r.error) return setError(r.error);
      after?.();
      router.refresh();
    });

  return (
    <li className="space-y-1.5 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left font-medium" aria-expanded={open} title="Show the last periods">
          {b.name} <span className="text-xs font-normal text-muted">{b.period}</span>{" "}
          <span className="text-xs font-normal text-faint">{open ? "▾" : "▸"}</span>
        </button>
        <p className={`text-sm ${over ? "text-danger" : "text-muted"}`}>
          {usd(s.spent)} / {usd(s.available)} · {over ? `${usd(-s.left)} over` : `${usd(s.left)} left`}
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
        <div
          className={`h-1.5 rounded-full ${over ? "bg-danger-solid" : s.pct > 80 ? "bg-warning-solid" : "bg-success-solid"}`}
          style={{ width: `${Math.min(100, Math.max(0, s.pct))}%` }}
        />
      </div>
      {s.rollover && (
        <p className="text-xs text-muted">
          {usd(s.limit)} limit {signedUsd(s.carriedIn)} carried from last {unit}
          {s.capped ? ` (capped at ${usd(s.limit * 2)}, double the limit)` : ""}
          {s.available < 0 ? " · you start this " + unit + " behind" : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <Switch on={b.rollover} disabled={pending} onToggle={() => run(() => setBudgetRollover(b.id, !b.rollover))} />
        <div className="flex items-center gap-2">
          {!editing && (
            <button type="button" className={btn} onClick={() => setEditing(true)} disabled={pending}>
              Edit
            </button>
          )}
          <form action={deleteBudget}>
            <input type="hidden" name="id" value={b.id} />
            <button className="text-xs text-faint hover:text-danger">Remove</button>
          </form>
        </div>
      </div>

      {editing && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-line pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateBudget({ id: b.id, limit, period }), () => setEditing(false));
          }}
        >
          <label className="flex items-center gap-1 text-xs text-muted">
            Limit
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" className={`${input} w-28`} autoFocus />
          </label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as "weekly" | "monthly")} className={input}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
          <button className={btn} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="text-xs text-muted hover:text-fg"
            onClick={() => {
              setEditing(false);
              setLimit(String(b.limit));
              setPeriod(b.period);
              setError(null);
            }}
          >
            Cancel
          </button>
          <p className="w-full text-xs text-faint">
            A new limit counts for this whole {unit}.{period !== b.period ? " Changing the period starts this budget's history again." : ""}
          </p>
        </form>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}

      {open && (
        <div className="overflow-x-auto border-t border-line pt-2">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-faint">
              <tr>
                <th className="py-1 text-left font-normal">{b.period === "weekly" ? "Week" : "Month"}</th>
                <th className="py-1 text-right font-normal">Limit</th>
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
          {b.history.length < 6 && <p className="pt-1 text-xs text-faint">History starts when the budget was created{b.history.length === 1 ? ", so there is only this period so far" : ""}.</p>}
        </div>
      )}
    </li>
  );
}

export default function CategoryBudgets({ budgets }: { budgets: CategoryBudgetView[] }) {
  if (!budgets.length) return <p className="text-sm text-faint">No budgets yet.</p>;
  return (
    <ul className="space-y-2">
      {budgets.map((b) => (
        <BudgetCard key={b.id} b={b} />
      ))}
    </ul>
  );
}
