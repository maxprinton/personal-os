"use client";

import { useActionState } from "react";
import { addLink } from "@/app/task-actions";
import type { ActionState } from "@/app/actions";

type Option = { value: string; label: string };

export default function LinkForm({
  sourceType,
  sourceId,
  options,
}: {
  sourceType: "task" | "note";
  sourceId: string;
  options: Option[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addLink, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="source_type" value={sourceType} />
      <input type="hidden" name="source_id" value={sourceId} />
      <select name="target" defaultValue="" className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-sm">
        <option value="" disabled>Link to a block or event…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button disabled={pending} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1 text-sm disabled:opacity-50">
        Link
      </button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
