"use client";
// Shared pieces of the database views: the environment (properties, templates, callbacks), the note's
// icon and title, the compact property pills of cards, popover anchors, and "render more while scrolling".
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageIcon } from "@/components/editor/PagePicker";
import PropertyValue from "@/components/notes-db/PropertyValue";
import type { ExportNote } from "@/lib/note-export/model";
import { cardHasValue, noteTitle } from "@/lib/notes-db/query";
import type { DbNote, NoteProperty, RelatedItem, TemplateInfo } from "@/lib/notes-db/types";
import "./database.css";

export type Rect = { left: number; top: number; bottom: number; right?: number };

export function rectOf(el: Element | null | undefined): Rect {
  if (!el) return { left: 16, top: 80, bottom: 80, right: 16 };
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
}

/** A popover width that fits phones. */
export function fit(w: number) {
  if (typeof window === "undefined") return w;
  return Math.max(220, Math.min(w, window.innerWidth - 16));
}

export type DbEnv = {
  properties: NoteProperty[];
  templates: TemplateInfo[];
  today: string;
  timezone: string;
  /** Values a note created from the toolbar / table gets (from the filters that are on). */
  newValues: Record<string, unknown>;
  /** A note changed (optimistic). */
  onNote: (note: DbNote) => void;
  /** The properties changed (created, renamed, deleted, options…). */
  onProps: (properties: NoteProperty[]) => void;
  /** Every tag name used by the notes (filter pickers). */
  tagNames: string[];
  /** Items used in a relation property by the notes (filter pickers). */
  relationItems: (propId: string) => RelatedItem[];
  /** Loads the whole database again (no page reload). */
  refresh: () => void;
};

/** Anything that created or changed notes elsewhere on the page can call this; the database reloads. */
export const NOTES_DB_CHANGED = "notes-db-changed";
export function notifyNotesDbChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTES_DB_CHANGED));
}

/** A click on a row / card opens the note, unless it was on a link, button, checkbox, field or menu. */
export function useOpenNote() {
  const router = useRouter();
  return useCallback(
    (e: React.MouseEvent, id: string) => {
      const t = e.target as HTMLElement | null;
      if (!t || e.defaultPrevented || t.closest("a, button, input, label, select, textarea, [data-popover], [data-no-open]")) return;
      if (!(e.currentTarget as HTMLElement).contains(t)) return; // clicks inside portals (menus)
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.toString().trim()) return; // selecting text
      const href = `/notes/${id}`;
      if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
      else router.push(href);
    },
    [router],
  );
}

export const DbEnvContext = createContext<DbEnv | null>(null);
export function useDb(): DbEnv {
  const v = useContext(DbEnvContext);
  if (!v) throw new Error("Database pieces must be inside <Database>.");
  return v;
}

export const displayTitle = (n: Pick<DbNote, "title" | "blockName">) => noteTitle(n) || "Untitled";

/** Title of the parent page for the "↳" hint ("Sub-page" if that page isn't loaded). */
export function parentTitle(note: Pick<DbNote, "parentId">, titles: Map<string, string>): string | null {
  if (!note.parentId) return null;
  return titles.get(note.parentId) ?? "Sub-page";
}

export function NoteIcon({ note }: { note: Pick<DbNote, "icon" | "kind"> }) {
  if (note.kind === "block" && !note.icon) return <span aria-hidden>✏️</span>;
  return <PageIcon icon={note.icon} />;
}

export function exportOf(n: DbNote): ExportNote {
  return { id: n.id, title: displayTitle(n), content: n.content ?? "", updatedAt: n.updatedAt, tags: n.tags.map((t) => t.name), kind: n.kind === "block" ? "block" : "note" };
}

/** The visible properties of a card, as compact pills (empty ones are left out). */
export function CardProps({ note, cols, properties, className = "" }: { note: DbNote; cols: NoteProperty[]; properties: NoteProperty[]; className?: string }) {
  const shown = cols.filter((p) => cardHasValue(note, p, properties));
  if (!shown.length) return null;
  return (
    <div className={`db-card-props ${className}`}>
      {shown.map((p) => (
        <span key={p.id} className="db-card-prop" title={p.name}>
          <PropertyValue note={note} prop={p} properties={properties} variant="card" readOnly />
        </span>
      ))}
    </div>
  );
}

/** Shows `step` items first and more as the end comes into view (fast with ~1000 notes). */
export function useChunk(total: number, step = 120) {
  const [limit, setLimit] = useState(step);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || limit >= total || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + step);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, total, step]);
  const sentinel = limit < total ? <div ref={ref} className="db-sentinel" aria-hidden /> : null;
  return { limit, sentinel };
}

/** A small toolbar button. */
export function ToolButton({ children, on, onClick, title, className = "", btnRef }: { children: ReactNode; on?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; title?: string; className?: string; btnRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button ref={btnRef} type="button" title={title} onClick={onClick} className={`db-tool ${on ? "is-on" : ""} ${className}`}>
      {children}
    </button>
  );
}

/** The CSS variable that holds a column's width. */
export const widthVar = (id: string) => `--dbw-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
