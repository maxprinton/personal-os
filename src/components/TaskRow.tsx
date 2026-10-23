import { updateTask } from "@/app/task-actions";
import TagChips from "@/components/TagChips";
import type { Tag } from "@/lib/tags";
import { formatDateLong } from "@/lib/time";

export type TaskRowData = {
  id: string;
  title: string;
  status: string;
  rollover_policy: string;
  scheduled_for: string | null;
  rolled_over_count: number;
  is_habit: boolean;
};

const POLICY_LABEL: Record<string, string> = {
  migrate: "moves to tomorrow",
  backlog: "goes to backlog",
  graveyard: "fails at midnight",
};

function OpButton({ id, op, label }: { id: string; op: string; label: string }) {
  return (
    <form action={updateTask}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button className="text-xs text-neutral-500 hover:text-neutral-900">{label}</button>
    </form>
  );
}

export default function TaskRow({ task, tags = [], today }: { task: TaskRowData; tags?: Tag[]; today: string }) {
  const done = task.status === "completed";
  const failed = task.status === "failed";
  const overdue = task.status === "pending" && task.scheduled_for !== null && task.scheduled_for < today;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
      <form action={updateTask} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="op" value={done ? "reopen" : "complete"} />
        <button
          aria-label={done ? "Mark as not done" : "Mark as done"}
          className={`h-5 w-5 rounded border ${done ? "border-neutral-900 bg-neutral-900" : "border-neutral-400"}`}
        />
      </form>
      <div className="flex-1 space-y-1">
        <p className={`font-medium ${done ? "text-neutral-400 line-through" : ""} ${failed ? "text-red-600" : ""}`}>
          {task.title}
        </p>
        <p className="text-xs text-neutral-500">
          {task.scheduled_for ? formatDateLong(task.scheduled_for) : "No date"}
          {overdue ? " · overdue" : ""}
          {task.status === "pending" ? ` · ${POLICY_LABEL[task.rollover_policy] ?? ""}` : ""}
          {task.rolled_over_count > 0 ? ` · postponed ${task.rolled_over_count}×` : ""}
          {task.is_habit ? " · Habit" : ""}
        </p>
        <TagChips tags={tags} base="/tasks" />
      </div>
      <div className="flex flex-col items-end gap-1">
        {task.status !== "pending" || task.scheduled_for !== today ? (
          <OpButton id={task.id} op="today" label="Do today" />
        ) : null}
        {task.status === "pending" && <OpButton id={task.id} op="backlog" label="To backlog" />}
        <OpButton id={task.id} op="delete" label="Delete" />
      </div>
    </li>
  );
}
