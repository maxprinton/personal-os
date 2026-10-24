"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markHabit } from "@/app/calendar-actions";
import type { HabitState } from "@/lib/calendar/types";
import { emitCalendarChanged } from "@/components/calendar/util";

const LABEL: Record<HabitState, string> = { done: "Done", skipped: "Skipped", missed: "Missed" };
const COLOR: Record<HabitState, string> = { done: "text-green-700", skipped: "text-amber-700", missed: "text-red-600" };

/** ✓ / Skip for one habit in one block occurrence (skips keep the streak, up to 3 in a row). */
export default function HabitControls({
  habitId,
  occurrenceId,
  state,
  readOnly = false,
  compact = false,
}: {
  habitId: string;
  occurrenceId: string;
  state: HabitState | null;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: HabitState | null) {
    setBusy(true);
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
          <button disabled={busy} onClick={() => set(null)} className={`${btn} border-neutral-300 text-neutral-500`}>
            Undo
          </button>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </span>
    );
  }
  if (readOnly) return <span className="text-xs text-neutral-400">Not marked</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button disabled={busy} onClick={() => set("done")} className={`${btn} border-green-600 text-green-700`}>
        ✓ Done
      </button>
      <button disabled={busy} onClick={() => set("skipped")} className={`${btn} border-amber-500 text-amber-700`}>
        Skip
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
