"use client";
// Sort menu of the notes database: several sorts, in order (drag, or ↑ ↓ on phones), ascending / descending.
import { useMemo, useState } from "react";
import { MenuLabel, Popover } from "@/components/editor/ui";
import { fit, useDb, type Rect } from "@/components/notes-db/db-shared";
import type { SortRule } from "@/lib/notes-db/types";

export function SortMenu({ rect, sorts, onChange, onClose }: { rect: Rect; sorts: SortRule[]; onChange: (s: SortRule[]) => void; onClose: () => void }) {
  const { properties } = useDb();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const options = useMemo(() => [{ id: "title", name: "Name" }, ...[...properties].sort((a, b) => a.position - b.position).map((p) => ({ id: p.id, name: p.name || "Untitled" }))], [properties]);
  const used = new Set(sorts.map((s) => s.prop));
  const free = options.filter((o) => !used.has(o.id));
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= sorts.length) return;
    const next = [...sorts];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  const set = (i: number, patch: Partial<SortRule>) => onChange(sorts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <Popover rect={rect} onClose={onClose} width={fit(400)} className="n-menu">
      <div className="p-2">
        <MenuLabel>Sort</MenuLabel>
        {!sorts.length && <p className="db-hint px-2.5">No sorts: last edited notes come first.</p>}
        <div className="space-y-1">
          {sorts.map((s, i) => (
            <div
              key={s.prop}
              className={`db-sort-row ${over === i && drag !== null && drag !== i ? "is-over" : ""}`}
              draggable
              onMouseDown={(e) => e.stopPropagation() /* the popover's preventDefault would block dragging */}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            >
              <span className="db-handle" title="Drag to reorder" aria-hidden>
                ⋮⋮
              </span>
              <select value={s.prop} onChange={(e) => set(i, { prop: e.target.value })} className="n-input db-select min-w-0 flex-1" aria-label="Sort by">
                {options
                  .filter((o) => o.id === s.prop || !used.has(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <select value={s.dir} onChange={(e) => set(i, { dir: e.target.value === "desc" ? "desc" : "asc" })} className="n-input db-select" aria-label="Direction">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button type="button" className="db-icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="db-icon-btn" title="Move down" aria-label="Move down" disabled={i === sorts.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </button>
              <button type="button" className="db-icon-btn" title="Remove sort" aria-label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="db-adv-actions mt-1">
          {free.length > 0 && (
            <button type="button" className="db-link" onClick={() => onChange([...sorts, { prop: sorts.length ? free[0].id : (free.find((o) => o.id !== "title") ?? free[0]).id, dir: "asc" }])}>
              + Add sort
            </button>
          )}
          {sorts.length > 0 && (
            <button type="button" className="db-link is-danger ml-auto" onClick={() => onChange([])}>
              Delete sorts
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}
