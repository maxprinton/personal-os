"use client";

import { useState } from "react";
import { createFreeDays, removeFreeDay, removeFreeDays } from "@/app/calendar-actions";
import type { CalResult, FreeDayPolicy, FreeDayRange } from "@/lib/calendar/types";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import { dayLabel } from "@/components/calendar/util";
import { addDays } from "@/lib/time";

const POLICIES: { value: FreeDayPolicy; label: string; hint: string }[] = [
  { value: "move_next", label: "Move them to the day after", hint: "They go into their home block that day if it's there." },
  { value: "unassigned", label: "Leave them unassigned", hint: "They wait in the Unassigned tray the day after, for you to place." },
  { value: "home_block", label: "Take them to their home block", hint: "The next date after the break where that block exists." },
];

const RULES =
  "Your weekly blocks pause and are hidden, so you can put other blocks there (those count as normal). Habits of paused blocks aren't marked missed: streaks pause. Events and payments stay.";

/** Mark a day or a range as free, or free one day / the whole range again. */
export default function FreeDayDialog({
  existing,
  date,
  today,
  run,
  onClose,
  readOnly,
}: {
  existing?: FreeDayRange;
  /** The day that was clicked (or the day in view) */
  date: string;
  today: string;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onClose: () => void;
  readOnly: boolean;
}) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [policy, setPolicy] = useState<FreeDayPolicy>("move_next");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(fn: () => Promise<CalResult>) {
    setBusy(true);
    const ok = await run(fn);
    setBusy(false);
    if (ok) onClose();
  }

  if (existing) {
    const single = existing.from_date === existing.to_date;
    const inRange = existing.from_date <= date && date <= existing.to_date;
    const allPast = existing.to_date < today;
    return (
      <Modal title="🌴 Free days" onClose={onClose}>
        <p className="text-sm">
          {dayLabel(existing.from_date)}
          {single ? "" : ` → ${dayLabel(existing.to_date)}`}
          {existing.note ? ` · ${existing.note}` : ""}
        </p>
        <p className="text-xs text-muted">{RULES}</p>
        {!readOnly && !allPast && (
          <div className="flex flex-col gap-2">
            {!single && inRange && date >= today && (
              <button disabled={busy} onClick={() => go(() => removeFreeDay({ id: existing.id, date }))} className={btnSecondary}>
                Make only {dayLabel(date)} a normal day again
              </button>
            )}
            <button disabled={busy} onClick={() => go(() => removeFreeDays({ id: existing.id }))} className={btnSecondary}>
              {single ? "Make it a normal day again" : "Remove all these free days"}
            </button>
            <p className="text-xs text-muted">
              Paused blocks come back (days already past stay free). If you added a block in their place, yours stays and that
              paused block stays paused. Tasks stay where they are.
            </p>
          </div>
        )}
        {allPast && <p className="text-xs text-muted">These days are past, so they stay free.</p>}
      </Modal>
    );
  }

  return (
    <Modal title="🌴 Mark free days" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go(() => createFreeDays({ from, to, policy, note }));
        }}
        className="space-y-3 text-sm"
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
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
          <label className="text-xs text-muted">
            To
            <input type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTo(addDays(from, n - 1))}
              className="rounded border border-line-strong px-2 py-0.5 hover:bg-subtle"
            >
              {n} day{n > 1 ? "s" : ""}
            </button>
          ))}
          {from !== today && (
            <button type="button" onClick={() => setFrom(today)} className="rounded border border-line-strong px-2 py-0.5 hover:bg-subtle">
              Start today
            </button>
          )}
          {from === today && (
            <button
              type="button"
              onClick={() => {
                const next = addDays(today, 1);
                setFrom(next);
                if (to < next) setTo(next);
              }}
              className="rounded border border-line-strong px-2 py-0.5 hover:bg-subtle"
            >
              Start tomorrow
            </button>
          )}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): Trip to Cuenca" className={inputCls} />
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-muted">The tasks of those days (only those that move on; tasks of an event stay with it):</legend>
          {POLICIES.map((p) => (
            <label key={p.value} className="flex items-start gap-2">
              <input type="radio" checked={policy === p.value} onChange={() => setPolicy(p.value)} className="mt-1" />
              <span>
                {p.label}
                <span className="block text-xs text-muted">{p.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted">{RULES} If these days touch other free days, they are joined into one.</p>
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

