"use client";
// OWNED BY: property editing UI. The properties under the title of a note page (like Notion): each
// property with its value, empty ones behind "N more properties", "+ Add a property", drag to reorder.
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@/components/editor/ui";
import { reorderProperties, updateProperty } from "@/app/notes-db-actions";
import { rawValue } from "@/lib/notes-db/values";
import { TYPE_ICON, TYPE_LABEL, isEmptyValue, type DbData, type DbNote, type NoteProperty, type PropType } from "@/lib/notes-db/types";
import PropertyValue from "./PropertyValue";
import { AddPropertyMenu, PropertyMenu, type Rect } from "./PropertyMenu";
import { PropEnvContext, anchorOf, errorText, fitWidth, moveItem, toast, useDragReorder } from "./prop-ui";
import "./properties.css";

const KEY = "notes-db:props-expanded";
/** Never "empty": always shown. */
const ALWAYS: PropType[] = ["status", "kind", "created_time", "last_edited_time", "word_count", "open_todos", "backlinks", "unique_id"];

function findNote(d: DbData, id: string): DbNote | null {
  return d.notes?.find((n) => n.id === id) ?? d.templateNotes?.find((n) => n.id === id) ?? null;
}

function isEmptyProp(note: DbNote, p: NoteProperty, all: NoteProperty[]) {
  if (ALWAYS.includes(p.type)) return false;
  let v: unknown;
  try {
    v = rawValue(note, p, all);
  } catch {
    return true;
  }
  if (p.type === "checkbox") return v !== true;
  return isEmptyValue(v);
}

export default function NoteProperties({ data, noteId, readOnly }: { data: DbData; noteId: string; readOnly?: boolean }) {
  const [note, setNote] = useState<DbNote | null>(() => findNote(data, noteId));
  const [properties, setProperties] = useState<NoteProperty[]>(() => data.properties ?? []);
  useEffect(() => {
    setNote(findNote(data, noteId));
    setProperties(data.properties ?? []);
  }, [data, noteId]);

  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const [menu, setMenu] = useState<{ id: string; rect: Rect } | null>(null);
  const [adding, setAdding] = useState<Rect | null>(null);
  const [hiddenPop, setHiddenPop] = useState<Rect | null>(null);
  // Shown once with a value (or just added) = stays shown while you are on the page
  const sticky = useRef(new Set<string>());

  const tags = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const n of [...(data.notes ?? []), ...(data.templateNotes ?? [])]) for (const t of n.tags ?? []) if (t?.name && !m.has(t.name.toLowerCase())) m.set(t.name.toLowerCase(), t);
    return [...m.values()];
  }, [data]);
  const env = useMemo(() => ({ timezone: data.timezone, tags }), [data.timezone, tags]);

  const ordered = useMemo(() => [...properties].sort((a, b) => a.position - b.position), [properties]);

  const drag = useDragReorder((id, targetId, before) => {
    const prev = properties;
    const next = moveItem(ordered, id, targetId, before).map((p, i) => ({ ...p, position: i }));
    setProperties(next);
    void reorderProperties(next.map((p) => p.id))
      .then((r) => {
        if (!r.ok) throw r;
      })
      .catch((e) => {
        setProperties(prev);
        toast(errorText(e, "Couldn't move it."));
      });
  });

  if (!note) return null;

  const visible = ordered.filter((p) => !p.hidden);
  const hidden = ordered.filter((p) => p.hidden);
  const shown: NoteProperty[] = [];
  let emptyCount = 0;
  for (const p of visible) {
    const empty = isEmptyProp(note, p, properties);
    if (!empty) sticky.current.add(p.id);
    const keep = !empty || sticky.current.has(p.id);
    if (!keep) emptyCount += 1;
    if (keep || expanded) shown.push(p);
  }
  const menuProp = menu ? properties.find((p) => p.id === menu.id) ?? null : null;

  const unhide = async (p: NoteProperty) => {
    const prev = properties;
    setProperties(properties.map((x) => (x.id === p.id ? { ...x, hidden: false } : x)));
    sticky.current.add(p.id);
    try {
      const r = await updateProperty(p.id, { hidden: false });
      if (!r.ok) throw r;
      setProperties((cur) => cur.map((x) => (x.id === p.id ? r.property : x)));
    } catch (e) {
      setProperties(prev);
      toast(errorText(e));
    }
  };

  return (
    <PropEnvContext.Provider value={env}>
      <div className="np-props" aria-label="Properties">
        <div ref={drag.containerRef}>
          {shown.map((p) => (
            <div key={p.id} data-drag-id={p.id} className={`np-prop-row ${drag.rowClass(p.id)}`}>
              {!readOnly && (
                <span className="np-prop-handle" title="Drag to move" aria-label={`Move ${p.name}`} role="button" {...drag.gripProps(p.id)}>
                  ⋮⋮
                </span>
              )}
              <button
                type="button"
                className={`np-prop-name ${readOnly ? "" : "is-btn"}`}
                title={`${p.name} · ${TYPE_LABEL[p.type] ?? p.type}`}
                disabled={readOnly}
                onClick={(e) => setMenu({ id: p.id, rect: anchorOf(e.currentTarget) })}
              >
                <span className="np-icon">{TYPE_ICON[p.type] ?? "•"}</span>
                <span className="np-prop-name-text">{p.name}</span>
              </button>
              <div className="np-prop-value">
                <PropertyValue note={note} prop={p} properties={properties} variant="page" readOnly={readOnly} onChange={setNote} onPropertiesChange={setProperties} />
              </div>
            </div>
          ))}
        </div>
        <div className="np-props-foot">
          {emptyCount > 0 && (
            <button type="button" className="np-props-btn" onClick={toggleExpanded} aria-expanded={expanded}>
              <span className="np-icon">{expanded ? "▾" : "▸"}</span>
              {expanded ? `Hide ${emptyCount} empty ${emptyCount === 1 ? "property" : "properties"}` : `${emptyCount} more ${emptyCount === 1 ? "property" : "properties"}`}
            </button>
          )}
          {!readOnly && (
            <button type="button" className="np-props-btn" onClick={(e) => setAdding(anchorOf(e.currentTarget))}>
              <span className="np-icon">+</span>
              Add a property
            </button>
          )}
          {!readOnly && hidden.length > 0 && (
            <button type="button" className="np-props-btn" onClick={(e) => setHiddenPop(anchorOf(e.currentTarget))}>
              <span className="np-icon">👁</span>
              {hidden.length} hidden
            </button>
          )}
        </div>
      </div>

      {menu && menuProp && !readOnly && <PropertyMenu prop={menuProp} properties={properties} rect={menu.rect} onClose={() => setMenu(null)} onChanged={setProperties} />}
      {adding && !readOnly && (
        <AddPropertyMenu
          rect={adding}
          properties={properties}
          onClose={() => setAdding(null)}
          onCreated={(p, list) => {
            sticky.current.add(p.id);
            setProperties(list);
          }}
        />
      )}
      {hiddenPop && !readOnly && (
        <Popover rect={hiddenPop} onClose={() => setHiddenPop(null)} width={fitWidth(260)} className="np-menu">
          <p className="n-menu-label">Hidden in the page · click to show</p>
          {hidden.map((p) => (
            <button key={p.id} type="button" className="np-row-btn" onClick={() => void unhide(p)}>
              <span className="np-icon">{TYPE_ICON[p.type] ?? "•"}</span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="np-right">Show</span>
            </button>
          ))}
          {!hidden.length && <p className="np-hint">Nothing hidden.</p>}
        </Popover>
      )}
    </PropEnvContext.Provider>
  );
}
