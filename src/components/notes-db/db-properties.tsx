"use client";
// "Properties" menu of the notes database: show / hide each property in the current view and change
// the order of the columns (drag, or ↑ ↓ on phones). Only this browser's view changes.
import { useMemo, useState } from "react";
import { MenuLabel, Popover } from "@/components/editor/ui";
import { fit, useDb, type Rect } from "@/components/notes-db/db-shared";
import { fold } from "@/lib/notes-db/query";
import { TYPE_ICON, type NoteProperty } from "@/lib/notes-db/types";

export function PropertiesMenu({ rect, visible, onChange, onClose }: { rect: Rect; visible: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const { properties } = useDb();
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byId = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const t = fold(q.trim());
  const match = (p: NoteProperty) => !t || fold(p.name).includes(t);
  const shown = visible.map((id) => byId.get(id)).filter((p): p is NoteProperty => !!p);
  const hidden = [...properties].filter((p) => !visible.includes(p.id)).sort((a, b) => a.position - b.position);
  const move = (id: string, to: number) => {
    const from = visible.indexOf(id);
    if (from < 0 || to < 0 || to >= visible.length || from === to) return;
    const next = [...visible];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onChange(next);
  };
  const row = (p: NoteProperty, on: boolean, i: number) => (
    <div
      key={p.id}
      className={`db-prop-row ${over === p.id && drag && drag !== p.id ? "is-over" : ""}`}
      draggable={on && !t}
      onMouseDown={(e) => e.stopPropagation() /* the popover's preventDefault would block dragging */}
      onDragStart={(e) => {
        setDrag(p.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.id);
      }}
      onDragOver={(e) => {
        if (!on || !drag) return;
        e.preventDefault();
        setOver(p.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (drag) move(drag, visible.indexOf(p.id));
        setDrag(null);
        setOver(null);
      }}
      onDragEnd={() => {
        setDrag(null);
        setOver(null);
      }}
    >
      {on ? (
        <span className="db-handle" aria-hidden>
          ⋮⋮
        </span>
      ) : (
        <span className="db-handle" aria-hidden />
      )}
      <span className="n-menu-icon n-type-icon">{TYPE_ICON[p.type] ?? "≡"}</span>
      <span className="min-w-0 flex-1 truncate">{p.name || "Untitled"}</span>
      {on && (
        <>
          <button type="button" className="db-icon-btn" title="Move up" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(p.id, i - 1)}>
            ↑
          </button>
          <button type="button" className="db-icon-btn" title="Move down" aria-label={`Move ${p.name} down`} disabled={i === shown.length - 1} onClick={() => move(p.id, i + 1)}>
            ↓
          </button>
        </>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Hide" : "Show"} ${p.name}`}
        title={on ? "Hide in this view" : "Show in this view"}
        className={`db-eye ${on ? "is-on" : ""}`}
        onClick={() => onChange(on ? visible.filter((x) => x !== p.id) : [...visible, p.id])}
      >
        {on ? "👁" : "◌"}
      </button>
    </div>
  );
  return (
    <Popover rect={rect} onClose={onClose} width={fit(320)} className="n-menu">
      <div className="p-1.5">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a property…" className="n-input mb-1 w-full" />
        <div className="max-h-[min(60vh,440px)] overflow-y-auto">
          <div className="flex items-center justify-between pr-1">
            <MenuLabel>Shown in this view</MenuLabel>
            {shown.length > 0 && (
              <button type="button" className="db-link" onClick={() => onChange([])}>
                Hide all
              </button>
            )}
          </div>
          <div className="db-prop-row is-fixed">
            <span className="db-handle" aria-hidden />
            <span className="n-menu-icon n-type-icon">Aa</span>
            <span className="min-w-0 flex-1 truncate">Name</span>
            <span className="text-xs text-faint">always</span>
          </div>
          {shown.filter(match).map((p) => row(p, true, shown.indexOf(p)))}
          {hidden.length > 0 && (
            <div className="flex items-center justify-between pr-1">
              <MenuLabel>Hidden in this view</MenuLabel>
              <button type="button" className="db-link" onClick={() => onChange([...visible, ...hidden.map((p) => p.id)])}>
                Show all
              </button>
            </div>
          )}
          {hidden.filter(match).map((p, i) => row(p, false, i))}
        </div>
      </div>
    </Popover>
  );
}
