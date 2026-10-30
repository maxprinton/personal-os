// The notes database's view engine (pure: browser, server and tests): search, quick filter chips,
// advanced filters (AND / OR groups), sorts, board groups, the default view and cleaning a view that
// was saved in the browser (properties deleted since, bad values…). Run the tests: scripts/test-notes-db.ts
import { rawValue, sortKey } from "@/lib/notes-db/values";
import { isEmptyValue, newId, statusGroups, type DateValue, type DbNote, type FilterGroup, type FilterOp, type FilterRule, type Layout, type NoteKind, type NoteProperty, type PropType, type RelatedItem, type SelectOption, type SortRule, type StatusGroup, type ViewState } from "@/lib/notes-db/types";
import type { ColorName } from "@/lib/editor/colors";

// ---- Kinds of values and their operators ------------------------------------------------------------

/** How a property is filtered. */
export type ValueKind = "text" | "number" | "select" | "status" | "multi" | "date" | "checkbox" | "kind" | "files";

export function kindOfType(type: PropType | "title"): ValueKind {
  switch (type) {
    case "number":
    case "word_count":
    case "open_todos":
    case "backlinks":
    case "unique_id":
    case "rollup":
      return "number";
    case "select":
      return "select";
    case "status":
      return "status";
    case "multi_select":
    case "tags":
    case "relation":
      return "multi";
    case "date":
    case "created_time":
    case "last_edited_time":
      return "date";
    case "checkbox":
      return "checkbox";
    case "kind":
      return "kind";
    case "files":
      return "files";
    default:
      return "text"; // title, text, url, email, phone, ai_summary
  }
}

/** Like kindOfType, but a rollup depends on what it shows (number, next date or titles). */
export function valueKind(prop: NoteProperty | "title"): ValueKind {
  if (prop === "title") return "text";
  if (prop.type === "rollup") {
    const calc = prop.config.calc ?? "count";
    return calc === "next_date" ? "date" : calc === "show_titles" ? "text" : "number";
  }
  return kindOfType(prop.type);
}

export const OPERATORS: Record<ValueKind, FilterOp[]> = {
  text: ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "any_of", "none_of", "is_empty", "is_not_empty"],
  status: ["is", "is_not", "any_of", "none_of", "is_empty", "is_not_empty"],
  multi: ["contains", "not_contains", "all_of", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "on_or_before", "on_or_after", "within", "is_empty", "is_not_empty"],
  checkbox: ["checked", "unchecked"],
  kind: ["is", "is_not"],
  files: ["contains", "not_contains", "is_empty", "is_not_empty"],
};

/** Operators that also work when stored in a view (aliases, e.g. any_of on a multi-select = contains). */
const ACCEPTED: Record<ValueKind, FilterOp[]> = {
  ...OPERATORS,
  multi: [...OPERATORS.multi, "any_of", "none_of"],
  kind: [...OPERATORS.kind, "any_of", "none_of"],
};

/** The operators offered for a property type ("title" = the note's name). */
export function operatorsFor(type: PropType | "title"): FilterOp[] {
  return OPERATORS[kindOfType(type)];
}
export const operatorsForProp = (prop: NoteProperty | "title") => OPERATORS[valueKind(prop)];

const NO_VALUE: FilterOp[] = ["is_empty", "is_not_empty", "checked", "unchecked"];
export const needsValue = (op: FilterOp) => !NO_VALUE.includes(op);

export function opLabel(kind: ValueKind, op: FilterOp): string {
  if (kind === "multi") return op === "contains" || op === "any_of" ? "has any of" : op === "not_contains" || op === "none_of" ? "has none of" : op === "all_of" ? "has all of" : op === "is_empty" ? "is empty" : "is not empty";
  if (kind === "select" || kind === "status") return op === "any_of" ? "is any of" : op === "none_of" ? "is none of" : OP_LABEL[op];
  if (kind === "date") return op === "before" ? "is before" : op === "after" ? "is after" : op === "on_or_before" ? "is on or before" : op === "on_or_after" ? "is on or after" : op === "within" ? "is within" : OP_LABEL[op];
  return OP_LABEL[op];
}

export const OP_LABEL: Record<FilterOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  before: "before",
  after: "after",
  on_or_before: "on or before",
  on_or_after: "on or after",
  within: "within",
  any_of: "any of",
  none_of: "none of",
  all_of: "all of",
  checked: "is checked",
  unchecked: "is unchecked",
};

/** The operator a new chip / rule starts with. */
export function defaultOp(kind: ValueKind): FilterOp {
  switch (kind) {
    case "text":
    case "files":
      return "contains";
    case "number":
      return "eq";
    case "select":
    case "status":
      return "any_of";
    case "multi":
      return "contains";
    case "date":
      return "within";
    case "checkbox":
      return "checked";
    case "kind":
      return "is";
  }
}

export const WITHIN_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week", label: "This week" },
  { id: "past_week", label: "Past week" },
  { id: "next_week", label: "Next week" },
  { id: "this_month", label: "This month" },
  { id: "past_month", label: "Past month" },
  { id: "next_month", label: "Next month" },
] as const;
export type WithinRange = (typeof WITHIN_OPTIONS)[number]["id"];

/** Relative days a date rule can use instead of a fixed date. */
export const RELATIVE_DAYS = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "yesterday", label: "Yesterday" },
] as const;

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = { todo: "To-do", in_progress: "In progress", done: "Done" };

// ---- Text and days -------------------------------------------------------------------------------

/** Lowercase without accents ("Reunión" → "reunion"). */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The name a note shows (block notes show the block's name). */
export const noteTitle = (n: Pick<DbNote, "title" | "blockName">) => n.blockName || n.title || "";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number) {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function addMonths(day: string, n: number) {
  const [y, m, dd] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dd, last));
  return iso(first);
}

/** [first, last] day of a relative range, from today (weeks start on Monday). */
export function withinRange(range: string, today: string): [string, string] | null {
  if (!DAY_RE.test(today)) return null;
  switch (range) {
    case "today":
      return [today, today];
    case "tomorrow":
      return [addDays(today, 1), addDays(today, 1)];
    case "yesterday":
      return [addDays(today, -1), addDays(today, -1)];
    case "this_week": {
      const sinceMonday = (toUtc(today).getUTCDay() + 6) % 7;
      const mon = addDays(today, -sinceMonday);
      return [mon, addDays(mon, 6)];
    }
    case "past_week":
      return [addDays(today, -7), today];
    case "next_week":
      return [today, addDays(today, 7)];
    case "this_month": {
      const first = `${today.slice(0, 7)}-01`;
      return [first, addDays(addMonths(first, 1), -1)];
    }
    case "past_month":
      return [addMonths(today, -1), today];
    case "next_month":
      return [today, addMonths(today, 1)];
  }
  return null;
}

/** "YYYY-MM-DD", or "today" / "tomorrow" / "yesterday" → a day. */
export function resolveDay(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  if (DAY_RE.test(v)) return v;
  if (v === "today" || v === "tomorrow" || v === "yesterday") return withinRange(v, today)?.[0] ?? null;
  return null;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** An ISO timestamp → its day (YYYY-MM-DD) in a timezone. */
export function localDay(isoTime: string, tz: string): string | null {
  const t = Date.parse(isoTime);
  if (!Number.isFinite(t)) return null;
  let f = dayFormats.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    }
    dayFormats.set(tz, f);
  }
  const parts = f.formatToParts(new Date(t));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ---- Reading a note's value the way a filter needs it ---------------------------------------------

type Ctx = { properties: NoteProperty[]; byId: Map<string, NoteProperty>; today: string; tz: string };

function textOf(note: DbNote, prop: NoteProperty | "title", properties: NoteProperty[]): string {
  if (prop === "title") return noteTitle(note);
  const v = rawValue(note, prop, properties);
  if (v === null || v === undefined) return "";
  if (prop.type === "files") return Array.isArray(v) ? (v as { name?: string }[]).map((f) => f?.name ?? "").join(" ") : "";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : "")).join(", ");
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

function numberOf(note: DbNote, prop: NoteProperty, properties: NoteProperty[]): number | null {
  const v = rawValue(note, prop, properties);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A select / status value only counts if the option still exists. */
function optionOf(note: DbNote, prop: NoteProperty): SelectOption | null {
  const v = note.values[prop.id];
  return (prop.config.options ?? []).find((o) => o.id === v) ?? null;
}

/** multi-select → option ids (known ones) · tags → folded names · relation → item ids. */
function listOf(note: DbNote, prop: NoteProperty, properties: NoteProperty[]): string[] {
  if (prop.type === "tags") return note.tags.map((t) => fold(t.name));
  if (prop.type === "relation") return (note.relations[prop.id] ?? []).map((i: RelatedItem) => i.id);
  const v = rawValue(note, prop, properties);
  if (!Array.isArray(v)) return [];
  const known = new Set((prop.config.options ?? []).map((o) => o.id));
  return (v as unknown[]).filter((x): x is string => typeof x === "string" && known.has(x));
}

/** [start, end] days of a date value (a single day: start = end). */
function dateOf(note: DbNote, prop: NoteProperty, ctx: Ctx): [string, string] | null {
  if (prop.type === "created_time") {
    const d = localDay(note.createdAt, ctx.tz);
    return d ? [d, d] : null;
  }
  if (prop.type === "last_edited_time") {
    const d = localDay(note.updatedAt, ctx.tz);
    return d ? [d, d] : null;
  }
  const v = rawValue(note, prop, ctx.properties);
  if (typeof v === "string") return DAY_RE.test(v.slice(0, 10)) ? [v.slice(0, 10), v.slice(0, 10)] : null;
  const d = v as DateValue | null;
  if (!d || typeof d !== "object" || typeof d.start !== "string" || !DAY_RE.test(d.start)) return null;
  const end = typeof d.end === "string" && DAY_RE.test(d.end) && d.end >= d.start ? d.end : d.start;
  return [d.start, end];
}

const toList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : typeof v === "string" && v !== "" ? [v] : []);
const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// ---- Rules and groups ----------------------------------------------------------------------------

const propOf = (rule: FilterRule, ctx: Pick<Ctx, "byId">): NoteProperty | "title" | null => (rule.prop === "title" ? "title" : ctx.byId.get(rule.prop) ?? null);

/** A rule still being filled in (no value yet) or for a deleted property doesn't filter anything. */
export function ruleIsActive(rule: FilterRule, properties: NoteProperty[]): boolean {
  const prop = rule.prop === "title" ? "title" : properties.find((p) => p.id === rule.prop);
  if (!prop) return false;
  return isActive(rule, prop);
}

function isActive(rule: FilterRule, prop: NoteProperty | "title") {
  const kind = valueKind(prop);
  if (!ACCEPTED[kind].includes(rule.op)) return false;
  if (!needsValue(rule.op)) return true;
  const v = rule.value;
  switch (kind) {
    case "number":
      return toNumber(v) !== null;
    case "date":
      return rule.op === "within" ? typeof v === "string" && WITHIN_OPTIONS.some((o) => o.id === v) : typeof v === "string" && (DAY_RE.test(v) || RELATIVE_DAYS.some((o) => o.id === v));
    case "select":
    case "status":
    case "multi":
    case "kind":
      return toList(v).length > 0;
    default:
      return typeof v === "string" && v.trim() !== "";
  }
}

function matchRule(note: DbNote, rule: FilterRule, prop: NoteProperty | "title", ctx: Ctx): boolean {
  const op = rule.op;
  const kind = valueKind(prop);
  switch (kind) {
    case "text":
    case "files": {
      const v = fold(textOf(note, prop, ctx.properties)).trim();
      const q = fold(String(rule.value ?? "")).trim();
      switch (op) {
        case "is":
          return v === q;
        case "is_not":
          return v !== q;
        case "contains":
          return v.includes(q);
        case "not_contains":
          return !v.includes(q);
        case "starts_with":
          return v.startsWith(q);
        case "ends_with":
          return v.endsWith(q);
        case "is_empty":
          return !v;
        case "is_not_empty":
          return !!v;
      }
      return true;
    }
    case "number": {
      const n = numberOf(note, prop as NoteProperty, ctx.properties);
      if (op === "is_empty") return n === null;
      if (op === "is_not_empty") return n !== null;
      const t = toNumber(rule.value) as number;
      if (op === "neq") return n === null || n !== t;
      if (n === null) return false;
      return op === "eq" ? n === t : op === "gt" ? n > t : op === "gte" ? n >= t : op === "lt" ? n < t : op === "lte" ? n <= t : true;
    }
    case "select":
    case "status": {
      const opt = optionOf(note, prop as NoteProperty);
      if (op === "is_empty") return !opt;
      if (op === "is_not_empty") return !!opt;
      const wanted = toList(rule.value);
      const hit = !!opt && wanted.some((w) => (w.startsWith("group:") ? (opt.group ?? "todo") === w.slice(6) : opt.id === w));
      return op === "is" || op === "any_of" ? hit : !hit; // is_not / none_of (empty counts as "not")
    }
    case "multi": {
      const items = listOf(note, prop as NoteProperty, ctx.properties);
      if (op === "is_empty") return items.length === 0;
      if (op === "is_not_empty") return items.length > 0;
      const isTags = (prop as NoteProperty).type === "tags";
      const wanted = toList(rule.value).map((w) => (isTags ? fold(w.replace(/^#/, "")) : w));
      const set = new Set(items);
      if (op === "all_of") return wanted.every((w) => set.has(w));
      const any = wanted.some((w) => set.has(w));
      return op === "contains" || op === "any_of" ? any : !any;
    }
    case "date": {
      const r = dateOf(note, prop as NoteProperty, ctx);
      if (op === "is_empty") return !r;
      if (op === "is_not_empty") return !!r;
      if (!r) return false;
      if (op === "within") {
        const w = withinRange(String(rule.value), ctx.today);
        return !!w && r[0] <= w[1] && r[1] >= w[0];
      }
      const d = resolveDay(rule.value, ctx.today);
      if (!d) return true;
      switch (op) {
        case "is":
          return r[0] <= d && r[1] >= d;
        case "before":
          return r[0] < d;
        case "after":
          return r[1] > d;
        case "on_or_before":
          return r[0] <= d;
        case "on_or_after":
          return r[1] >= d;
      }
      return true;
    }
    case "checkbox": {
      const v = rawValue(note, prop as NoteProperty, ctx.properties) === true;
      return op === "checked" ? v : !v;
    }
    case "kind": {
      const hit = toList(rule.value).includes(note.kind);
      return op === "is" || op === "any_of" ? hit : !hit;
    }
  }
  return true;
}

/** Does a group have at least one rule that filters? */
export function groupIsActive(group: FilterGroup | null | undefined, properties: NoteProperty[]): boolean {
  if (!group) return false;
  return group.items.some((it) => (it.kind === "group" ? groupIsActive(it, properties) : ruleIsActive(it, properties)));
}

/** How many rules of a group filter something (for the "Advanced · 3" badge). */
export function countActiveRules(group: FilterGroup | null | undefined, properties: NoteProperty[]): number {
  if (!group) return 0;
  return group.items.reduce((n, it) => n + (it.kind === "group" ? countActiveRules(it, properties) : ruleIsActive(it, properties) ? 1 : 0), 0);
}

function matchGroup(note: DbNote, group: FilterGroup, ctx: Ctx): boolean | null {
  let any = false;
  let all = true;
  let counted = 0;
  for (const it of group.items) {
    let r: boolean | null;
    if (it.kind === "group") r = matchGroup(note, it, ctx);
    else {
      const prop = propOf(it, ctx);
      r = prop && isActive(it, prop) ? matchRule(note, it, prop, ctx) : null;
    }
    if (r === null) continue; // inactive: ignored
    counted++;
    if (r) any = true;
    else all = false;
    if (group.join === "and" && !all) return false;
    if (group.join === "or" && any) return true;
  }
  if (!counted) return null;
  return group.join === "and" ? all : any;
}

/** Filters only (no search, no sort). Exposed for tests and the board. */
export function matchesFilters(note: DbNote, view: Pick<ViewState, "quick" | "advanced">, ctx: Ctx): boolean {
  for (const rule of view.quick) {
    const prop = propOf(rule, ctx);
    if (prop && isActive(rule, prop) && !matchRule(note, rule, prop, ctx)) return false;
  }
  if (view.advanced && matchGroup(note, view.advanced, ctx) === false) return false;
  return true;
}

// ---- Search --------------------------------------------------------------------------------------

const haystacks = new WeakMap<DbNote, string>();
function haystack(n: DbNote) {
  let h = haystacks.get(n);
  if (h === undefined) {
    h = fold(`${n.title ?? ""} ${n.blockName ?? ""} ${n.tags.map((t) => `#${t.name}`).join(" ")} ${n.text ?? ""}`);
    haystacks.set(n, h);
  }
  return h;
}

/** Every word of the search must be in the title, block name, tags or text (accents and case ignored). */
export function matchesSearch(note: DbNote, search: string) {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(note);
  return words.every((w) => h.includes(w));
}

// ---- Sorting -------------------------------------------------------------------------------------

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function compareKeys(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorts by several properties; empty values always go last; ties (and no sorts) → last edited first. */
export function sortNotes(notes: DbNote[], sorts: SortRule[], properties: NoteProperty[]): DbNote[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const valid = sorts.filter((s) => s.prop === "title" || byId.has(s.prop));
  const rows = notes.map((n) => ({
    n,
    keys: valid.map((s) => (s.prop === "title" ? fold(noteTitle(n)).trim() || null : sortKey(n, byId.get(s.prop) as NoteProperty, properties))),
    edited: Date.parse(n.updatedAt) || 0,
  }));
  rows.sort((a, b) => {
    for (let i = 0; i < valid.length; i++) {
      const ka = a.keys[i];
      const kb = b.keys[i];
      if (ka === null || kb === null) {
        const c = compareKeys(ka, kb); // empties last, whatever the direction
        if (c) return c;
        continue;
      }
      const c = compareKeys(ka, kb);
      if (c) return valid[i].dir === "desc" ? -c : c;
    }
    return b.edited - a.edited || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0);
  });
  return rows.map((r) => r.n);
}

// ---- The whole view ------------------------------------------------------------------------------

/** Search + quick chips + advanced filter + sorts (default: last edited first). */
export function applyView(notes: DbNote[], properties: NoteProperty[], view: ViewState, today: string, timezone: string): DbNote[] {
  const ctx: Ctx = { properties, byId: new Map(properties.map((p) => [p.id, p])), today, tz: timezone };
  const search = view.search ?? "";
  const out = notes.filter((n) => matchesSearch(n, search) && matchesFilters(n, view, ctx));
  return sortNotes(out, view.sorts ?? [], properties);
}

/** Is anything narrowing the list? (search or a rule with a value) */
export function isFiltering(view: ViewState, properties: NoteProperty[]) {
  return !!view.search.trim() || view.quick.some((r) => ruleIsActive(r, properties)) || groupIsActive(view.advanced, properties);
}

// ---- Board groups --------------------------------------------------------------------------------

export type BoardGroup = { id: string | null; name: string; color: ColorName; group?: StatusGroup; notes: DbNote[] };

/** Board columns of a select / status property: "No <prop>" first, then every option in order. */
export function groupNotes(notes: DbNote[], prop: NoteProperty, _properties?: NoteProperty[]): BoardGroup[] {
  const options = prop.type === "status" ? statusGroups(prop).flatMap((g) => g.options) : prop.config.options ?? [];
  const groups: BoardGroup[] = [{ id: null, name: `No ${prop.name}`, color: "default", notes: [] }, ...options.map((o) => ({ id: o.id, name: o.name, color: o.color, group: o.group, notes: [] as DbNote[] }))];
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const n of notes) {
    const v = n.values[prop.id];
    (byId.get(typeof v === "string" ? v : null) ?? groups[0]).notes.push(n);
  }
  return groups;
}

export const canGroupBy = (p: NoteProperty) => p.type === "select" || p.type === "status";

// ---- Default view and cleaning a saved one ------------------------------------------------------

const LAYOUTS: Layout[] = ["table", "list", "gallery", "board"];
const byPosition = (properties: NoteProperty[]) => [...properties].sort((a, b) => a.position - b.position);

export function defaultGroupBy(properties: NoteProperty[]): string | null {
  const list = byPosition(properties);
  return (list.find((p) => p.builtin && p.key === "status" && p.type === "status") ?? list.find((p) => p.type === "status") ?? list.find((p) => p.type === "select"))?.id ?? null;
}

/** Every property is a column at first (hide them from "Properties"; the choice is remembered). */
export function defaultVisible(properties: NoteProperty[]): string[] {
  return byPosition(properties).map((p) => p.id);
}

export function defaultView(properties: NoteProperty[]): ViewState {
  return { layout: "table", search: "", quick: [], advanced: null, sorts: [], groupBy: defaultGroupBy(properties), visible: defaultVisible(properties), widths: {}, seen: properties.map((p) => p.id) };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function cleanValue(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.slice(0, 500);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").slice(0, 100);
  return undefined;
}

function cleanRule(r: unknown, byId: Map<string, NoteProperty>): FilterRule | null {
  if (!isObj(r) || typeof r.prop !== "string" || typeof r.op !== "string") return null;
  const prop = r.prop === "title" ? "title" : byId.get(r.prop);
  if (!prop) return null;
  const op = r.op as FilterOp;
  if (!ACCEPTED[valueKind(prop)].includes(op)) return null;
  const rule: FilterRule = { kind: "rule", id: typeof r.id === "string" && r.id ? r.id : newId("f"), prop: r.prop, op };
  const value = cleanValue(r.value);
  if (value !== undefined) rule.value = value;
  return rule;
}

function cleanGroup(g: unknown, byId: Map<string, NoteProperty>, depth: number): FilterGroup | null {
  if (!isObj(g) || !Array.isArray(g.items)) return null;
  const items: (FilterRule | FilterGroup)[] = [];
  for (const it of g.items.slice(0, 50)) {
    if (isObj(it) && it.kind === "group") {
      if (depth < 3) {
        const sub = cleanGroup(it, byId, depth + 1);
        if (sub) items.push(sub);
      }
    } else {
      const r = cleanRule(it, byId);
      if (r) items.push(r);
    }
  }
  return { kind: "group", id: typeof g.id === "string" && g.id ? g.id : newId("g"), join: g.join === "or" ? "or" : "and", items };
}

/** Makes any saved value a valid view for these properties (unknown ids, deleted properties, bad data → dropped). */
export function sanitizeView(raw: unknown, properties: NoteProperty[]): ViewState {
  const base = defaultView(properties);
  if (!isObj(raw)) return base;
  const byId = new Map(properties.map((p) => [p.id, p]));
  const layout = LAYOUTS.includes(raw.layout as Layout) ? (raw.layout as Layout) : base.layout;
  const search = typeof raw.search === "string" ? raw.search.slice(0, 200) : "";
  const quick = Array.isArray(raw.quick) ? raw.quick.map((r) => cleanRule(r, byId)).filter((r): r is FilterRule => !!r) : [];
  const advanced = raw.advanced ? cleanGroup(raw.advanced, byId, 1) : null;
  const seenSort = new Set<string>();
  const sorts: SortRule[] = Array.isArray(raw.sorts)
    ? raw.sorts
        .filter((s): s is SortRule => isObj(s) && typeof s.prop === "string" && (s.prop === "title" || byId.has(s.prop)))
        .filter((s) => (seenSort.has(s.prop) ? false : (seenSort.add(s.prop), true)))
        .map((s) => ({ prop: s.prop, dir: s.dir === "desc" ? ("desc" as const) : ("asc" as const) }))
    : [];
  const gb = typeof raw.groupBy === "string" ? byId.get(raw.groupBy) : undefined;
  const groupBy = gb && canGroupBy(gb) ? gb.id : base.groupBy;
  const visible = Array.isArray(raw.visible) ? [...new Set(raw.visible.filter((id): id is string => typeof id === "string" && byId.has(id)))] : base.visible;
  // Properties this view hasn't seen yet (new ones, or all of them in a view saved before "seen") become columns once;
  // after that, hiding one from "Properties" sticks.
  if (Array.isArray(raw.visible)) {
    const seen = new Set(Array.isArray(raw.seen) ? raw.seen.filter((id): id is string => typeof id === "string") : []);
    for (const p of byPosition(properties)) if (!seen.has(p.id) && !visible.includes(p.id)) visible.push(p.id);
  }
  const widths: Record<string, number> = {};
  if (isObj(raw.widths))
    for (const [k, w] of Object.entries(raw.widths)) if ((k === "title" || byId.has(k)) && typeof w === "number" && Number.isFinite(w)) widths[k] = Math.round(Math.min(1000, Math.max(60, w)));
  return { layout, search, quick, advanced, sorts, groupBy, visible, widths, seen: properties.map((p) => p.id) };
}

// ---- Small helpers for the screens ----------------------------------------------------------------

/** A new rule for a property with its default operator. */
export function newRule(prop: NoteProperty | "title"): FilterRule {
  return { kind: "rule", id: newId("f"), prop: prop === "title" ? "title" : prop.id, op: defaultOp(valueKind(prop)) };
}

/** Values a new note gets from the filters that are on (Status is Inbox → the new note is Inbox). */
export function valuesFromView(view: ViewState, properties: NoteProperty[], today: string): Record<string, unknown> {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const out: Record<string, unknown> = {};
  const rules = [...view.quick, ...(view.advanced && view.advanced.join === "and" ? view.advanced.items.filter((i): i is FilterRule => i.kind === "rule") : [])];
  for (const r of rules) {
    const p = byId.get(r.prop);
    if (!p || !isActive(r, p)) continue;
    const list = toList(r.value);
    switch (p.type) {
      case "select":
      case "status":
        if ((r.op === "is" || r.op === "any_of") && list.length === 1 && !list[0].startsWith("group:") && (p.config.options ?? []).some((o) => o.id === list[0])) out[p.id] = list[0];
        break;
      case "multi_select":
        if (r.op === "contains" || r.op === "any_of" || r.op === "all_of") out[p.id] = [...new Set([...((out[p.id] as string[]) ?? []), ...(r.op === "all_of" ? list : list.slice(0, 1))])];
        break;
      case "tags":
        if (r.op === "contains" || r.op === "any_of" || r.op === "all_of") out[p.id] = [...new Set([...((out[p.id] as string[]) ?? []), ...(r.op === "all_of" ? list : list.slice(0, 1))])];
        break;
      case "checkbox":
        if (r.op === "checked") out[p.id] = true;
        break;
      case "text":
      case "url":
      case "email":
      case "phone":
        if (r.op === "is" && typeof r.value === "string") out[p.id] = r.value;
        break;
      case "number":
        if (r.op === "eq") out[p.id] = toNumber(r.value);
        break;
      case "date": {
        const d = r.op === "is" ? resolveDay(r.value, today) : null;
        if (d) out[p.id] = { start: d };
        break;
      }
    }
  }
  return out;
}

/** Should a card (list / gallery / board) show this value? (empty, unchecked, 0 counts → no) */
export function cardHasValue(note: DbNote, prop: NoteProperty, properties: NoteProperty[]): boolean {
  const v = rawValue(note, prop, properties);
  if (isEmptyValue(v)) return false;
  switch (prop.type) {
    case "checkbox":
      return v === true;
    case "select":
    case "status":
      return (prop.config.options ?? []).some((o) => o.id === v);
    case "word_count":
    case "open_todos":
    case "backlinks":
      return v !== 0;
    case "rollup":
      return !(v === 0 && (prop.config.calc ?? "count") !== "percent_done");
    case "kind":
      return true;
  }
  return true;
}

export const KIND_OPTIONS: { id: NoteKind; label: string }[] = [
  { id: "page", label: "Page" },
  { id: "subpage", label: "Sub-page" },
  { id: "block", label: "Block note" },
];
