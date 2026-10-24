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
  rolled_over_count: number; // the "moved" counter
  is_habit: boolean;
  home_block_type_id?: string | null;
  occurrence_id?: string | null;
  event_id?: string | null;
};

const POLICY_LABEL: Record<string, string> = {
  migrate: "morning ritual if not done",
  backlog: "goes to backlog",
  graveyard: "fails at midnight",
};

/** Names shown next to a task: its home block and where it is placed today. */
export type TaskPlaces = { blockName: Map<string, string>; placedIn: Map<string, string>; eventName: Map<string, string> };

function OpButton({ id, op, label }: { id: string; op: string; label: string }) {
  return (
    <form action={updateTask}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button className="text-xs text-neutral-500 hover:text-neutral-900">{label}</button>
    </form>
  );
}

export default function TaskRow({
  task,
  tags = [],
  today,
  places,
}: {
  task: TaskRowData;
  tags?: Tag[];
  today: string;
  places?: TaskPlaces;
}) {
  const home = task.home_block_type_id ? places?.blockName.get(task.home_block_type_id) : undefined;
  const placed = task.occurrence_id ? places?.placedIn.get(task.occurrence_id) : undefined;
  const inEvent = task.event_id ? places?.eventName.get(task.event_id) : undefined;
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
          {task.rolled_over_count > 0 && (
            <span
              title="Moved counter: +1 each time a day ends with it undone, +1 per manual move to another day"
              className="ml-2 rounded-full bg-amber-100 px-1.5 text-xs font-normal text-amber-800"
            >
              moved {task.rolled_over_count}×
            </span>
          )}
        </p>
        <p className="text-xs text-neutral-500">
          {task.scheduled_for ? formatDateLong(task.scheduled_for) : "No date"}
          {overdue ? " · overdue" : ""}
          {task.status === "pending" ? ` · ${POLICY_LABEL[task.rollover_policy] ?? ""}` : ""}
          {home ? ` · home: ${home}` : ""}
          {task.status === "pending" && placed ? ` · in ${placed}` : ""}
          {task.status === "pending" && inEvent ? ` · in event ${inEvent}` : ""}
          {task.status === "pending" && task.scheduled_for && task.scheduled_for <= today && !task.occurrence_id && !task.event_id
            ? " · unassigned"
            : ""}
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
