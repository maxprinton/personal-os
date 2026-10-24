"use client";

import { useState } from "react";
import { createFreeDays, removeFreeDays } from "@/app/calendar-actions";
import type { CalResult, FreeDayPolicy, FreeDayRange } from "@/lib/calendar/types";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import { dayLabel } from "@/components/calendar/util";

const POLICIES: { value: FreeDayPolicy; label: string; hint: string }[] = [
  { value: "move_next", label: "Move them to the day after", hint: "They go into their home block that day if it's there." },
  { value: "unassigned", label: "Leave them unassigned", hint: "They wait in the Unassigned tray the day after, for you to place." },
  { value: "home_block", label: "Take them to their home block", hint: "The next date after the break where that block exists." },
];

/** Mark a day or a range as free (blocks dimmed, streaks paused, no nagging), or remove one. */
export default function FreeDayDialog({
  existing,
  date,
  run,
  onClose,
  readOnly,
}: {
  existing?: FreeDayRange;
  date: string;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onClose: () => void;
  readOnly: boolean;
}) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [policy, setPolicy] = useState<FreeDayPolicy>("move_next");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (existing) {
    return (
      <Modal title="🌴 Free days" onClose={onClose}>
        <p className="text-sm text-neutral-600">
          {dayLabel(existing.from_date)}
          {existing.to_date !== existing.from_date ? ` → ${dayLabel(existing.to_date)}` : ""}
          {existing.note ? ` · ${existing.note}` : ""}
        </p>
        <p className="text-xs text-neutral-500">Blocks are paused: no missed habits, streaks on hold, no reminders. Events stay visible.</p>
        {!readOnly && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await run(() => removeFreeDays({ id: existing.id }));
              setBusy(false);
              if (ok) onClose();
            }}
            className={btnSecondary}
          >
            Remove (blocks from today on come back; tasks stay where they are)
          </button>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="🌴 Mark free days" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await run(() => createFreeDays({ from, to, policy, note }));
          setBusy(false);
          if (ok) onClose();
        }}
        className="space-y-3 text-sm"
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-neutral-500">
            From
            <input
              type="date"
              required
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to < e.target.value) setTo(e.target.value);
              }}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-neutral-500">
            To
            <input type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): Trip to Cuenca" className={inputCls} />
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-neutral-500">The tasks of those days:</legend>
          {POLICIES.map((p) => (
            <label key={p.value} className="flex items-start gap-2">
              <input type="radio" checked={policy === p.value} onChange={() => setPolicy(p.value)} className="mt-1" />
              <span>
                {p.label}
                <span className="block text-xs text-neutral-500">{p.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-neutral-500">Blocks show dimmed as “free day”, habits aren't marked missed (streaks pause), nothing nags. Events stay visible.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy} className={btnPrimary}>
            {busy ? "Saving…" : "Mark as free"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
