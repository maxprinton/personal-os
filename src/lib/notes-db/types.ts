// The notes database (like a Notion database): property types, stored values, the shape the screens get,
// views (filters / sorts) and templates. Pure types + tiny helpers: safe in the browser and the server.
// Migration 0021. Values live in notes.props by property id; some properties are computed, not stored.
import type { ColorName } from "@/lib/editor/colors";

/** Types you can create (Notion's), plus the automatic ones. */
export type PropType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "checkbox"
  | "files"
  | "url"
  | "email"
  | "phone"
  | "relation"
  | "rollup"
  | "unique_id"
  // automatic (read only, computed)
  | "created_time"
  | "last_edited_time"
  | "kind"
  | "block" // the block this note belongs to (block notes); changed from its menu, not typed
  | "word_count"
  | "open_todos"
  | "backlinks"
  // built-in specials
  | "tags" // multi-select backed by the shared #tags (entity_tags)
  | "ai_summary"; // one line written by the AI when you press ✨ (stored in props)

/** Types offered in "+ Add a property" (the rest are built-in only). */
export const CREATABLE_TYPES: PropType[] = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "files", "url", "email", "phone", "relation", "rollup", "unique_id"];
/** Types whose value can't be edited by hand. */
export const READONLY_TYPES: PropType[] = ["rollup", "unique_id", "created_time", "last_edited_time", "kind", "block", "word_count", "open_todos", "backlinks"];

export const TYPE_LABEL: Record<PropType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  checkbox: "Checkbox",
  files: "Files & media",
  url: "URL",
  email: "Email",
  phone: "Phone",
  relation: "Relation",
  rollup: "Rollup",
  unique_id: "ID",
  created_time: "Created time",
  last_edited_time: "Last edited time",
  kind: "Kind",
  block: "Block",
  word_count: "Word count",
  open_todos: "Open to-dos",
  backlinks: "Backlinks",
  tags: "Tags",
  ai_summary: "AI summary",
};

export const TYPE_ICON: Record<PropType, string> = {
  text: "≡",
  number: "#",
  select: "◉",
  multi_select: "☰",
  status: "◐",
  date: "📅",
  checkbox: "☑",
  files: "📎",
  url: "🔗",
  email: "@",
  phone: "☎",
  relation: "↗",
  rollup: "🔍",
  unique_id: "№",
  created_time: "🕒",
  last_edited_time: "🕒",
  kind: "📄",
  block: "🧱",
  word_count: "#",
  open_todos: "☐",
  backlinks: "↙",
  tags: "#",
  ai_summary: "✨",
};

export type StatusGroup = "todo" | "in_progress" | "done";
export type SelectOption = { id: string; name: string; color: ColorName; group?: StatusGroup };

/** What a relation points to. Notes, tasks, events and blocks of Personal OS. */
export type RelationTarget = "notes" | "tasks" | "events";
export type RefType = "note" | "task" | "event" | "block_type";
export type RelationRef = { type: RefType; id: string };
/** A related item as the screens show it. */
export type RelatedItem = RelationRef & { title: string; done?: boolean; date?: string | null; icon?: string | null };

export type RollupCalc = "count" | "count_pending" | "count_done" | "percent_done" | "next_date" | "show_titles";

export type PropConfig = {
  options?: SelectOption[]; // select, multi_select, status (status: each option has a group)
  numberFormat?: "number" | "dollar" | "percent" | "bar";
  barMax?: number; // "bar": the value that fills the bar (default 100)
  includeTime?: boolean; // date
  target?: RelationTarget; // relation: what it points to ("events" also takes blocks)
  twoWay?: boolean; // relation to notes: also shows on the other note
  relationPropId?: string; // rollup: which relation it reads
  calc?: RollupCalc; // rollup: what it shows
  prefix?: string; // unique_id, e.g. "NOTE"
  defaultOptionId?: string; // status / select: value of a new note
};

export type NoteProperty = {
  id: string;
  key: string; // built-in key ("type", "status"…) or "p_xxxxxx" for your own
  name: string;
  type: PropType;
  config: PropConfig;
  position: number;
  hidden: boolean; // "Hide in page" (still in the table)
  builtin: boolean;
};

export type DateValue = { start: string; end?: string | null; time?: string | null };
export type FileValue = { url: string; name: string; size?: number };

/**
 * Stored values (notes.props[propertyId]):
 * text / url / email / phone → string · number → number · select / status → option id ·
 * multi_select → option id[] · date → DateValue · checkbox → boolean · files → FileValue[] ·
 * relation (your own) → RelationRef[] · ai_summary → { text, at }.
 * Computed (never stored): tags, built-in relations, rollup, unique_id, times, kind, counts.
 */
export type PropValue = string | number | boolean | string[] | DateValue | FileValue[] | RelationRef[] | { text: string; at: string } | null;

export type NoteKind = "page" | "subpage" | "block";

/** One note as the database screens get it. */
export type DbNote = {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  parentId: string | null;
  blockName: string | null;
  kind: NoteKind;
  seq: number | null;
  createdAt: string;
  updatedAt: string;
  templateId: string | null;
  /** Stored values by property id. */
  values: Record<string, PropValue>;
  /** Tags (the built-in "Tags" property). */
  tags: { name: string; color: string | null }[];
  /** Relation values by property id (built-in and your own), with titles. */
  relations: Record<string, RelatedItem[]>;
  wordCount: number;
  openTodos: number;
  backlinks: number;
  /** Plain text for search and previews (cut). */
  text: string;
  /** The note's Markdown (for copy / export of selected rows). */
  content: string;
};

export type DbData = {
  properties: NoteProperty[];
  notes: DbNote[];
  templates: TemplateInfo[];
  /** The templates as rows (their page edits the values a new note gets). */
  templateNotes?: DbNote[];
  today: string; // YYYY-MM-DD in the user's timezone
  timezone: string;
};

// ---- Views (only "the filter of the moment": remembered per browser, not saved views) -------------

export type FilterOp =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "within" // value: "today" | "tomorrow" | "yesterday" | "this_week" | "past_week" | "next_week" | "this_month" | "past_month" | "next_month"
  | "any_of"
  | "none_of"
  | "all_of"
  | "checked"
  | "unchecked";

/** prop = a property id, or "title". */
export type FilterRule = { kind: "rule"; id: string; prop: string; op: FilterOp; value?: unknown };
export type FilterGroup = { kind: "group"; id: string; join: "and" | "or"; items: (FilterRule | FilterGroup)[] };
export type SortRule = { prop: string; dir: "asc" | "desc" };
export type Layout = "table" | "list" | "gallery" | "board";

export type ViewState = {
  layout: Layout;
  search: string;
  /** Quick chips (always AND). */
  quick: FilterRule[];
  /** "Advanced filter" (AND / OR groups). */
  advanced: FilterGroup | null;
  sorts: SortRule[];
  /** Board: the select / status property of the columns. */
  groupBy: string | null;
  /** Property ids shown (table columns, list/gallery/board lines), in order. */
  visible: string[];
  widths: Record<string, number>;
  showTemplates?: false;
};

// ---- Templates --------------------------------------------------------------------------------

export type Schedule = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  /** weekly: ISO weekdays 1 (Mon) … 7 (Sun). */
  days?: number[];
  /** monthly / yearly: day of the month (1–31; bigger than the month = its last day). */
  monthDay?: number;
  /** yearly: month 1–12. */
  month?: number;
  /** Local time "HH:MM" of the day it belongs to. */
  time: string;
  /** Create it this many hours before (e.g. 3 = the night before at 21:00 for a 00:00 note). */
  advanceHours?: number;
  /** Last date (YYYY-MM-DD) it is created for; null = forever. */
  until?: string | null;
  paused?: boolean;
  /** The previous note of the series is deleted if it was left as the template made it. */
  skipUnused?: boolean;
  /** Telegram: "📝 <title> is ready" + button; a reply is added to the note. */
  notify?: boolean;
  /** Starts on this date (YYYY-MM-DD). */
  start?: string;
};

export type TemplateConfig = {
  /** A sub-page inside a template (created along with it); not a template of its own. */
  child?: boolean;
  /** One of the starter templates (Diario, Revisión semanal, Reunión, Aprendizaje). */
  starter?: string;
  isDefault?: boolean;
  /** Select option id of the built-in Type: choosing that Type on an empty note fills it with this template. */
  forType?: string | null;
  schedule?: Schedule | null;
  /** Last date (series_key) created by the schedule. */
  lastKey?: string | null;
};

export type TemplateInfo = {
  id: string;
  title: string;
  icon: string | null;
  config: TemplateConfig;
  /** When the schedule creates the next one (ISO), if it is on. */
  nextRun?: string | null;
};

// ---- Small helpers -------------------------------------------------------------------------------

export const isEmptyValue = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && v !== null && "start" in (v as object) && !(v as DateValue).start);

export function newId(prefix = "") {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}${r.slice(0, 10)}`;
}

/** Status options grouped (To do / In progress / Done) in Notion's order. */
export function statusGroups(prop: NoteProperty) {
  const opts = prop.config.options ?? [];
  return (["todo", "in_progress", "done"] as StatusGroup[]).map((g) => ({ group: g, options: opts.filter((o) => (o.group ?? "todo") === g) }));
}

export const optionById = (prop: NoteProperty, id: unknown) => (prop.config.options ?? []).find((o) => o.id === id) ?? null;
