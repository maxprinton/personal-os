"use client";
// Table view of the notes database: sticky header (icon + name → property menu with Sort / Filter /
// Hide), resizable columns, title column with the row checkbox, editable cells, "+" to add a property
// and "+ New" at the bottom. Scrolls sideways on small screens.
import { memo, useMemo, useRef, useState } from "react";
import { MenuItem, Popover } from "@/components/editor/ui";
import { NoteCheckbox } from "@/components/NotesExport";
import NewNoteButton from "@/components/notes-db/NewNoteButton";
import PropertyValue from "@/components/notes-db/PropertyValue";
import { AddPropertyMenu, PropertyMenu } from "@/components/notes-db/PropertyMenu";
import { NoteTitle } from "@/components/notes-db/db-title";
import { displayTitle, parentTitle, rectOf, useChunk, useDb, widthVar, type Rect } from "@/components/notes-db/db-shared";
import { TYPE_ICON, type DbNote, type NoteProperty, type PropType, type SortRule } from "@/lib/notes-db/types";

const DEFAULT_W: Partial<Record<PropType, number>> = {
  text: 220,
  ai_summary: 260,
  number: 120,
  word_count: 100,
  open_todos: 110,
  backlinks: 110,
  unique_id: 110,
  select: 150,
  status: 150,
  multi_select: 200,
  tags: 200,
  relation: 220,
  rollup: 130,
  date: 160,
  created_time: 190,
  last_edited_time: 190,
  checkbox: 100,
  files: 180,
  url: 200,
  email: 200,
  phone: 150,
  kind: 120,
};
export const TITLE_W = 300;
const colWidth = (p: NoteProperty, widths: Record<string, number>) => widths[p.id] ?? DEFAULT_W[p.type] ?? 180;

type RowProps = { note: DbNote; cols: NoteProperty[]; properties: NoteProperty[]; parent: string | null; onNote: (n: DbNote) => void; onProps: (p: NoteProperty[]) => void };

const TableRow = memo(function TableRow({ note, cols, properties, parent, onNote, onProps }: RowProps) {
  return (
    <div className="db-tr" role="row">
      <div className="db-td db-td-title" role="cell" style={{ width: `var(${widthVar("title")})` }}>
        <NoteCheckbox id={note.id} title={displayTitle(note)} />
        <NoteTitle note={note} parent={parent} onNote={onNote} rename />
      </div>
      {cols.map((p) => (
        <div key={p.id} className="db-td" role="cell" style={{ width: `var(${widthVar(p.id)})` }}>
          <PropertyValue note={note} prop={p} properties={properties} variant="cell" onChange={onNote} onPropertiesChange={onProps} />
        </div>
      ))}
      <div className="db-td db-td-fill" aria-hidden />
    </div>
  );
});

export function TableView({
  notes,
  cols,
  widths,
  sorts,
  titles,
  onWidth,
  onSort,
  onFilter,
  onHide,
  onReorder,
}: {
  notes: DbNote[];
  cols: NoteProperty[];
  widths: Record<string, number>;
  sorts: SortRule[];
  titles: Map<string, string>;
  onWidth: (id: string, w: number) => void;
  onSort: (prop: string, dir: "asc" | "desc") => void;
  onFilter: (prop: string) => void;
  onHide: (prop: string) => void;
  /** Column dragged to a new place: `id` goes before `beforeId` (null = to the end). */
  onReorder: (id: string, beforeId: string | null) => void;
}) {
  const env = useDb();
  const wrap = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; rect: Rect } | null>(null);
  const [adding, setAdding] = useState<Rect | null>(null);
  const { limit, sentinel } = useChunk(notes.length);

  const style = useMemo(() => {
    const s: Record<string, string> = { [widthVar("title")]: `${widths.title ?? TITLE_W}px` };
    for (const p of cols) s[widthVar(p.id)] = `${colWidth(p, widths)}px`;
    return s as React.CSSProperties;
  }, [cols, widths]);

  const startResize = (id: string, startW: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = wrap.current;
    if (!el) return;
    const startX = e.clientX;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.max(60, Math.min(1000, startW + ev.clientX - startX)));
      el.style.setProperty(widthVar(id), `${w}px`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("db-resizing");
      if (w !== startW) onWidth(id, w);
    };
    document.body.classList.add("db-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // ---- Drag a column header to move it (mouse / pen; on touch use Properties). Click still opens the menu.
  const [drag, setDrag] = useState<{ id: string; before: string | null; x: number } | null>(null);
  const justDragged = useRef(false);
  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const startX = e.clientX;
    let active = false;
    let before: string | null = id;
    const heads = () => [...(wrap.current?.querySelectorAll<HTMLElement>("[data-col]") ?? [])].filter((h) => h.dataset.col !== id);
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientX - startX) < 6) return;
        active = true;
        document.body.classList.add("db-moving-col");
      }
      let target: string | null = null;
      let line = 0;
      const list = heads();
      for (const h of list) {
        const r = h.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          target = h.dataset.col ?? null;
          line = r.left;
          break;
        }
        line = r.right;
      }
      before = target;
      setDrag({ id, before: target, x: line - (wrap.current?.getBoundingClientRect().left ?? 0) + (wrap.current?.scrollLeft ?? 0) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("db-moving-col");
      setDrag(null);
      if (active) {
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 0);
        onReorder(id, before);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const sortOf = (id: string) => sorts.find((s) => s.prop === id)?.dir;
  const arrow = (id: string) => {
    const d = sortOf(id);
    return d ? <span className="db-th-sort" aria-label={d === "asc" ? "sorted ascending" : "sorted descending"}>{d === "asc" ? "↑" : "↓"}</span> : null;
  };
  const menuProp = menu && menu.id !== "title" ? env.properties.find((p) => p.id === menu.id) ?? null : null;
  const close = () => setMenu(null);
  const actions = (id: string, hide: boolean) => (
    <>
      <MenuItem icon="↑" label="Sort ascending" onClick={() => (onSort(id, "asc"), close())} />
      <MenuItem icon="↓" label="Sort descending" onClick={() => (onSort(id, "desc"), close())} />
      <MenuItem icon="⚲" label="Filter" onClick={() => (close(), onFilter(id))} />
      {hide && <MenuItem icon="◌" label="Hide in view" onClick={() => (onHide(id), close())} />}
    </>
  );

  const rows = notes.length > limit ? notes.slice(0, limit) : notes;
  return (
    <div ref={wrap} className="db-table-scroll" style={style}>
      {drag && <div className="db-drop-line" style={{ left: drag.x }} aria-hidden />}
      <div className="db-table" role="table" aria-label="Notes" aria-rowcount={notes.length}>
        <div className="db-thead" role="row">
          <div className="db-th db-th-title" role="columnheader" style={{ width: `var(${widthVar("title")})` }}>
            <button type="button" className="db-th-btn" onClick={(e) => setMenu({ id: "title", rect: rectOf(e.currentTarget) })}>
              <span className="db-th-icon">Aa</span>
              <span className="truncate">Name</span>
              {arrow("title")}
            </button>
            <span className="db-resizer" onPointerDown={startResize("title", widths.title ?? TITLE_W)} aria-hidden />
          </div>
          {cols.map((p) => (
            <div key={p.id} data-col={p.id} className={`db-th ${drag?.id === p.id ? "is-moving" : ""}`} role="columnheader" style={{ width: `var(${widthVar(p.id)})` }}>
              <button
                type="button"
                className="db-th-btn"
                onPointerDown={startDrag(p.id)}
                onClick={(e) => {
                  if (justDragged.current) return;
                  setMenu({ id: p.id, rect: rectOf(e.currentTarget) });
                }}
                title={`${p.name} (drag to move)`}
              >
                <span className="db-th-icon">{TYPE_ICON[p.type] ?? "≡"}</span>
                <span className="truncate">{p.name || "Untitled"}</span>
                {arrow(p.id)}
              </button>
              <span className="db-resizer" onPointerDown={startResize(p.id, colWidth(p, widths))} aria-hidden />
            </div>
          ))}
          <div className="db-th db-th-add">
            <button type="button" className="db-th-btn justify-center" title="Add a property" aria-label="Add a property" onClick={(e) => setAdding(rectOf(e.currentTarget))}>
              +
            </button>
          </div>
          <div className="db-th db-td-fill" aria-hidden />
        </div>
        {rows.map((n) => (
          <TableRow key={n.id} note={n} cols={cols} properties={env.properties} parent={parentTitle(n, titles)} onNote={env.onNote} onProps={env.onProps} />
        ))}
        {sentinel}
        <div className="db-tfoot">
          <NewNoteButton templates={env.templates} values={env.newValues} compact />
        </div>
      </div>

      {menu?.id === "title" && (
        <Popover rect={menu.rect} onClose={close} width={220} className="n-menu">
          <div className="p-1">{actions("title", false)}</div>
        </Popover>
      )}
      {menuProp && menu && <PropertyMenu prop={menuProp} properties={env.properties} rect={menu.rect} onClose={close} onChanged={env.onProps} actions={actions(menuProp.id, true)} />}
      {adding && (
        <AddPropertyMenu
          rect={adding}
          properties={env.properties}
          onClose={() => setAdding(null)}
          onCreated={(_prop, properties) => {
            setAdding(null);
            env.onProps(properties);
          }}
        />
      )}
    </div>
  );
}
