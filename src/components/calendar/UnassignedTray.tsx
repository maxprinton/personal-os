"use client";

import type { CalTask } from "@/lib/calendar/types";
import { TASK_MIME } from "@/components/calendar/TimeGrid";

/** Today's tasks with no block: drag them onto a block (or an event's title) to place them. */
export default function UnassignedTray({ tasks, readOnly }: { tasks: CalTask[]; readOnly: boolean }) {
  if (!tasks.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-warning/30 bg-warning-soft px-3 py-1 text-xs">
      <span className="font-medium text-warning">
        Unassigned ({tasks.length}){readOnly ? "" : " · drag onto a block"}:
      </span>
      {tasks.map((t) => (
        <span
          key={t.id}
          draggable={!readOnly}
          onDragStart={(e) => {
            e.dataTransfer.setData(TASK_MIME, t.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          className={`rounded-full border border-warning/40 bg-surface px-2 py-0.5 ${readOnly ? "" : "cursor-move"}`}
          title={t.moved ? `Moved ${t.moved}×` : undefined}
        >
          {t.title}
          {t.moved > 0 ? <span className="ml-1 text-warning">{t.moved}×</span> : null}
        </span>
      ))}
    </div>
  );
}
