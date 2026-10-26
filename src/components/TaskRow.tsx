import { updateTask } from "@/app/task-actions";
import TagChips from "@/components/TagChips";
import type { Tag } from "@/lib/tags";
import { formatDateLong } from "@/lib/time";
import Icon from "@/components/ui/Icon";
import TaskEditor, { type TaskEditOptions } from "@/components/TaskEditor";
import TaskActions from "@/components/TaskActions";

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
  migrate: "auto-reschedules to its next block if not done",
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
      <button className={`compact rounded-md px-2 py-1 text-xs transition-colors ${op === "delete" ? "text-faint hover:bg-danger-soft hover:text-danger" : "text-muted hover:bg-subtle hover:text-fg"}`}>
        {label}
      </button>
    </form>
  );
}

export default function TaskRow({
  task,
  tags = [],
  today,
  places,
  editOptions,
}: {
  task: TaskRowData;
  tags?: Tag[];
  today: string;
  places?: TaskPlaces;
  /** Blocks and events to choose from; when given, the row shows an Edit button. */
  editOptions?: TaskEditOptions;
}) {
  const home = task.home_block_type_id ? places?.blockName.get(task.home_block_type_id) : undefined;
  const placed = task.occurrence_id ? places?.placedIn.get(task.occurrence_id) : undefined;
  const inEvent = task.event_id ? places?.eventName.get(task.event_id) : undefined;
  const done = task.status === "completed";
  const failed = task.status === "failed";
  const overdue = task.status === "pending" && task.scheduled_for !== null && task.scheduled_for < today;
  return (
    <li className="group flex flex-wrap items-start gap-x-3 gap-y-1 sm:flex-nowrap rounded-xl border border-line bg-surface p-3 shadow-card transition-colors hover:border-edge">
      <form action={updateTask} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="op" value={done ? "reopen" : "complete"} />
        <button
          disabled={task.status === "archived"}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          className={`compact grid h-5 w-5 place-items-center rounded-full border-2 transition-colors ${
            done ? "border-success-solid bg-success-solid text-white" : "border-line-strong text-transparent hover:border-success-solid hover:text-success"
          }`}
        >
          <Icon name="check" size={12} />
        </button>
      </form>
      <div className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] space-y-1 sm:basis-0">
        <p className={`font-medium ${done ? "text-faint line-through" : ""} ${failed ? "text-danger" : ""} ${task.status === "archived" ? "text-faint" : ""}`}>
          {task.title}
          {task.rolled_over_count > 0 && (
            <span
              title="Moved counter: +1 each time a day ends with it undone, +1 per manual move to another day"
              className={`ml-2 inline-block rounded-full px-2 py-px align-middle text-[11px] font-medium ${
                task.rolled_over_count >= 4 ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
              }`}
            >
              moved {task.rolled_over_count}×
            </span>
          )}
        </p>
        <p className="text-xs text-muted">
          {task.scheduled_for ? formatDateLong(task.scheduled_for) : "No date"}
          {overdue ? <span className="font-medium text-danger"> · overdue</span> : ""}
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
      <div className="-mr-1 ml-8 flex shrink-0 flex-wrap items-center gap-0.5 sm:ml-0 sm:flex-nowrap sm:justify-end">
        {editOptions && (
          <TaskEditor
            options={editOptions}
            task={{
              id: task.id,
              title: task.title,
              status: task.status,
              scheduled_for: task.scheduled_for,
              rollover_policy: task.rollover_policy,
              home_block_type_id: task.home_block_type_id,
              event_id: task.event_id,
              tags: tags.map((t) => t.name),
            }}
          />
        )}
        <TaskActions task={{ id: task.id, title: task.title, status: task.status }} />
        {(task.status === "archived" || task.status === "failed") && <OpButton id={task.id} op="delete" label="Delete" />}
      </div>
    </li>
  );
}
