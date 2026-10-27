"use client";

import { useState } from "react";
import Link from "next/link";
import {
  createHabit,
  editOccurrence,
  removeOccurrence,
  renameOccurrence,
  setBlockTypeColor,
  type RenameScope,
  toggleOccurrenceDone,
  updateHabit,
} from "@/app/calendar-actions";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { logsForOccurrence, tasksForOccurrence, unassignedOn } from "@/lib/calendar/taskview";
import HabitControls from "@/components/HabitControls";
import TaskList from "@/components/calendar/TaskList";
import { formatMinutes, timeToMinutes } from "@/lib/time";
import BlockNoteEditor from "@/components/BlockNoteEditor";
import type { CalendarData, CalResult, EditScope, Occurrence } from "@/lib/calendar/types";
import Modal, { btnSecondary, inputCls } from "@/components/calendar/Modal";
import { forwardLabel, ScopeButtons } from "@/components/calendar/ScopeDialog";
import { blockNoteOf, dayLabel, timeRange, weekdayName } from "@/components/calendar/util";

/** Details of one block on one day: change its time, remove it, rename the block or change its color. */
export default function OccurrenceDialog({
  occ,
  data,
  readOnly,
  run,
  onClose,
  onDuplicate,
  onNoteSaved,
}: {
  occ: Occurrence;
  data: CalendarData;
  readOnly: boolean;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onClose: () => void;
  /** Opens "New block" pre-filled with this block (name, day and times). */
  onDuplicate?: () => void;
  /** Updates the calendar's copy of the note (the ✏️ marker) right after an autosave. */
  onNoteSaved?: (name: string, content: string) => void;
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
  const [renameScope, setRenameScope] = useState<RenameScope>("this_day");
  const habits = habitsForOccurrence(occ, data.habits, data.checks, data.today);
  const unscheduled = data.habits.filter((h) => !h.removed && !h.block_type_id);
  const canMark = !readOnly && occ.date <= data.today && occ.status !== "free_day";
  const editableHabits = !readOnly && occ.date >= data.today && type && !type.removed;

  // ---- Renaming, like LifeOS: only this day (default) · this weekly time from this day on · all ----
  const trimmed = name.trim().replace(/\s+/g, " ");
  const caseOnly = Boolean(type && trimmed && trimmed !== type.name && trimmed.toLowerCase() === type.name.toLowerCase());
  const renaming = Boolean(type && trimmed && trimmed.toLowerCase() !== type.name.toLowerCase());
  const existing = renaming
    ? data.blockTypes.find((t) => !t.removed && t.id !== type?.id && t.name.toLowerCase() === trimmed.toLowerCase())
    : undefined;
  const slotOk = Boolean(forwardLabel(occ, data.today));
  const slot = data.slots.find((s) => s.id === occ.slot_id);
  const slotLabel = slot ? `${weekdayName(slot.weekday)}s ${formatMinutes(timeToMinutes(slot.start_time))}` : "";
  const marked = data.checks.some((c) => c.occurrence_id === occ.id);
  const scope: RenameScope = caseOnly ? "all" : renameScope === "slot_forward" && !slotOk ? "this_day" : renameScope;
  const verdict = renameVerdict();

  function renameVerdict(): { text: string; tone: "info" | "warn" | "error" } | null {
    if (!type || !trimmed) return null;
    if (caseOnly) return { text: "Only the capital letters change: renamed everywhere.", tone: "info" };
    if (!renaming) return null;
    const day = dayLabel(occ.date);
    if (scope === "all") {
      return existing
        ? { text: `“${existing.name}” already exists. Pick “Only this day” or “This time every week” to join it, or choose another name.`, tone: "error" }
        : { text: `Every “${type.name}”, past days included, becomes “${trimmed}”. Its note, habits and tasks go with it.`, tone: "info" };
    }
    if (scope === "this_day") {
      if (marked) return { text: `This day already has habits marked, so it can't be split off. Unmark them first, or use “This time every week” to start next time.`, tone: "error" };
      return existing
        ? { text: `⚠ “${existing.name}” already exists: only ${day} joins it and takes its color, note and habits. Its tasks stay here.`, tone: "warn" }
        : { text: `Only ${day} becomes a new block “${trimmed}” with its own habits and a copy of this note. Next week it is “${type.name}” again.`, tone: "info" };
    }
    const start = marked ? "the next one" : day;
    return existing
      ? { text: `⚠ “${existing.name}” already exists: ${slotLabel} joins it from ${start} on (its color, note and habits). Other “${type.name}” times and the past stay.`, tone: "warn" }
      : { text: `${slotLabel} becomes a new block “${trimmed}” from ${start} on, with a copy of this note. Other “${type.name}” times and the past stay.`, tone: "info" };
  }

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
    const splitting = renaming && scope !== "all";
    // Splitting off: the color is the new block's color (an existing block keeps its own)
    let ok = true;
    if (color !== type.color && !splitting) ok = await run(() => setBlockTypeColor({ id: type.id, color }));
    if (ok && (renaming || caseOnly)) {
      ok = await run(() =>
        renameOccurrence({ id: occ.id, name: trimmed, scope, color: splitting && color !== type.color ? color : undefined })
      );
      setBusy(false);
      if (ok) onClose();
      return;
    }
    setBusy(false);
  }

  return (
    <Modal title={type?.name ?? "Block"} onClose={onClose} wide>
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: type?.color ?? "#6366f1" }} />
        {dayLabel(occ.date)} · {timeRange(timeToMinutes(occ.start_time), timeToMinutes(occ.end_time))}
        {occ.status !== "scheduled" && <span className="rounded bg-subtle px-1.5 text-xs">{occ.status.replace("_", " ")}</span>}
        {!occ.slot_id && <span className="rounded bg-subtle px-1.5 text-xs">one day only</span>}
        {occ.detached && <span className="rounded bg-subtle px-1.5 text-xs">renamed on its own (only this day)</span>}
      </div>

      {type && (
        <section className="space-y-1 rounded-lg border border-line p-3">
          <h3 className="flex items-baseline justify-between gap-2 text-sm font-medium">
            <span>✏️ Note</span>
            <span className="text-xs font-normal text-faint">shared by every “{type.name}”</span>
          </h3>
          <BlockNoteEditor
            name={type.name}
            content={blockNoteOf(data.blockNotes, type.name)}
            onSaved={(content) => onNoteSaved?.(type.name, content)}
          />
        </section>
      )}

      <section className="space-y-2 rounded-lg border border-line p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Habits</h3>
          {canMark && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => toggleOccurrenceDone({ occurrenceId: occ.id }))}
              className="rounded-md border border-success px-2 py-0.5 text-xs text-success"
            >
              {occ.status === "done" ? "Undo ✓" : "✓ Mark block done"}
            </button>
          )}
        </div>
        {habits.length === 0 && <p className="text-xs text-muted">No habits in this block.</p>}
        <ul className="space-y-1">
          {habits.map(({ habit, state }) => (
            <li key={habit.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{habit.name}</span>
              <span className="flex items-center gap-2">
                <HabitControls habitId={habit.id} occurrenceId={occ.id} state={state} readOnly={!canMark} compact run={run} />
                {editableHabits && habit.block_type_id === occ.block_type_id && (
                  <button
                    type="button"
                    title="Take this habit out of the block from today on (past marks stay)"
                    onClick={() => run(() => updateHabit({ id: habit.id, blockTypeId: null }))}
                    className="text-xs text-faint hover:text-danger"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {occ.date > data.today && habits.length > 0 && (
          <p className="text-xs text-muted">You can mark these when the day comes.</p>
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
              autoComplete="off"
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

      <section className="space-y-2 rounded-lg border border-line p-3">
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
        <section className="space-y-2 rounded-lg border border-line p-3">
          <h3 className="text-sm font-medium">Time</h3>
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </div>
          {pending ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                {pending === "remove" ? "Remove this block for:" : "Apply the change to:"}
              </p>
              <ScopeButtons
                occ={occ}
                today={data.today}
                verb={pending === "remove" ? "Remove" : "Change"}
                busy={busy}
                onPick={apply}
              />
              <button type="button" onClick={() => setPending(null)} className="text-xs text-muted underline">
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
                className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger"
              >
                Remove…
              </button>
              {onDuplicate && (
                <button type="button" onClick={onDuplicate} className={btnSecondary} title="Make a copy of this block">
                  Duplicate…
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {!readOnly && type && !type.removed && (
        <section className="space-y-2 rounded-lg border border-line p-3">
          <h3 className="text-sm font-medium">Block</h3>
          <p className="text-xs text-muted">The name is the key: blocks with the same name share color, note and habits.</p>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="Block name" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12" aria-label="Color" />
            <button
              type="button"
              disabled={busy || !trimmed || verdict?.tone === "error" || (!renaming && !caseOnly && color === type.color)}
              onClick={saveType}
              className={btnSecondary}
            >
              Save
            </button>
          </div>
          {renaming && (
            <fieldset className="space-y-1 text-sm">
              <legend className="sr-only">Rename</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="rename-scope" checked={scope === "this_day"} onChange={() => setRenameScope("this_day")} />
                Only this day ({dayLabel(occ.date)})
              </label>
              {slotOk && (
                <label className="flex items-center gap-2">
                  <input type="radio" name="rename-scope" checked={scope === "slot_forward"} onChange={() => setRenameScope("slot_forward")} />
                  This time every week: {slotLabel} from {dayLabel(occ.date)} on
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="radio" name="rename-scope" checked={scope === "all"} onChange={() => setRenameScope("all")} />
                Rename all “{type.name}” (every day, past included)
              </label>
            </fieldset>
          )}
          {verdict && (
            <p
              className={`rounded-md px-2 py-1.5 text-xs ${
                verdict.tone === "error" ? "bg-danger-soft text-danger" : verdict.tone === "warn" ? "bg-warning-soft text-warning" : "bg-subtle text-muted"
              }`}
            >
              {verdict.text}
            </p>
          )}
          {!renaming && color !== type.color && <p className="text-xs text-muted">The new color applies on every day “{type.name}” appears.</p>}
          {renaming && scope !== "all" && color !== type.color && (
            <p className="text-xs text-muted">The color is used only if “{trimmed}” is a new block.</p>
          )}
          <Link href="/blocks" className="text-xs text-muted underline">
            Manage all blocks
          </Link>
        </section>
      )}
    </Modal>
  );
}
