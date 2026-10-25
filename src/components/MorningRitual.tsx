"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dismissRitual, moveTaskToNextHome, placeTask } from "@/app/calendar-actions";
import type { CalResult } from "@/lib/calendar/types";
import type { getRitual } from "@/lib/calendar/tasks";
import { dayLabel, emitCalendarChanged } from "@/components/calendar/util";

type Ritual = Awaited<ReturnType<typeof getRitual>>;

/**
 * Morning ritual: yesterday's undone tasks (marked skipped on their day). If the home block is
 * on today, the task is already in it. If not, choose: next appearance of that block, or
 * another block today. Tasks without a home block wait in "unassigned".
 */
export default function MorningRitual({ ritual, readOnly = false }: { ritual: Ritual; readOnly?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<CalResult>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setMsg(r.error ?? null);
    emitCalendarChanged();
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-info/30 bg-info-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-info">☀️ Morning ritual</h2>
          <p className="text-xs text-info">
            {ritual.items.length
              ? `${ritual.items.length} task${ritual.items.length > 1 ? "s" : ""} not done yesterday (marked as skipped there).`
              : "Nothing left from yesterday."}
            {ritual.unassigned > 0 ? ` ${ritual.unassigned} task${ritual.unassigned > 1 ? "s" : ""} today have no block yet.` : ""}
          </p>
        </div>
        {!readOnly && (
          <button disabled={busy} onClick={() => run(() => dismissRitual())} className="shrink-0 text-xs text-info underline">
            Done for today
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {ritual.items.map((it) => (
          <li key={it.task.id} className="space-y-1 rounded-lg bg-surface p-3 text-sm">
            <p className="font-medium">
              {it.task.title}
              {it.task.moved > 0 && (
                <span className="ml-2 rounded-full bg-warning-soft px-1.5 text-xs font-normal text-warning">moved {it.task.moved}×</span>
              )}
            </p>
            {it.placedIn ? (
              <p className="text-xs text-success">
                ✓ Placed in {it.placedIn.blockName} at {it.placedIn.start} (its home block)
              </p>
            ) : readOnly ? (
              <p className="text-xs text-muted">Waiting for a block — place it on the computer.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {it.homeName && !it.homeToday && it.nextHome && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => moveTaskToNextHome({ taskId: it.task.id }))}
                    className="rounded-md border border-info px-2 py-1 text-xs text-info"
                  >
                    Move to next {it.homeName} ({dayLabel(it.nextHome.date)})
                  </button>
                )}
                {it.homeName && !it.homeToday && !it.nextHome && (
                  <span className="text-xs text-muted">{it.homeName} is not on the calendar soon.</span>
                )}
                {ritual.todayBlocks.length > 0 && (
                  <select
                    disabled={busy}
                    defaultValue=""
                    onChange={(e) => e.target.value && run(() => placeTask({ taskId: it.task.id, occurrenceId: e.target.value }))}
                    className="rounded-md border border-line-strong px-2 py-1 text-xs"
                  >
                    <option value="">{it.homeName ? "Or another block today…" : "Pick a block today…"}</option>
                    {ritual.todayBlocks.map((b) => (
                      <option key={b.occurrenceId} value={b.occurrenceId}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                )}
                {!it.homeName && <span className="text-xs text-muted">No home block · it stays in “unassigned”.</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="text-sm text-danger">{msg}</p>}
    </section>
  );
}
