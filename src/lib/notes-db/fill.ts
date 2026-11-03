// Fill down + bulk edit rules for the notes database (pure: browser and server safe).
// Decided Nov 2026: drag-fill copies the value like Notion (multi-values REPLACE); bulk edit of
// multi-values (Tags, Multi-select, Relations) asks Replace / Add / Remove. No number/date series.
// A "server value" is what setNoteValue takes: text, number, option id, option ids, DateValue,
// boolean, tag names, relation refs.
import { isBuiltinRelation } from "@/lib/notes-db/builtins";
import type { DbNote, NoteProperty, PropType, PropValue, RelatedItem, RelationRef } from "@/lib/notes-db/types";

export type MultiMode = "replace" | "add" | "remove";
export type Change = { noteId: string; value: unknown };

/** Property types a cell can be filled from / bulk edited. Computed ones (rollup, ID, times…) fill themselves. */
const FILL_TYPES: PropType[] = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "files", "url", "email", "phone", "relation", "tags"];
export const canFill = (p: NoteProperty) => FILL_TYPES.includes(p.type);
/** Bulk edit has no file upload: everything else that can be filled. */
export const canBulkEdit = (p: NoteProperty) => p.type !== "files" && canFill(p);
export const isMulti = (p: NoteProperty) => p.type === "multi_select" || p.type === "tags" || p.type === "relation";

/** Above this many notes a bulk change asks "Apply to N notes?" first (relation fills always ask). */
export const CONFIRM_ABOVE = 10;
export const needsConfirm = (prop: NoteProperty, count: number) => prop.type === "relation" || count > CONFIRM_ABOVE;

const refKey = (r: RelationRef) => `${r.type}:${r.id}`;
const itemKey = (prop: NoteProperty) => (x: unknown) => (prop.type === "relation" ? refKey(x as RelationRef) : prop.type === "tags" ? String(x).toLowerCase() : String(x));

/** The note's current value for the property, in server form. */
export function currentValue(note: DbNote, prop: NoteProperty): unknown {
  switch (prop.type) {
    case "tags":
      return note.tags.map((t) => t.name);
    case "relation":
      return (note.relations[prop.id] ?? []).map(({ type, id }) => ({ type, id }));
    case "multi_select": {
      const v = note.values[prop.id];
      return Array.isArray(v) ? v : [];
    }
    default:
      return note.values[prop.id] ?? null;
  }
}

/** Empty things become null; a status is never empty (falls back to its default); lists lose duplicates. */
export function normalize(prop: NoteProperty, v: unknown): unknown {
  if (v === undefined || v === "") v = null;
  switch (prop.type) {
    case "status":
      return v ?? prop.config.defaultOptionId ?? null;
    case "checkbox":
      return v === true;
    case "multi_select":
    case "tags":
    case "relation": {
      const list = Array.isArray(v) ? v : [];
      const key = itemKey(prop);
      const seen = new Set<string>();
      return list.filter((x) => {
        const k = key(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    case "date": {
      const d = v as { start?: string; end?: string | null; time?: string | null } | null;
      return d && d.start ? { start: d.start, end: d.end ?? null, time: d.time ?? null } : null;
    }
    default:
      return v;
  }
}

/** Same value? (lists compare as sets, empty equals empty) */
export function sameValue(prop: NoteProperty, a: unknown, b: unknown): boolean {
  const x = normalize(prop, a);
  const y = normalize(prop, b);
  if (isMulti(prop)) {
    const key = itemKey(prop);
    const ka = (x as unknown[]).map(key).sort();
    const kb = (y as unknown[]).map(key).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
  }
  return JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
}

/** Replace / Add / Remove for lists. */
export function mergeMulti(prop: NoteProperty, current: unknown, incoming: unknown, mode: MultiMode): unknown[] {
  const cur = normalize(prop, current) as unknown[];
  const inc = normalize(prop, incoming) as unknown[];
  const key = itemKey(prop);
  const have = new Set(cur.map(key));
  const given = new Set(inc.map(key));
  if (mode === "add") return [...cur, ...inc.filter((x) => !have.has(key(x)))];
  if (mode === "remove") return cur.filter((x) => !given.has(key(x)));
  return inc;
}

/**
 * What to write into each note: skips notes that would not change. `before` is what undo writes back.
 * Single values ignore `mode`.
 */
export function planChanges(prop: NoteProperty, notes: DbNote[], incoming: unknown, mode: MultiMode = "replace"): { changes: Change[]; before: Change[] } {
  const changes: Change[] = [];
  const before: Change[] = [];
  for (const n of notes) {
    const cur = currentValue(n, prop);
    const next = isMulti(prop) ? mergeMulti(prop, cur, incoming, mode) : normalize(prop, incoming);
    if (sameValue(prop, cur, next)) continue;
    changes.push({ noteId: n.id, value: next });
    before.push({ noteId: n.id, value: cur });
  }
  return { changes, before };
}

/** What is already known about related items and tags, so the screen can show titles / colors at once. */
export type Known = { items: RelatedItem[]; tags: { name: string; color: string | null }[] };

/** The note as it looks after the change (optimistic; the server saves it next). */
export function withValue(note: DbNote, prop: NoteProperty, value: unknown, known: Known = { items: [], tags: [] }): DbNote {
  if (prop.type === "tags") {
    const names = (Array.isArray(value) ? value : []).filter((x): x is string => typeof x === "string");
    const colors = new Map([...known.tags, ...note.tags].map((t) => [t.name.toLowerCase(), t.color]));
    return { ...note, tags: names.map((name) => ({ name, color: colors.get(name.toLowerCase()) ?? null })) };
  }
  if (prop.type === "relation") {
    const refs = (Array.isArray(value) ? value : []) as RelationRef[];
    const byKey = new Map([...known.items, ...(note.relations[prop.id] ?? [])].map((i) => [refKey(i), i]));
    const items = refs.map((r) => byKey.get(refKey(r)) ?? { type: r.type, id: r.id, title: "" });
    const next: DbNote = { ...note, relations: { ...note.relations, [prop.id]: items } };
    if (!isBuiltinRelation(prop)) next.values = { ...note.values, [prop.id]: refs.length ? refs : null };
    return next;
  }
  const values = { ...note.values };
  if (value === null || value === undefined) {
    delete values[prop.id];
    if (prop.type === "status" && prop.config.defaultOptionId) values[prop.id] = prop.config.defaultOptionId;
  } else values[prop.id] = value as PropValue;
  return { ...note, values };
}

/** Related items we already know for a property (from the source note of a fill, or from a picker). */
export function knownItems(notes: DbNote[], prop: NoteProperty): RelatedItem[] {
  return prop.type === "relation" ? notes.flatMap((n) => n.relations[prop.id] ?? []) : [];
}
