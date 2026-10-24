"use client";

import { useMemo, useState } from "react";
import { createBlock } from "@/app/calendar-actions";
import { isoWeekday, minutesToTime, ISO_DAY_SHORT } from "@/lib/time";
import type { BlockType, CalResult } from "@/lib/calendar/types";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import { weekdayOfDate } from "@/components/calendar/util";

type Repeat = "weekly" | "this_day" | "days";

/** New block. Typing an existing name reuses that block (color, habits) and only adds a new time slot. */
export default function BlockDialog({
  date,
  start,
  end,
  initialName = "",
  blockTypes,
  run,
  onClose,
  onMakeEvent,
}: {
  date: string;
  start: number;
  end: number;
  initialName?: string;
  blockTypes: BlockType[];
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onClose: () => void;
  onMakeEvent?: (date: string, start: string, end: string, title: string) => void;
}) {
  const live = useMemo(() => blockTypes.filter((t) => !t.removed), [blockTypes]);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState("#6366f1");
  const [day, setDay] = useState(date);
  const [from, setFrom] = useState(minutesToTime(start));
  const [to, setTo] = useState(minutesToTime(end));
  const [repeat, setRepeat] = useState<Repeat>("weekly");
  const [weekdays, setWeekdays] = useState<number[]>([isoWeekday(date)]);
  const [busy, setBusy] = useState(false);

  const match = live.find((t) => t.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase());
  const close = live.filter(
    (t) => name.trim().length >= 2 && t !== match && t.name.toLowerCase().includes(name.trim().toLowerCase())
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() =>
      createBlock({ name, color: match ? undefined : color, date: day, start: from, end: to, repeat, weekdays })
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title={initialName ? `Duplicate "${initialName}"` : "New block"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div>
          <input
            autoFocus
            required
            list="block-type-names"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Deep work, Gym, Admin"
            className={inputCls}
          />
          <datalist id="block-type-names">
            {live.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          {match ? (
            <p className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: match.color }} />
              Existing block — keeps its color and habits, adds a new time slot.
            </p>
          ) : close.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700">
              Did you mean{" "}
              {close.slice(0, 3).map((t, i) => (
                <span key={t.id}>
                  {i > 0 ? ", " : ""}
                  <button type="button" className="underline" onClick={() => setName(t.name)}>
                    {t.name}
                  </button>
                </span>
              ))}
              ?
            </p>
          ) : name.trim() ? (
            <label className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
              New block · color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-neutral-500">
            Date
            <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-neutral-500">
            Start
            <input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-neutral-500">
            End
            <input type="time" required value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
        </div>
        {to && from && to < from && <p className="text-xs text-neutral-500">Ends the next day.</p>}

        <fieldset className="space-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" checked={repeat === "weekly"} onChange={() => setRepeat("weekly")} />
            Every week on {day ? weekdayOfDate(day) : "this day"}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={repeat === "days"} onChange={() => setRepeat("days")} />
            Several days every week
          </label>
          {repeat === "days" && (
            <div className="flex flex-wrap gap-1 pl-6">
              {ISO_DAY_SHORT.map((d, i) => {
                const w = i + 1;
                const on = weekdays.includes(w);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== w) : [...weekdays, w])}
                    className={`rounded-md border px-2 py-1 text-xs ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" checked={repeat === "this_day"} onChange={() => setRepeat("this_day")} />
            Only this day
          </label>
          {repeat === "this_day" && (
            <p className="pl-6 text-xs text-neutral-500">
              A one-day thing is usually an event.
              {onMakeEvent && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onMakeEvent(day, from, to, name)}
                  >
                    Create an event instead
                  </button>
                </>
              )}
            </p>
          )}
        </fieldset>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy} className={btnPrimary}>
            {busy ? "Saving…" : "Add block"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
