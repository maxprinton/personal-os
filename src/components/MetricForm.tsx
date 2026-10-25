"use client";

import { useActionState, useEffect, useRef } from "react";
import { createMetric } from "@/app/habit-actions";
import type { ActionState } from "@/app/actions";

export default function MetricForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createMetric, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-4 sm:grid-cols-6 bg-surface shadow-card">
      <input name="name" required placeholder="Metric (e.g. Sleep)" className="col-span-2 rounded-md border border-line-strong px-2 py-1.5 text-sm" />
      <input name="unit" required placeholder="Unit (h)" className="rounded-md border border-line-strong px-2 py-1.5 text-sm" />
      <input name="min_value" inputMode="decimal" placeholder="Min" className="rounded-md border border-line-strong px-2 py-1.5 text-sm" />
      <input name="max_value" inputMode="decimal" placeholder="Max" className="rounded-md border border-line-strong px-2 py-1.5 text-sm" />
      <input name="daily_goal" inputMode="decimal" placeholder="Daily goal" className="rounded-md border border-line-strong px-2 py-1.5 text-sm" />
      <button disabled={pending} className="col-span-2 rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50 sm:col-span-6">
        {pending ? "Saving..." : "Add metric"}
      </button>
      {state.error && <p className="col-span-2 text-sm text-danger sm:col-span-6">{state.error}</p>}
    </form>
  );
}
