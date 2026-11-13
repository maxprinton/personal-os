"use client";

import { useActionState, useEffect, useRef } from "react";
import { addSeries } from "@/app/series-actions";
import type { ActionState } from "@/app/actions";
import { WritingInput } from "@/components/WritingField";
import { emitCalendarChanged } from "@/components/calendar/util";

type Option = { value: string; label: string };

/** Tasks → Recurring → "New recurring task": create it once, it assigns itself every time you finish it. */
export default function RecurringForm({ today, blockOptions }: { today: string; blockOptions: Option[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSeries, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      emitCalendarChanged();
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-card">
      <h3 className="font-medium">New recurring task</h3>
      <WritingInput area="tasks" name="title" required placeholder="e.g. Clean the bathroom" className="w-full rounded-md border border-line-strong px-3 py-2" />
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="w-24">
          Every
          <input type="number" name="repeat_every" min={1} max={366} defaultValue={3} className="mt-1 w-full rounded-md border border-line-strong px-3 py-2" />
        </label>
        <label className="w-32">
          <span className="sr-only">Unit</span>
          <select name="repeat_unit" defaultValue="days" className="w-full rounded-md border border-line-strong px-3 py-2">
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </label>
        <span className="pb-2 text-muted">after I finish it</span>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="min-w-40 flex-1">
          First one on
          <input type="date" name="first_due" min={today} defaultValue={today} className="mt-1 w-full rounded-md border border-line-strong px-3 py-2" />
        </label>
        <label className="min-w-40 flex-1">
          Home block
          <select name="home_block" defaultValue="" className="mt-1 w-full rounded-md border border-line-strong px-3 py-2">
            <option value="">— None (I&apos;ll place it) —</option>
            {blockOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        If not done by the end of the day
        <select name="rollover_policy" defaultValue="migrate" className="mt-1 w-full rounded-md border border-line-strong px-3 py-2">
          <option value="migrate">Reschedule to the next time its block happens (else tomorrow)</option>
          <option value="backlog">Send to backlog</option>
        </select>
      </label>
      <label className="block text-sm">
        Tags (comma separated)
        <input name="tags" placeholder="home, chores" className="mt-1 w-full rounded-md border border-line-strong px-3 py-2" />
      </label>
      <p className="text-xs text-muted">
        It is one task at a time: nothing piles up if you are late. The next one appears on its day, in its home block if that block is on the calendar that
        day; otherwise it stays on that day for you to place.
      </p>
      <button disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50">
        {pending ? "Saving..." : "Add recurring task"}
      </button>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-success">Added. Its first task is in Today / Upcoming.</p>}
    </form>
  );
}
