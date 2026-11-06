"use client";
// The tabs of the notes database: each one is a saved view (its own layout, filters, sorts, columns).
// Click = open · click the open one (or its ⋯) = Rename / Duplicate / Delete · drag = reorder · + = new view.
import { useRef, useState } from "react";
import { MenuItem, MenuLabel, Popover } from "@/components/editor/ui";
import { fit, rectOf, type Rect } from "@/components/notes-db/db-shared";
import { LAYOUT_ICON, LAYOUT_NAME, MAX_VIEWS, MAX_VIEW_NAME, moveItem, type SavedView } from "@/lib/notes-db/views";
import type { Layout } from "@/lib/notes-db/types";

const LAYOUT_IDS: Layout[] = ["table", "list", "gallery", "board"];

export type ViewTabsProps = {
  views: SavedView[];
  activeId: string;
  dirty: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (layout: Layout) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onSave: () => void;
  onReset: () => void;
};

export default function ViewTabs(p: ViewTabsProps) {
  const { views, activeId } = p;
  const [menu, setMenu] = useState<{ kind: "new" | "view"; id?: string; rect: Rect } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const finishRename = (id: string, value: string) => {
    setRenaming(null);
    const v = views.find((x) => x.id === id);
    const name = value.replace(/\s+/g, " ").trim();
    if (v && name && name !== v.name) p.onRename(id, name);
  };

  const open = (e: React.MouseEvent<HTMLElement>, id: string) => {
    e.stopPropagation();
    setMenu({ kind: "view", id, rect: rectOf(e.currentTarget) });
  };

  const target = menu?.kind === "view" ? views.find((v) => v.id === menu.id) : undefined;

  return (
    <div className="db-views" role="tablist" aria-label="Views">
      <div className="db-views-list">
        {views.map((v, i) => {
          const on = v.id === activeId;
          return (
            <div
              key={v.id}
              className={`db-view-tab ${on ? "is-on" : ""} ${over === i && drag !== null && drag !== i ? "is-over" : ""}`}
              draggable={renaming !== v.id}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", v.id);
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== i) p.onReorder(moveItem(views, drag, i).map((x) => x.id));
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            >
              {renaming === v.id ? (
                <input
                  ref={nameRef}
                  autoFocus
                  defaultValue={v.name}
                  maxLength={MAX_VIEW_NAME}
                  className="db-view-name-input"
                  aria-label="View name"
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => finishRename(v.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishRename(v.id, e.currentTarget.value);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className="db-view-btn"
                  onClick={(e) => (on ? open(e, v.id) : p.onSelect(v.id))}
                  onDoubleClick={() => setRenaming(v.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    open(e, v.id);
                  }}
                  title={on ? "Click for options · double-click to rename · drag to reorder" : "Open this view · drag to reorder"}
                >
                  <span className="db-view-icon" aria-hidden>
                    {LAYOUT_ICON[v.state.layout] ?? "▦"}
                  </span>
                  <span className="db-view-label">{v.name}</span>
                  {on && p.dirty && <span className="db-view-dot" title="Unsaved filters or sorts" aria-label="Unsaved changes" />}
                </button>
              )}
              {on && renaming !== v.id && (
                <button type="button" className="db-view-more" aria-label="View options" title="View options" onClick={(e) => open(e, v.id)}>
                  ⋯
                </button>
              )}
            </div>
          );
        })}
        {views.length < MAX_VIEWS && (
          <button type="button" className="db-view-add" title="New view" aria-label="New view" disabled={p.busy} onClick={(e) => setMenu({ kind: "new", rect: rectOf(e.currentTarget) })}>
            + New view
          </button>
        )}
      </div>
      {p.dirty && (
        <div className="db-view-save" role="group" aria-label="Unsaved filters or sorts">
          <span className="db-hint">Filters or sorts changed</span>
          <button type="button" className="db-link" onClick={p.onReset}>
            Reset
          </button>
          <button type="button" className="db-save-btn" onClick={p.onSave} disabled={p.busy}>
            Save
          </button>
        </div>
      )}

      {menu?.kind === "new" && (
        <Popover rect={menu.rect} onClose={() => setMenu(null)} width={fit(220)} className="n-menu">
          <div className="p-2">
            <MenuLabel>New view</MenuLabel>
            {LAYOUT_IDS.map((l) => (
              <MenuItem
                key={l}
                icon={<span aria-hidden>{LAYOUT_ICON[l]}</span>}
                label={LAYOUT_NAME[l]}
                onClick={() => {
                  setMenu(null);
                  p.onCreate(l);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
      {menu?.kind === "view" && target && (
        <Popover rect={menu.rect} onClose={() => setMenu(null)} width={fit(220)} className="n-menu">
          <div className="p-2">
            <MenuLabel>{target.name}</MenuLabel>
            <MenuItem
              icon={<span aria-hidden>✎</span>}
              label="Rename"
              onClick={() => {
                setMenu(null);
                setRenaming(target.id);
              }}
            />
            <MenuItem
              icon={<span aria-hidden>⧉</span>}
              label="Duplicate"
              hint={views.length >= MAX_VIEWS ? `Up to ${MAX_VIEWS} views` : undefined}
              onClick={() => {
                setMenu(null);
                if (views.length < MAX_VIEWS) p.onDuplicate(target.id);
              }}
            />
            {views.findIndex((v) => v.id === target.id) > 0 && (
              <MenuItem
                icon={<span aria-hidden>←</span>}
                label="Move left"
                onClick={() => {
                  const i = views.findIndex((v) => v.id === target.id);
                  setMenu(null);
                  p.onReorder(moveItem(views, i, i - 1).map((x) => x.id));
                }}
              />
            )}
            {views.findIndex((v) => v.id === target.id) < views.length - 1 && (
              <MenuItem
                icon={<span aria-hidden>→</span>}
                label="Move right"
                onClick={() => {
                  const i = views.findIndex((v) => v.id === target.id);
                  setMenu(null);
                  p.onReorder(moveItem(views, i, i + 1).map((x) => x.id));
                }}
              />
            )}
            {views.length > 1 && (
              <MenuItem
                danger
                icon={<span aria-hidden>🗑</span>}
                label="Delete view"
                onClick={() => {
                  setMenu(null);
                  p.onDelete(target.id);
                }}
              />
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
