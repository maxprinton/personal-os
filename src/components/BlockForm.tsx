"use client";

import { useActionState, useEffect, useRef } from "react";
import { createBlock, type ActionState } from "@/app/actions";
import { WEEKDAYS } from "@/lib/time";

const DAY_LABEL: Record<string, string> = {
  MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};

export default function BlockForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createBlock, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <h2 className="font-medium">New time block</h2>
      <input name="title" required placeholder="e.g. Deep work, Gym time" className="w-full rounded-md border border-neutral-300 px-3 py-2" />
      <div className="flex gap-3">
        <label className="flex-1 text-sm">Start
          <input type="time" name="start" required className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
        <label className="flex-1 text-sm">End
          <input type="time" name="end" required className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-2 text-sm">
        <legend className="mb-1 w-full">Repeats on</legend>
        {WEEKDAYS.map((d) => (
          <label key={d} className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1">
            <input type="checkbox" name="days" value={d} defaultChecked={!["SA", "SU"].includes(d)} />
            {DAY_LABEL[d]}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_habit" /> Track as habit
        </label>
        <label className="flex items-center gap-2">
          Color <input type="color" name="color" defaultValue="#6366f1" />
        </label>
      </div>
      <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Saving..." : "Add block"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">Block added.</p>}
    </form>
  );
}
