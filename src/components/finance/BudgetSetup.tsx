"use client";
// Budget guided setup (BL-117): one short step at a time. It can be redone any time from "Edit budget".
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBudgetSetup } from "@/app/budget-actions";

type Cat = { id: string; name: string };
type Tpl = { name: string; expected: number | null };
export type SetupInitial = {
  startDate: string;
  percent: string;
  counted: string[];
  openingSpending: string;
  openingSavings: string;
  names: [string, string, string];
  buckets: { name: string; amount: string }[];
};

const input = "rounded-md border border-line-strong px-3 py-2 text-sm";
const btn = "rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:bg-subtle disabled:opacity-40";
const primary = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";
const STEPS = ["Income that counts", "How much to save", "Fixed costs", "Starting money", "Buckets"];

export default function BudgetSetup({
  initial,
  incomeCategories,
  templates,
  hasPets,
  hasSettings,
}: {
  initial: SetupInitial;
  incomeCategories: Cat[];
  templates: Tpl[];
  hasPets: boolean;
  hasSettings: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!hasSettings);
  const [step, setStep] = useState(0);
  const [pending, run] = useTransition();
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [percent, setPercent] = useState(initial.percent);
  const [counted, setCounted] = useState<string[]>(initial.counted);
  const [openSpend, setOpenSpend] = useState(initial.openingSpending);
  const [openSave, setOpenSave] = useState(initial.openingSavings);
  const [names, setNames] = useState<[string, string, string]>(initial.names);
  const [buckets, setBuckets] = useState(initial.buckets);

  const p = Number(percent.replace(",", "."));
  const example = Number.isFinite(p) && p >= 0 && p <= 100 ? `Of every $100 you earn, $${(p).toFixed(p % 1 ? 2 : 0)} is set aside.` : "";

  function save() {
    setError("");
    run(async () => {
      const r = await saveBudgetSetup({
        start_date: startDate,
        savings_percent: percent,
        counted_category_ids: counted,
        opening_spending: openSpend,
        opening_savings: openSave,
        names,
        buckets: buckets.map((b) => ({ name: b.name, monthly_amount: b.amount })),
      });
      if (r.error) return setError(r.error);
      setOpen(false);
      setStep(0);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        Edit budget
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{hasSettings ? "Edit budget" : "Set up your budget"}</h3>
        <span className="text-xs text-muted">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </span>
      </div>

      {step === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">Which income categories are money you can budget with? Other income is ignored and nothing is set aside from it.</p>
          {incomeCategories.length === 0 && <p className="text-sm text-faint">You have no income categories yet. Add one in Categories first.</p>}
          {incomeCategories.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={counted.includes(c.id)} onChange={(e) => setCounted((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)))} />
              {c.name}
            </label>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">The part of every counted payment that goes to {names[0]}. You can skip it on a single payment when you log it.</p>
          <label className="flex items-center gap-2 text-sm">
            <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" aria-label="Saving percentage" className={`${input} w-24`} /> %
          </label>
          {example && <p className="text-xs text-muted">{example}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2 text-sm">
          <p className="text-muted">Fixed costs are added up for you from payments you already log. Nothing to type here.</p>
          <p className="font-medium">Subscriptions and recurring payments</p>
          {templates.length === 0 ? (
            <p className="text-faint">No scheduled payments yet. Add them under Scheduled payments and they count here.</p>
          ) : (
            <ul className="list-disc pl-5">
              {templates.map((t) => (
                <li key={t.name}>
                  {t.name}
                  {t.expected ? ` · $${t.expected}` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="font-medium">Pets</p>
          <p className="text-muted">{hasPets ? "Log pet payments with the Pets category and they count as fixed costs." : "The Pets category is created by migration 0074. After it, log pet payments there and they count as fixed costs."} Log them now so the number is real.</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">Where you start. Only income and spending after the start date change these.</p>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Starting amount for {names[2]}</span>
            <input value={openSpend} onChange={(e) => setOpenSpend(e.target.value)} inputMode="decimal" className={`${input} w-40`} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Starting amount for {names[0]}</span>
            <input value={openSave} onChange={(e) => setOpenSave(e.target.value)} inputMode="decimal" className={`${input} w-40`} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Start date (earlier transactions do not count)</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${input} w-44`} />
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">Rename the three buckets, and add your own. An extra bucket sets a typed amount aside every month from the start date, out of {names[2]}.</p>
          {(["Saving", "Fixed costs", "What is left to spend"] as const).map((label, i) => (
            <label key={label} className="block space-y-1">
              <span className="text-xs text-muted">{label}</span>
              <input value={names[i]} maxLength={40} onChange={(e) => setNames((n) => n.map((x, j) => (j === i ? e.target.value : x)) as [string, string, string])} className={`${input} w-64`} />
            </label>
          ))}
          <p className="font-medium">Extra buckets</p>
          {buckets.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={b.name} maxLength={40} placeholder="Name" onChange={(e) => setBuckets((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${input} w-44`} />
              <input value={b.amount} inputMode="decimal" placeholder="$ per month" onChange={(e) => setBuckets((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${input} w-28`} />
              <button
                type="button"
                className="text-xs text-faint hover:text-danger"
                onClick={() => {
                  if (window.confirm(`Remove “${b.name || "this bucket"}”? Its money goes back to ${names[2]}.`)) setBuckets((l) => l.filter((_, j) => j !== i));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {buckets.length < 10 && (
            <button type="button" className={btn} onClick={() => setBuckets((l) => [...l, { name: "", amount: "" }])}>
              + Add a bucket
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {step > 0 && (
          <button type="button" className={btn} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className={primary} onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className={primary} disabled={pending} onClick={save}>
            {pending ? "Saving..." : "Save budget"}
          </button>
        )}
        {hasSettings && (
          <button type="button" className="ml-auto text-xs text-faint hover:text-fg" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
