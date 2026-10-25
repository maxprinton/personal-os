"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markHabit } from "@/app/calendar-actions";
import type { CalResult, HabitState } from "@/lib/calendar/types";
import { emitCalendarChanged } from "@/components/calendar/util";

const LABEL: Record<HabitState, string> = { done: "Done", skipped: "Skipped", missed: "Missed" };
const COLOR: Record<HabitState, string> = { done: "text-success", skipped: "text-warning", missed: "text-danger" };

/** ✓ / Skip for one habit in one block occurrence (skips keep the streak, up to 3 in a row). */
export default function HabitControls({
  habitId,
  occurrenceId,
  state,
  readOnly = false,
  compact = false,
  run,
}: {
  habitId: string;
  occurrenceId: string;
  state: HabitState | null;
  readOnly?: boolean;
  compact?: boolean;
  /** The calendar's runner (handles "edit the past" confirmation). */
  run?: (fn: () => Promise<CalResult>) => Promise<boolean>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: HabitState | null) {
    setBusy(true);
    if (run) {
      await run(() => markHabit({ habitId, occurrenceId, state: next }));
      setBusy(false);
      return;
    }
    const r = await markHabit({ habitId, occurrenceId, state: next });
    setBusy(false);
    setErr(r.error ?? null);
    emitCalendarChanged();
    router.refresh();
  }

  const btn = `rounded-md border ${compact ? "px-1.5 py-0.5" : "px-2 py-1"} text-xs disabled:opacity-50`;
  if (state) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className={`text-xs ${COLOR[state]}`}>{LABEL[state]}</span>
        {!readOnly && (
          <button disabled={busy} onClick={() => set(null)} className={`${btn} border-edge text-muted`}>
            Undo
          </button>
        )}
        {err && <span className="text-xs text-danger">{err}</span>}
      </span>
    );
  }
  if (readOnly) return <span className="text-xs text-faint">Not marked</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button disabled={busy} onClick={() => set("done")} className={`${btn} border-success text-success`}>
        ✓ Done
      </button>
      <button disabled={busy} onClick={() => set("skipped")} className={`${btn} border-warning-solid text-warning`}>
        Skip
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
