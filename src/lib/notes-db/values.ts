// What a property shows for a note, as plain data (pure; browser and server): the value (stored or
// computed), its text, and a key to sort by. Used by the views, filters, sorts, cards and exports.
import { resolvePropRef } from "@/lib/notes-db/builtins";
import { optionById, type DateValue, type DbNote, type NoteKind, type NoteProperty, type RelatedItem } from "@/lib/notes-db/types";

export const KIND_LABEL: Record<NoteKind, string> = { page: "Page", subpage: "Sub-page", block: "Block note" };

/** The value of a property for a note: stored, or computed (tags, relations, rollups, ID, times, counts). */
export function rawValue(note: DbNote, prop: NoteProperty, properties: NoteProperty[]): unknown {
  switch (prop.type) {
    case "tags":
      return note.tags.map((t) => t.name);
    case "relation":
      return note.relations[prop.id] ?? [];
    case "rollup":
      return rollupValue(note, prop, properties);
    case "unique_id":
      return note.seq;
    case "created_time":
      return note.createdAt;
    case "last_edited_time":
      return note.updatedAt;
    case "kind":
      return note.kind;
    case "word_count":
      return note.wordCount;
    case "open_todos":
      return note.openTodos;
    case "backlinks":
      return note.backlinks;
    case "ai_summary": {
      const v = note.values[prop.id] as { text?: string } | null | undefined;
      return v?.text ?? null;
    }
    default:
      return note.values[prop.id] ?? null;
  }
}

/** Rollup: reads a relation of the note (count, pending / done tasks, % done, next date, titles). */
export function rollupValue(note: DbNote, prop: NoteProperty, properties: NoteProperty[]): number | string | string[] | null {
  const rel = resolvePropRef(prop.config.relationPropId, properties);
  const items: RelatedItem[] = rel ? note.relations[rel.id] ?? [] : [];
  switch (prop.config.calc ?? "count") {
    case "count":
      return items.length;
    case "count_pending":
      return items.filter((i) => i.type === "task" && !i.done).length;
    case "count_done":
      return items.filter((i) => i.done).length;
    case "percent_done": {
      const tasks = items.filter((i) => i.type === "task");
      return tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : null;
    }
    case "next_date": {
      const dates = items.map((i) => i.date).filter((d): d is string => !!d).sort();
      return dates[0] ?? null;
    }
    case "show_titles":
      return items.map((i) => i.title);
  }
  return null;
}

export const uniqueIdText = (prop: NoteProperty, seq: number | null) => (seq === null ? "" : prop.config.prefix ? `${prop.config.prefix}-${seq}` : String(seq));

export function formatNumber(n: number, prop: NoteProperty) {
  switch (prop.config.numberFormat) {
    case "dollar":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    case "percent":
      return `${n}%`;
    default:
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
  }
}

const day = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, dd || 1, 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

export function formatDate(v: DateValue | null | undefined, includeTime = false) {
  if (!v?.start) return "";
  const a = `${day(v.start)}${includeTime && v.time ? ` ${v.time}` : ""}`;
  return v.end ? `${a} → ${day(v.end)}` : a;
}

/** ISO timestamp → "Oct 29, 2026 9:30 PM" in the user's timezone. */
export function formatTimestamp(iso: string, tz: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
}

/** The value as one line of text (cards, search, copy). */
export function displayText(note: DbNote, prop: NoteProperty, properties: NoteProperty[], tz = "UTC"): string {
  const v = rawValue(note, prop, properties);
  if (v === null || v === undefined) return "";
  switch (prop.type) {
    case "select":
    case "status":
      return optionById(prop, v)?.name ?? "";
    case "multi_select":
      return (v as string[]).map((id) => optionById(prop, id)?.name).filter(Boolean).join(", ");
    case "tags":
      return (v as string[]).map((t) => `#${t}`).join(" ");
    case "checkbox":
      return v ? "✓" : "";
    case "number":
      return typeof v === "number" ? formatNumber(v, prop) : "";
    case "date":
      return formatDate(v as DateValue, prop.config.includeTime);
    case "files":
      return (v as { name: string }[]).map((f) => f.name).join(", ");
    case "relation":
      return (v as RelatedItem[]).map((i) => i.title).join(", ");
    case "rollup":
      return Array.isArray(v) ? v.join(", ") : prop.config.calc === "percent_done" && typeof v === "number" ? `${v}%` : prop.config.calc === "next_date" && typeof v === "string" ? day(v) : String(v);
    case "unique_id":
      return uniqueIdText(prop, v as number);
    case "created_time":
    case "last_edited_time":
      return formatTimestamp(v as string, tz);
    case "kind":
      return KIND_LABEL[v as NoteKind] ?? "";
    default:
      return String(v);
  }
}

/** A key to sort by: numbers for numbers / dates / counts, lowercase text otherwise, null = empty (always last). */
export function sortKey(note: DbNote, prop: NoteProperty | "title", properties: NoteProperty[]): string | number | null {
  if (prop === "title") return (note.title || "").toLowerCase() || null;
  const v = rawValue(note, prop, properties);
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
  switch (prop.type) {
    case "number":
    case "word_count":
    case "open_todos":
    case "backlinks":
    case "unique_id":
      return Number(v);
    case "checkbox":
      return v ? 1 : 0;
    case "date":
      return (v as DateValue).start;
    case "created_time":
    case "last_edited_time":
      return Date.parse(v as string);
    case "select":
    case "status": {
      // Option order (like Notion), not alphabetical
      const i = (prop.config.options ?? []).findIndex((o) => o.id === v);
      return i < 0 ? null : i;
    }
    case "rollup":
      return typeof v === "number" ? v : Array.isArray(v) ? v.join(",").toLowerCase() : String(v).toLowerCase();
    default:
      return displayText(note, prop, properties).toLowerCase() || null;
  }
}
