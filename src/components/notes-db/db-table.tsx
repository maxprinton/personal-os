"use client";
// Table view of the notes database: sticky header (icon + name → property menu with Sort / Filter /
// Hide), resizable columns, title column with the row checkbox, editable cells, "+" to add a property
// and "+ New" at the bottom. Scrolls sideways on small screens.
// Click a cell to select it (arrows move, Shift+↑/↓ extends); drag the dot at its corner (or Ctrl/⌘+D) to copy
// its value down, like Notion. Multi-values are replaced; big fills ask first and every fill has Undo.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MenuItem, Popover } from "@/components/editor/ui";
import { NoteCheckbox } from "@/components/NotesExport";
import NewNoteButton from "@/components/notes-db/NewNoteButton";
import { useBulk } from "@/components/notes-db/db-bulk";
import PropertyValue from "@/components/notes-db/PropertyValue";
import { AddPropertyMenu, PropertyMenu } from "@/components/notes-db/PropertyMenu";
import { NoteTitle } from "@/components/notes-db/db-title";
import { displayTitle, parentTitle, rectOf, useChunk, useDb, widthVar, type Rect } from "@/components/notes-db/db-shared";
import { canFill } from "@/lib/notes-db/fill";
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

/** The nearest ancestor that scrolls vertically (null = the window itself). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
const colWidth = (p: NoteProperty, widths: Record<string, number>) => widths[p.id] ?? DEFAULT_W[p.type] ?? 180;

type RowProps = {
  note: DbNote;
  cols: NoteProperty[];
  properties: NoteProperty[];
  parent: string | null;
  onNote: (n: DbNote) => void;
  onProps: (p: NoteProperty[]) => void;
  /** Property id of this row's selected cell, if any. */
  selProp: string | null;
  /** Property id of the column being filled, when this row is inside the fill range. */
  rangeProp: string | null;
  /** Pointer down on a cell: selects it (Shift extends the range → returns true). */
  onSelect: (noteId: string, propId: string, shift: boolean) => boolean;
  onHandle: (e: React.PointerEvent, noteId: string, propId: string) => void;
};

const TableRow = memo(function TableRow({ note, cols, properties, parent, onNote, onProps, selProp, rangeProp, onSelect, onHandle }: RowProps) {
  const ranged = useRef(false);
  return (
    <div className="db-tr" role="row" data-row={note.id}>
      <div className="db-td db-td-title" role="cell" style={{ width: `var(${widthVar("title")})` }}>
        <NoteCheckbox id={note.id} title={displayTitle(note)} />
        <NoteTitle note={note} parent={parent} onNote={onNote} rename />
      </div>
      {cols.map((p) => (
        <div
          key={p.id}
          data-pid={p.id}
          tabIndex={-1}
          className={`db-td${selProp === p.id ? " is-sel" : ""}${rangeProp === p.id ? " is-fillrange" : ""}`}
          role="cell"
          style={{ width: `var(${widthVar(p.id)})` }}
          onPointerDown={(e) => {
            if (e.button === 0) ranged.current = onSelect(note.id, p.id, e.shiftKey);
          }}
          onClickCapture={(e) => {
            // Shift+click only extends the fill range: it must not open the editor
            if (ranged.current) {
              ranged.current = false;
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          <PropertyValue note={note} prop={p} properties={properties} variant="cell" onChange={onNote} onPropertiesChange={onProps} />
          {selProp === p.id && canFill(p) && <span className="db-fill-handle" title="Drag down to fill (or Ctrl+D)" onPointerDown={(e) => onHandle(e, note.id, p.id)} aria-hidden />}
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
  const bulk = useBulk();

  // ---- Selected cell + fill range (same column) ----
  const [cell, setCell] = useState<{ noteId: string; propId: string } | null>(null);
  const [endId, setEndId] = useState<string | null>(null);
  const live = useRef({ notes, cols, bulk, cell });
  live.current = { notes, cols, bulk, cell };

  const rangeIds = useMemo(() => {
    if (!cell || !endId || endId === cell.noteId) return null;
    const a = notes.findIndex((n) => n.id === cell.noteId);
    const b = notes.findIndex((n) => n.id === endId);
    if (a < 0 || b < 0) return null;
    return new Set(notes.slice(Math.min(a, b), Math.max(a, b) + 1).map((n) => n.id));
  }, [cell, endId, notes]);

  const selectCell = useCallback((noteId: string, propId: string, shift: boolean) => {
    const c = live.current.cell;
    if (shift && c && c.propId === propId && c.noteId !== noteId) {
      setEndId(noteId);
      return true;
    }
    setCell({ noteId, propId });
    setEndId(null);
    return false;
  }, []);

  /** Copies the selected cell into the rows between it and `toId` (or the row below when there is no range). */
  const fillTo = useCallback((toId: string | null) => {
    const { cell: c, notes: list, cols: cs, bulk: b } = live.current;
    if (!c) return;
    const prop = cs.find((p) => p.id === c.propId);
    const a = list.findIndex((n) => n.id === c.noteId);
    const z = toId ? list.findIndex((n) => n.id === toId) : a + 1;
    setEndId(null);
    if (!prop || !canFill(prop) || a < 0 || z < 0 || z >= list.length || z === a) return;
    b.fill(prop, c.noteId, list.slice(Math.min(a, z), Math.max(a, z) + 1).map((n) => n.id));
  }, []);

  // Drag the dot at the corner of the selected cell up or down
  const startFill = useCallback(
    (e: React.PointerEvent, noteId: string, propId: string) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      e.preventDefault();
      e.stopPropagation();
      setCell({ noteId, propId });
      setEndId(null);
      let end = noteId;
      let x = e.clientX;
      let y = e.clientY;
      document.body.classList.add("db-filling");
      const update = () => {
        const hit = document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.row) as HTMLElement | undefined;
        const id = hit?.dataset.row;
        if (id && id !== end) {
          end = id;
          setEndId(id === noteId ? null : id);
        }
      };
      const move = (ev: PointerEvent) => {
        x = ev.clientX;
        y = ev.clientY;
        update();
      };
      // Near the top / bottom of the window the page (or the panel that scrolls) moves by itself
      const scroller = scrollParent(wrap.current);
      const scrollBy = (dy: number) => (scroller ? scroller.scrollBy(0, dy) : window.scrollBy(0, dy));
      const timer = window.setInterval(() => {
        const edge = 70;
        if (y < edge) scrollBy(-Math.ceil((edge - y) / 4));
        else if (y > window.innerHeight - edge) scrollBy(Math.ceil((y - (window.innerHeight - edge)) / 4));
        else return;
        update();
      }, 30);
      const finish = (apply: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.clearInterval(timer);
        document.body.classList.remove("db-filling");
        if (apply && end !== noteId) fillTo(end);
        else setEndId(null);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    },
    [fillTo],
  );

  // Click elsewhere or Esc drops the selection; Ctrl/⌘+D fills down
  useEffect(() => {
    if (!cell) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".db-td[data-pid], .n-pop, [data-popover], [role='alertdialog']")) return;
      setCell(null);
      setEndId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae?.matches("input, textarea, select, [contenteditable='true']") || document.querySelector(".n-pop")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        fillTo(endId);
      } else if (e.key === "Escape") {
        setCell(null);
        setEndId(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [cell, endId, fillTo]);

  const focusCell = (noteId: string, propId: string) => {
    const td = wrap.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(noteId)}"] [data-pid="${CSS.escape(propId)}"]`);
    (td?.querySelector<HTMLElement>(".np-val[tabindex]") ?? td)?.focus();
  };
  // Arrow keys move between cells; Shift+↑/↓ stretches the fill range
  const onGridKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (!t.matches(".np-val, .db-td[data-pid]") || e.ctrlKey || e.metaKey || e.altKey) return;
    const dr = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dr && !dc) return;
    const pid = t.closest<HTMLElement>(".db-td[data-pid]")?.dataset.pid;
    const nid = t.closest<HTMLElement>("[data-row]")?.dataset.row;
    if (!pid || !nid) return;
    const r = notes.findIndex((n) => n.id === nid);
    const c = cols.findIndex((p) => p.id === pid);
    const nr = r + dr;
    const nc = c + dc;
    if (r < 0 || c < 0 || nr < 0 || nr >= notes.length || nc < 0 || nc >= cols.length) return;
    e.preventDefault();
    const toRow = notes[nr].id;
    const toCol = cols[nc].id;
    if (e.shiftKey && dr) {
      const base = cell && cell.propId === pid ? cell : { noteId: nid, propId: pid };
      setCell(base);
      setEndId(toRow === base.noteId ? null : toRow);
    } else {
      setCell({ noteId: toRow, propId: toCol });
      setEndId(null);
    }
    requestAnimationFrame(() => focusCell(toRow, toCol));
  };

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
    <div ref={wrap} className="db-table-scroll" style={style} onKeyDown={onGridKey}>
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
          <TableRow
            key={n.id}
            note={n}
            cols={cols}
            properties={env.properties}
            parent={parentTitle(n, titles)}
            onNote={env.onNote}
            onProps={env.onProps}
            selProp={cell?.noteId === n.id ? cell.propId : null}
            rangeProp={cell && rangeIds?.has(n.id) ? cell.propId : null}
            onSelect={selectCell}
            onHandle={startFill}
          />
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
