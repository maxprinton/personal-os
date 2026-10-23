"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTask } from "@/app/task-actions";
import type { ActionState } from "@/app/actions";

type Option = { value: string; label: string };

export default function TaskForm({ today, linkOptions }: { today: string; linkOptions: Option[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createTask, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <h2 className="font-medium">New task</h2>
      <input name="title" required placeholder="What needs doing?" className="w-full rounded-md border border-neutral-300 px-3 py-2" />
      <div className="flex flex-wrap gap-3">
        <label className="flex-1 text-sm">Date
          <input type="date" name="scheduled_for" defaultValue={today} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="flex-1 text-sm">If not done by midnight
          <select name="rollover_policy" defaultValue="migrate" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2">
            <option value="migrate">Move to tomorrow</option>
            <option value="backlog">Send to backlog</option>
            <option value="graveyard">Mark as failed</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex-1 text-sm">Tags (comma separated)
          <input name="tags" placeholder="work, errands" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="flex-1 text-sm">Show during (optional)
          <select name="link" defaultValue="" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2">
            <option value="">— Nothing —</option>
            {linkOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="no_date" /> No date (straight to backlog)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_habit" /> Track as habit</label>
      </div>
      <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Saving..." : "Add task"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">Task added.</p>}
    </form>
  );
}
