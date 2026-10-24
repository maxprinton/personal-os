"use client";

import { useState } from "react";
import Link from "next/link";
import { editOccurrence, removeOccurrence, renameBlockType, setBlockTypeColor } from "@/app/calendar-actions";
import { timeToMinutes } from "@/lib/time";
import type { CalendarData, CalResult, EditScope, Occurrence } from "@/lib/calendar/types";
import Modal, { btnSecondary, inputCls } from "@/components/calendar/Modal";
import { ScopeButtons } from "@/components/calendar/ScopeDialog";
import { dayLabel, timeRange } from "@/components/calendar/util";

/** Details of one block on one day: change its time, remove it, rename the block or change its color. */
export default function OccurrenceDialog({
  occ,
  data,
  readOnly,
  run,
  onClose,
}: {
  occ: Occurrence;
  data: CalendarData;
  readOnly: boolean;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onClose: () => void;
}) {
  const type = data.blockTypes.find((t) => t.id === occ.block_type_id);
  const [date, setDate] = useState(occ.date);
  const [start, setStart] = useState(occ.start_time.slice(0, 5));
  const [end, setEnd] = useState(occ.end_time.slice(0, 5));
  const [name, setName] = useState(type?.name ?? "");
  const [color, setColor] = useState(type?.color ?? "#6366f1");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = date !== occ.date || start !== occ.start_time.slice(0, 5) || end !== occ.end_time.slice(0, 5);

  async function apply(scope: EditScope) {
    setBusy(true);
    const ok =
      pending === "remove"
        ? await run(() => removeOccurrence({ id: occ.id, scope }))
        : await run(() => editOccurrence({ id: occ.id, date, start, end, scope }));
    setBusy(false);
    if (ok) onClose();
  }

  async function saveType() {
    if (!type) return;
    setBusy(true);
    if (name.trim() && name.trim() !== type.name) await run(() => renameBlockType({ id: type.id, name }));
    if (color !== type.color) await run(() => setBlockTypeColor({ id: type.id, color }));
    setBusy(false);
  }

  return (
    <Modal title={type?.name ?? "Block"} onClose={onClose} wide>
      <div className="flex items-center gap-2 text-sm text-neutral-600">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: type?.color ?? "#6366f1" }} />
        {dayLabel(occ.date)} · {timeRange(timeToMinutes(occ.start_time), timeToMinutes(occ.end_time))}
        {occ.status !== "scheduled" && <span className="rounded bg-neutral-100 px-1.5 text-xs">{occ.status.replace("_", " ")}</span>}
        {!occ.slot_id && <span className="rounded bg-neutral-100 px-1.5 text-xs">one day only</span>}
      </div>

      {!readOnly && (
        <section className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <h3 className="text-sm font-medium">Time</h3>
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </div>
          {pending ? (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">
                {pending === "remove" ? "Remove this block for:" : "Apply the change to:"}
              </p>
              <ScopeButtons
                occ={occ}
                today={data.today}
                verb={pending === "remove" ? "Remove" : "Change"}
                busy={busy}
                onPick={apply}
              />
              <button type="button" onClick={() => setPending(null)} className="text-xs text-neutral-500 underline">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!changed} onClick={() => setPending("save")} className={btnSecondary}>
                Save time…
              </button>
              <button
                type="button"
                onClick={() => setPending("remove")}
                className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600"
              >
                Remove…
              </button>
            </div>
          )}
        </section>
      )}

      {!readOnly && type && !type.removed && (
        <section className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <h3 className="text-sm font-medium">Block</h3>
          <p className="text-xs text-neutral-500">Renaming or recoloring changes it on every day it appears.</p>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12" />
            <button type="button" disabled={busy} onClick={saveType} className={btnSecondary}>
              Save
            </button>
          </div>
          <Link href="/blocks" className="text-xs text-neutral-500 underline">
            Manage all blocks
          </Link>
        </section>
      )}
    </Modal>
  );
}
