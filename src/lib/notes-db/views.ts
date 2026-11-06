// Saved views of the notes database (the tabs above the table). Pure helpers, no React, no server.
import type { Layout, ViewState } from "@/lib/notes-db/types";

export type ViewExtras = { cardSize: "small" | "medium" | "large"; hideEmpty: boolean };
export const DEFAULT_VIEW_EXTRAS: ViewExtras = { cardSize: "medium", hideEmpty: false };

export type SavedView = { id: string; name: string; position: number; state: ViewState; extras: ViewExtras };

export const MAX_VIEWS = 20;
export const MAX_VIEW_NAME = 60;

export const LAYOUT_NAME: Record<Layout, string> = { table: "Table", list: "List", gallery: "Gallery", board: "Board" };
export const LAYOUT_ICON: Record<Layout, string> = { table: "▦", list: "☰", gallery: "▣", board: "▥" };

export function cleanExtras(raw: unknown): ViewExtras {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const cardSize = o.cardSize === "small" || o.cardSize === "large" || o.cardSize === "medium" ? o.cardSize : DEFAULT_VIEW_EXTRAS.cardSize;
  return { cardSize, hideEmpty: o.hideEmpty === true };
}

export function cleanViewName(name: unknown, fallback = "View"): string {
  const t = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_VIEW_NAME) : "";
  return t || fallback;
}

/**
 * The part of a view that is a DRAFT until "Save": filters, sorts and the board grouping (like Notion).
 * Everything else (layout, columns, widths, wrapping) is saved by itself.
 */
export type DraftPart = Pick<ViewState, "quick" | "advanced" | "sorts" | "groupBy">;
export const draftPart = (v: ViewState): DraftPart => ({ quick: v.quick, advanced: v.advanced, sorts: v.sorts, groupBy: v.groupBy });
const draftKey = (v: ViewState) => JSON.stringify(draftPart(v));

/** The filters / sorts on screen differ from the saved ones. */
export const isDirty = (working: ViewState, saved: ViewState) => draftKey(working) !== draftKey(saved);

/** Back to the saved filters, sorts and grouping (the search box is cleared too). */
export const resetDraft = (working: ViewState, saved: ViewState): ViewState => ({ ...working, ...draftPart(saved), search: "" });

/** The saved state with the filters / sorts / grouping of the screen (what "Save" stores). */
export const withDraft = (saved: ViewState, working: ViewState): ViewState => ({ ...saved, ...draftPart(working), search: "" });

/** What saves by itself: the working state with the saved filters / sorts / grouping. */
export const autoSavedState = (working: ViewState, saved: ViewState): ViewState => ({ ...working, ...draftPart(saved), search: "" });
export const autoPartChanged = (working: ViewState, saved: ViewState) => JSON.stringify(autoSavedState(working, saved)) !== JSON.stringify({ ...saved, search: "" });

/** "Table", then "Table 2", "Table 3"… (never the same name twice). */
export function nextViewName(names: string[], base: string): string {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return base;
}

/** "Name copy", "Name copy 2"… */
export function copyName(names: string[], name: string): string {
  return nextViewName(names, cleanViewName(`${name} copy`.slice(-MAX_VIEW_NAME)));
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Positions 0..n-1 in the order of `ids`; ids not in the list keep their relative order at the end. */
export function reorderedViews(views: SavedView[], ids: string[]): SavedView[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  const ordered = ids.map((id) => byId.get(id)).filter((v): v is SavedView => !!v);
  const rest = views.filter((v) => !ids.includes(v.id)).sort((a, b) => a.position - b.position);
  return [...ordered, ...rest].map((v, i) => ({ ...v, position: i }));
}

/** The view to show after another one is deleted: the one to its left, else the first. */
export function afterDelete(views: SavedView[], deletedId: string): string | null {
  const sorted = [...views].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((v) => v.id === deletedId);
  const left = i > 0 ? sorted[i - 1] : sorted.find((v) => v.id !== deletedId);
  return left?.id ?? null;
}
