// Calendar v2 types shared by the server and the browser (no imports with side effects).

/** removed = the block was deleted (kept so past days still show its name). */
export type BlockType = { id: string; name: string; color: string; removed?: boolean };

/** One weekly slot of a block type. weekday is ISO (1 = Monday). end < start = ends next day. */
export type Slot = {
  id: string;
  block_type_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_to: string | null;
};

export type OccurrenceStatus = "scheduled" | "done" | "partial" | "free_day" | "cancelled";

/** What really happens on a date. */
export type Occurrence = {
  id: string;
  block_type_id: string;
  slot_id: string | null;
  origin_date: string | null;
  date: string;
  start_time: string;
  end_time: string;
  status: OccurrenceStatus;
  is_override: boolean;
};

/** "this_day" = only this occurrence, "forward" = this day and every later week. */
export type EditScope = "this_day" | "forward";

export type EventType = { id: string; name: string; color: string };

/**
 * An event: its own layer over the blocks, always with a local date.
 * start/end are minutes since local midnight of `date` / `end_date`; null = no time (day metadata).
 */
export type CalEvent = {
  id: string;
  title: string;
  event_type_id: string | null;
  date: string;
  end_date: string;
  start: number | null;
  end: number | null;
};

/** A habit lives inside a block type. block_type_id null = "unscheduled" until placed. */
export type Habit = { id: string; name: string; block_type_id: string | null; active_from: string; removed?: boolean };

export type HabitState = "done" | "skipped" | "missed";

/** One mark of a habit in one block occurrence. */
export type HabitCheck = { habit_id: string; occurrence_id: string; date: string; state: HabitState };

/** Everything the calendar panel needs for one date range (JSON from /api/calendar). */
export type CalendarData = {
  from: string;
  to: string;
  today: string;
  nowMinutes: number;
  timezone: string;
  blockTypes: BlockType[];
  slots: Slot[];
  occurrences: Occurrence[];
  eventTypes: EventType[];
  events: CalEvent[];
  habits: Habit[];
  checks: HabitCheck[];
};

/** Result of every calendar server action. */
export type CalResult = { ok?: boolean; error?: string; code?: "PAST_LOCKED" | "READ_ONLY" | "NEEDS_CHOICE" };
