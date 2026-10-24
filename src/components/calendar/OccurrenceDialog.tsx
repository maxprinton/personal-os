"use client";

import { useState } from "react";
import Link from "next/link";
import {
  createHabit,
  editOccurrence,
  removeOccurrence,
  renameBlockType,
  setBlockTypeColor,
  toggleOccurrenceDone,
  updateHabit,
} from "@/app/calendar-actions";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { logsForOccurrence, tasksForOccurrence, unassignedOn } from "@/lib/calendar/taskview";
import HabitControls from "@/components/HabitControls";
import TaskList from "@/components/calendar/TaskList";
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
  const [newHabit, setNewHabit] = useState("");
  const habits = habitsForOccurrence(occ, data.habits, data.checks, data.today);
  const unscheduled = data.habits.filter((h) => !h.removed && !h.block_type_id);
  const canMark = !readOnly && occ.date <= data.today && occ.status !== "free_day";
  const editableHabits = !readOnly && occ.date >= data.today && type && !type.removed;

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

      <section className="space-y-2 rounded-lg border border-neutral-200 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Habits</h3>
          {canMark && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => toggleOccurrenceDone({ occurrenceId: occ.id }))}
              className="rounded-md border border-green-600 px-2 py-0.5 text-xs text-green-700"
            >
              {occ.status === "done" ? "Undo ✓" : "✓ Mark block done"}
            </button>
          )}
        </div>
        {habits.length === 0 && <p className="text-xs text-neutral-500">No habits in this block.</p>}
        <ul className="space-y-1">
          {habits.map(({ habit, state }) => (
            <li key={habit.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{habit.name}</span>
              <span className="flex items-center gap-2">
                <HabitControls habitId={habit.id} occurrenceId={occ.id} state={state} readOnly={!canMark} compact />
                {editableHabits && habit.block_type_id === occ.block_type_id && (
                  <button
                    type="button"
                    title="Take this habit out of the block from today on (past marks stay)"
                    onClick={() => run(() => updateHabit({ id: habit.id, blockTypeId: null }))}
                    className="text-xs text-neutral-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {occ.date > data.today && habits.length > 0 && (
          <p className="text-xs text-neutral-500">You can mark these when the day comes.</p>
        )}
        {editableHabits && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newHabit.trim() || !type) return;
              if (await run(() => createHabit({ name: newHabit, blockTypeId: type.id }))) setNewHabit("");
            }}
            className="flex gap-2"
          >
            <input
              value={newHabit}
              onChange={(e) => setNewHabit(e.target.value)}
              placeholder={`New habit in ${type?.name ?? "this block"} (from today on)`}
              className={inputCls}
            />
            <button className={btnSecondary}>Add</button>
          </form>
        )}
        {editableHabits && unscheduled.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => e.target.value && type && run(() => updateHabit({ id: e.target.value, blockTypeId: type.id }))}
            className={inputCls}
          >
            <option value="">Place an unscheduled habit here…</option>
            {unscheduled.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-neutral-200 p-3">
        <h3 className="text-sm font-medium">Tasks</h3>
        <TaskList
          tasks={tasksForOccurrence(occ, data.occurrences, data.tasks)}
          logs={logsForOccurrence(occ, data.occurrences, data.taskLogs)}
          unassigned={occ.date >= data.today ? unassignedOn(data.today, data.today, data.tasks) : []}
          target={{ occurrenceId: occ.id, date: occ.date }}
          canEdit={!readOnly && occ.date >= data.today && occ.status !== "free_day"}
          canTick={!readOnly}
          run={run}
        />
      </section>

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
