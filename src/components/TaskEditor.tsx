"use client";

import { useActionState, useEffect, useState } from "react";
import { editTask, updateTask } from "@/app/task-actions";
import type { ActionState } from "@/app/actions";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import { emitCalendarChanged } from "@/components/calendar/util";

type Option = { value: string; label: string };
export type TaskEditOptions = { blocks: Option[]; events: Option[] };

export type EditableTask = {
  id: string;
  title: string;
  status: string;
  scheduled_for: string | null;
  rollover_policy: string;
  home_block_type_id?: string | null;
  event_id?: string | null;
  tags: string[];
};

/** "Edit" button + window with every field of a task. */
export default function TaskEditor({ task, options }: { task: EditableTask; options: TaskEditOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="compact rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-subtle hover:text-fg"
      >
        Edit
      </button>
      {open && <EditWindow task={task} options={options} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditWindow({ task, options, onClose }: { task: EditableTask; options: TaskEditOptions; onClose: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(editTask, {});
  const [status, setStatus] = useState(task.status);
  const [eventId, setEventId] = useState(task.event_id ?? "");

  useEffect(() => {
    if (state.ok) {
      emitCalendarChanged();
      onClose();
    }
  }, [state, onClose]);

  // Keep the current event selectable even if it's no longer in the upcoming list
  const events = task.event_id && !options.events.some((e) => e.value === task.event_id)
    ? [{ value: task.event_id, label: "Current event" }, ...options.events]
    : options.events;
  const blocks = task.home_block_type_id && !options.blocks.some((b) => b.value === task.home_block_type_id)
    ? [{ value: task.home_block_type_id, label: "Current block (removed)" }, ...options.blocks]
    : options.blocks;
  const planned = status === "pending";

  return (
    <Modal title="Edit task" onClose={onClose} wide>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={task.id} />
        <label className="block text-sm">
          Title
          <input name="title" required defaultValue={task.title} autoFocus className={`mt-1 ${inputCls}`} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Status
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="pending">To do</option>
              <option value="backlog">Backlog (no day planned)</option>
              <option value="completed">Done</option>
              {task.status === "failed" && <option value="failed">Failed</option>}
              {task.status === "archived" && <option value="archived">Archived</option>}
            </select>
          </label>
          <label className="block text-sm">
            Date{!planned && <span className="text-faint"> (optional)</span>}
            <input type="date" name="scheduled_for" defaultValue={task.scheduled_for ?? ""} className={`mt-1 ${inputCls}`} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Home block
            <select name="home_block" defaultValue={task.home_block_type_id ?? ""} className={`mt-1 ${inputCls}`}>
              <option value="">— None (I'll place it) —</option>
              {blocks.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Or in an event
            <select
              name="event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              disabled={!planned}
              className={`mt-1 ${inputCls} disabled:opacity-50`}
            >
              <option value="">— No event —</option>
              {events.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          If not done by the end of the day
          <select name="rollover_policy" defaultValue={task.rollover_policy} className={`mt-1 ${inputCls}`}>
            <option value="migrate">Reschedule to the next time its block happens (else tomorrow)</option>
            <option value="backlog">Send to backlog</option>
            <option value="graveyard">Mark as failed</option>
          </select>
        </label>

        <label className="block text-sm">
          Tags (comma separated)
          <input name="tags" defaultValue={task.tags.join(", ")} placeholder="work, errands" className={`mt-1 ${inputCls}`} />
        </label>

        <p className="text-xs text-muted">
          Changing the day of a planned task counts as a move (+1). A new day, home block or event takes it out of the block it is in now; its
          home block picks it up again on that day.
        </p>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`Delete “${task.title}” for good? (Archive keeps it without showing it.)`)) return;
              const fd = new FormData();
              fd.set("id", task.id);
              fd.set("op", "delete");
              await updateTask(fd);
              emitCalendarChanged();
              onClose();
            }}
            className="mr-auto rounded-md px-2 py-2 text-sm text-faint transition-colors hover:bg-danger-soft hover:text-danger"
          >
            Delete
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={pending} className={btnPrimary}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
