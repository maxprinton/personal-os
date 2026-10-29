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
            <div key={p.id} className="db-th" role="columnheader" style={{ width: `var(${widthVar(p.id)})` }}>
              <button type="button" className="db-th-btn" onClick={(e) => setMenu({ id: p.id, rect: rectOf(e.currentTarget) })} title={p.name}>
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
