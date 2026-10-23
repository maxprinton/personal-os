"use client";

import { useActionState, useEffect, useRef } from "react";
import { createEvent, type ActionState } from "@/app/actions";

type BlockOption = { id: string; label: string };

export default function EventForm({ today, blocks }: { today: string; blocks: BlockOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createEvent, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <h2 className="font-medium">New event</h2>
      <input name="title" required placeholder="e.g. Ashtanga yoga class" className="w-full rounded-md border border-neutral-300 px-3 py-2" />
      <div className="flex flex-wrap gap-3">
        <label className="flex-1 text-sm">Date
          <input type="date" name="date" required defaultValue={today} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="flex-1 text-sm">Start
          <input type="time" name="start" required className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="flex-1 text-sm">End
          <input type="time" name="end" required className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
      </div>
      <label className="block text-sm">Fulfills a time block (optional)
        <select name="fulfills" defaultValue="" className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2">
          <option value="">— None —</option>
          {blocks.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_habit" /> Track as habit
      </label>
      <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Saving..." : "Add event"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">Event added.</p>}
    </form>
  );
}
