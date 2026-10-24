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
};

/** Result of every calendar server action. */
export type CalResult = { ok?: boolean; error?: string; code?: "PAST_LOCKED" | "READ_ONLY" | "NEEDS_CHOICE" };
