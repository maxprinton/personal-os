"use client";

import { useState } from "react";
import { addTaskHere, placeTask, setTaskDone } from "@/app/calendar-actions";
import type { CalResult, CalTask, TaskLog } from "@/lib/calendar/types";
import { btnSecondary, inputCls } from "@/components/calendar/Modal";
import TaskActions from "@/components/TaskActions";

/** Tasks inside a block appearance or an event: tick, take out, add, place an unassigned one. */
export default function TaskList({
  tasks,
  logs = [],
  unassigned = [],
  target,
  canEdit,
  canTick,
  run,
}: {
  tasks: CalTask[];
  logs?: TaskLog[];
  unassigned?: CalTask[];
  target: { occurrenceId?: string; eventId?: string; date: string };
  canEdit: boolean;
  canTick: boolean;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={t.status === "completed"}
              disabled={!canTick}
              onChange={(e) => run(() => setTaskDone({ taskId: t.id, done: e.target.checked }))}
            />
            <span className={`flex-1 ${t.status === "completed" ? "text-faint line-through" : ""}`}>{t.title}</span>
            {t.moved > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-xs text-warning">moved {t.moved}×</span>}
            {t.status === "pending" && <TaskActions task={t} small />}
            {canEdit && t.status === "pending" && (
              <button
                type="button"
                title="Take it out (it goes to unassigned)"
                onClick={() => run(() => placeTask({ taskId: t.id, occurrenceId: null, eventId: null }))}
                className="text-xs text-faint hover:text-danger"
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {logs.map((l) => (
          <li key={`log-${l.task_id}`} className="flex items-center gap-2 text-sm text-faint">
            <span className="w-4 text-center">↷</span>
            <span className="flex-1 line-through">{l.title}</span>
            <span className="text-xs">{l.outcome === "moved" ? "moved" : "not done (skipped)"}</span>
          </li>
        ))}
        {tasks.length === 0 && logs.length === 0 && <li className="text-xs text-muted">No tasks here.</li>}
      </ul>
      {canEdit && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            if (await run(() => addTaskHere({ title, ...target }))) setTitle("");
          }}
          className="flex gap-2"
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task here" autoComplete="off" className={inputCls} />
          <button className={btnSecondary}>Add</button>
        </form>
      )}
      {canEdit && unassigned.length > 0 && (
        <select
          defaultValue=""
          onChange={(e) =>
            e.target.value &&
            run(() => placeTask({ taskId: e.target.value, occurrenceId: target.occurrenceId, eventId: target.eventId, date: target.date }))
          }
          className={inputCls}
        >
          <option value="">Put an unassigned task here…</option>
          {unassigned.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
