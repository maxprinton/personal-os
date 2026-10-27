"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toggleOccurrenceDone } from "@/app/calendar-actions";
import BlockNoteEditor from "@/components/BlockNoteEditor";
import HabitControls from "@/components/HabitControls";
import TaskList from "@/components/calendar/TaskList";
import { useCalendarData } from "@/components/calendar/useCalendarData";
import { alpha, blockNoteOf, browserToday, emitCalendarChanged, noteKeyOf, timeRange } from "@/components/calendar/util";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { pickFocus } from "@/lib/calendar/focus";
import { tasksForOccurrence, unassignedOn } from "@/lib/calendar/taskview";
import { formatMinutes } from "@/lib/time";
import type { CalResult } from "@/lib/calendar/types";

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/**
 * Focus panel (from LifeOS): the block you are in right now with its note (editable, autosaves),
 * its habits and its tasks. With no block right now: "Free time" and the next block of today.
 * "today" = a wide card on Today; "side" = the column beside the calendar.
 */
export default function FocusPanel({ variant }: { variant: "today" | "side" }) {
  const router = useRouter();
  const [day, setDay] = useState(() => browserToday());
  const { data, error, reload, patch, id } = useCalendarData(day, day);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The server knows the real "today" (the user's timezone)
  useEffect(() => {
    if (data && data.today !== day) setDay(data.today);
  }, [data, day]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3000 : 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const run = useCallback(
    async (fn: () => Promise<CalResult>): Promise<boolean> => {
      let res: CalResult;
      try {
        res = await fn();
      } catch {
        res = { error: "Could not reach the server. Check your connection." };
      }
      if (res.code === "PAST_LOCKED") res = { error: "That is in the past: open the calendar to edit past days." };
      if (res.error) {
        setMsg({ ok: false, text: res.error });
        return false;
      }
      if (res.notice) setMsg({ ok: true, text: res.notice });
      await reload();
      emitCalendarChanged(id);
      router.refresh();
      return true;
    },
    [reload, id, router]
  );

  const focus = useMemo(() => (data && data.today === day ? pickFocus(data.occurrences, data.today, data.nowMinutes) : null), [data, day]);

  if (!data) {
    if (variant === "today") return null;
    return <p className="p-3 text-sm text-muted">{error ?? "Loading…"}</p>;
  }

  if (!focus) {
    if (variant === "today") return null;
    return (
      <div className="space-y-1 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">🎯 Focus</p>
        <p className="text-sm font-medium">Free time</p>
        <p className="text-sm text-muted">No more blocks today.</p>
      </div>
    );
  }

  const { occ, mode } = focus;
  const type = data.blockTypes.find((t) => t.id === occ.block_type_id);
  const name = type?.name ?? "Block";
  const color = type?.color ?? "#6366f1";
  const readOnly = data.readOnly;
  const habits = habitsForOccurrence(occ, data.habits, data.checks, data.today);
  const canMark = !readOnly && occ.date <= data.today && occ.status !== "free_day";
  const tasks = tasksForOccurrence(occ, data.occurrences, data.tasks);
  const left = focus.endAbs - data.nowMinutes;
  const until = focus.startAbs - data.nowMinutes;

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          {mode === "now" ? "🎯 Focus · now" : `🎯 Free time · next in ${dur(until)}`}
        </p>
        <p className={`truncate font-semibold ${variant === "side" ? "text-lg" : "text-base"}`}>
          {occ.status === "done" ? "✓ " : ""}
          {name}
          <span className="ml-2 text-sm font-normal text-muted">
            {timeRange(((focus.startAbs % 1440) + 1440) % 1440, focus.endAbs)}
            {mode === "now" ? ` · ${dur(Math.max(0, left))} left` : ` · at ${formatMinutes(focus.startAbs)}`}
          </span>
        </p>
      </div>
      {canMark && mode === "now" && (
        <button
          type="button"
          onClick={() => run(() => toggleOccurrenceDone({ occurrenceId: occ.id }))}
          className="rounded-md border border-success px-2 py-0.5 text-xs text-success"
        >
          {occ.status === "done" ? "Undo ✓" : "✓ Mark block done"}
        </button>
      )}
    </div>
  );

  const note = type ? (
    <BlockNoteEditor
      key={type.id}
      name={type.name}
      content={blockNoteOf(data.blockNotes, type.name)}
      minRows={variant === "side" ? 8 : 5}
      onSaved={(content) =>
        patch((d) => ({
          ...d,
          blockNotes: { ...d.blockNotes, [noteKeyOf(type.name)]: { id: d.blockNotes[noteKeyOf(type.name)]?.id ?? "", content } },
        }))
      }
    />
  ) : null;

  const side = (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Habits</h3>
        {habits.length === 0 ? (
          <p className="text-xs text-faint">No habits in this block.</p>
        ) : (
          <ul className="space-y-1">
            {habits.map(({ habit, state }) => (
              <li key={habit.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{habit.name}</span>
                <HabitControls habitId={habit.id} occurrenceId={occ.id} state={state} readOnly={!canMark} compact run={run} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Tasks</h3>
        <TaskList
          tasks={tasks}
          unassigned={!readOnly ? unassignedOn(data.today, data.today, data.tasks) : []}
          target={{ occurrenceId: occ.id, date: occ.date }}
          canEdit={!readOnly && occ.date >= data.today}
          canTick={!readOnly}
          run={run}
        />
      </div>
    </div>
  );

  const toast = msg && (
    <p className={`rounded-md px-2 py-1 text-xs ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.text}</p>
  );

  if (variant === "side") {
    return (
      <div className="space-y-3 p-3" style={{ background: `linear-gradient(180deg, ${alpha(color, 0.1)}, transparent 40%)` }}>
        {header}
        {toast}
        {note}
        {side}
      </div>
    );
  }

  return (
    <section
      aria-label="Focus"
      className="card space-y-3 p-4"
      style={{ borderTop: `3px solid ${color}` }}
    >
      {header}
      {toast}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-faint">✏️ Note · shared by every “{name}”</p>
          {note}
        </div>
        <div className="min-w-0">{side}</div>
      </div>
    </section>
  );
}
