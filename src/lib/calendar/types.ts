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
  /** Payment events: pre-filled from a template; paid / skipped once handled. */
  is_payment?: boolean;
  payment_template_id?: string | null;
  payment_status?: "paid" | "skipped" | null;
};

export type PaymentTemplate = {
  id: string;
  name: string;
  type: "income" | "expense";
  expected_amount: number | null;
  account_id: string | null;
  category_id: string | null;
  repeat_unit: "none" | "days" | "weeks" | "months" | "years";
  repeat_every: number;
  start_date: string;
  end_date: string | null;
};

/** What the payment draft needs to offer: templates and the finance lists. */
export type FinanceOptions = {
  templates: PaymentTemplate[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; kind: "income" | "expense" }[];
};

/** A habit lives inside a block type. block_type_id null = "unscheduled" until placed. */
export type Habit = { id: string; name: string; block_type_id: string | null; active_from: string; removed?: boolean };

export type HabitState = "done" | "skipped" | "missed";

/** One mark of a habit in one block occurrence. */
export type HabitCheck = { habit_id: string; occurrence_id: string; date: string; state: HabitState };

/**
 * A task. It has a home block (e.g. "Work") and, on its day, is placed in one appearance of a
 * block (occurrence_id) or in an event (event_id). It shows in every appearance of that block
 * on that day: it is one linked task, done in one = done in all.
 */
export type CalTask = {
  id: string;
  title: string;
  status: "pending" | "completed" | "backlog" | "failed";
  scheduled_for: string | null;
  occurrence_id: string | null;
  event_id: string | null;
  home_block_type_id: string | null;
  moved: number;
};

/** A day a task reached undone: it keeps showing there as skipped / moved. */
export type TaskLog = {
  task_id: string;
  title: string;
  date: string;
  outcome: "skipped" | "moved";
  occurrence_id: string | null;
  event_id: string | null;
};

export type FreeDayPolicy = "move_next" | "unassigned" | "home_block";

/** A range of paused dates (trip, holiday): blocks dimmed, streaks paused, no nagging. */
export type FreeDayRange = { id: string; from_date: string; to_date: string; task_policy: FreeDayPolicy; note: string | null };

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
  tasks: CalTask[];
  taskLogs: TaskLog[];
  freeDays: FreeDayRange[];
  finance: FinanceOptions;
};

/** Result of every calendar server action. */
export type CalResult = { ok?: boolean; error?: string; code?: "PAST_LOCKED" | "READ_ONLY" | "NEEDS_CHOICE" };
