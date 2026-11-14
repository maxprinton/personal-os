"use client";

import { useActionState } from "react";
import { saveBacklogSettings } from "@/app/backlog-actions";
import type { ActionState } from "@/app/actions";
import { btnSecondary, inputCls } from "@/components/calendar/Modal";
import type { BacklogSettings } from "@/lib/backlog/board";

/** Caps, the real-use check, the 30-second prompt and the Monday summary. */
export default function SettingsForm({ settings: s }: { settings: BacklogSettings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBacklogSettings, {});
  const num = (name: string, label: string, value: number, min: number, max: number) => (
    <label className="text-sm">
      {label}
      <input type="number" name={name} min={min} max={max} defaultValue={value} className={`${inputCls} mt-1`} />
    </label>
  );
  return (
    <details className="rounded-2xl border border-line bg-surface p-4">
      <summary className="cursor-pointer select-none font-medium">Backlog settings</summary>
      <form action={action} className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {num("now_cap", "Max in Now", s.now_cap, 1, 10)}
          {num("next_cap", "Max in Next", s.next_cap, 1, 50)}
          {num("verifying_cap", "Max Verifying", s.verifying_cap, 1, 20)}
          {num("verify_days", "Days of real use", s.verify_days, 1, 60)}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="triage_prompt" defaultChecked={s.triage_prompt} /> Show the 30-second prompt after something reaches Verifying or Done
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="monday_summary" defaultChecked={s.monday_summary} /> Monday summary in Telegram
        </label>
        <p className="text-xs text-muted">Bugs never count toward the Now cap. Changing a cap never moves anything; it only applies to the next move.</p>
        <button disabled={pending} className={btnSecondary}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.ok && <p className="text-sm text-success">Saved.</p>}
      </form>
    </details>
  );
}
