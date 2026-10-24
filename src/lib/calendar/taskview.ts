// Where tasks show on the calendar (pure; server and browser).
import type { CalTask, Occurrence, TaskLog } from "@/lib/calendar/types";

/** Ids of every appearance of the same block on the same day (a task placed in one shows in all). */
export function sameBlockSameDay(occ: Pick<Occurrence, "id" | "date" | "block_type_id">, occurrences: Occurrence[]) {
  return new Set(
    occurrences
      .filter((o) => o.date === occ.date && o.block_type_id === occ.block_type_id && o.status !== "cancelled")
      .map((o) => o.id)
      .concat(occ.id)
  );
}

export function tasksForOccurrence(
  occ: Pick<Occurrence, "id" | "date" | "block_type_id">,
  occurrences: Occurrence[],
  tasks: CalTask[]
) {
  const ids = sameBlockSameDay(occ, occurrences);
  return tasks.filter(
    (t) => t.occurrence_id && ids.has(t.occurrence_id) && t.scheduled_for === occ.date && t.status !== "backlog"
  );
}

/** Tasks that were left undone in this block on this (past) day. */
export function logsForOccurrence(
  occ: Pick<Occurrence, "id" | "date" | "block_type_id">,
  occurrences: Occurrence[],
  logs: TaskLog[]
) {
  const ids = sameBlockSameDay(occ, occurrences);
  return logs.filter((l) => l.date === occ.date && l.occurrence_id && ids.has(l.occurrence_id));
}

export function tasksForEvent(eventId: string, date: string, tasks: CalTask[]) {
  return tasks.filter((t) => t.event_id === eventId && t.scheduled_for === date);
}

/** Pending tasks of a day that are in no block and no event. Today also collects older ones. */
export function unassignedOn(date: string, today: string, tasks: CalTask[]) {
  return tasks.filter(
    (t) =>
      t.status === "pending" &&
      !t.occurrence_id &&
      !t.event_id &&
      t.scheduled_for !== null &&
      (date === today ? t.scheduled_for <= today : t.scheduled_for === date)
  );
}
