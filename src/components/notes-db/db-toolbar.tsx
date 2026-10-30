"use client";
// Toolbar of the notes database: layout (Table · List · Gallery · Board), search, "+ Filter" chips,
// Advanced filter, Sort, Properties, hide block notes, board / gallery options, count and "New ▾".
import { useState, type Dispatch, type SetStateAction } from "react";
import NewNoteButton from "@/components/notes-db/NewNoteButton";
import { AdvancedFilter, FilterChip, PropertyPicker } from "@/components/notes-db/db-filters";
import { PropertiesMenu } from "@/components/notes-db/db-properties";
import { SortMenu } from "@/components/notes-db/db-sort";
import { ToolButton, rectOf, useDb, type Rect } from "@/components/notes-db/db-shared";
import { canGroupBy, countActiveRules } from "@/lib/notes-db/query";
import type { Layout, ViewState } from "@/lib/notes-db/types";

export const HIDE_BLOCKS_ID = "hide-blocks";
export type CardSize = "small" | "medium" | "large";

const LAYOUTS: { id: Layout; label: string; icon: string }[] = [
  { id: "table", label: "Table", icon: "▦" },
  { id: "list", label: "List", icon: "☰" },
  { id: "gallery", label: "Gallery", icon: "▣" },
  { id: "board", label: "Board", icon: "▥" },
];

export function Toolbar({
  view,
  setView,
  setVisible,
  count,
  total,
  filtering,
  openChip,
  setOpenChip,
  onAddFilter,
  onClearFilters,
  kindPropId,
  cardSize,
  setCardSize,
  hideEmpty,
  setHideEmpty,
}: {
  view: ViewState;
  setView: Dispatch<SetStateAction<ViewState>>;
  /** Show / hide / move columns (a move is saved in the database). */
  setVisible: (ids: string[]) => void;
  count: number;
  total: number;
  filtering: boolean;
  openChip: string | null;
  setOpenChip: (id: string | null) => void;
  onAddFilter: (propId: string) => void;
  onClearFilters: () => void;
  kindPropId: string | null;
  cardSize: CardSize;
  setCardSize: (s: CardSize) => void;
  hideEmpty: boolean;
  setHideEmpty: (on: boolean) => void;
}) {
  const env = useDb();
  const [menu, setMenu] = useState<{ kind: "add" | "advanced" | "sort" | "props"; rect: Rect } | null>(null);
  const open = (kind: "add" | "advanced" | "sort" | "props") => (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = rectOf(e.currentTarget);
    setMenu((m) => (m?.kind === kind ? null : { kind, rect }));
  };
  const chips = view.quick.filter((r) => r.id !== HIDE_BLOCKS_ID);
  const hiding = view.quick.some((r) => r.id === HIDE_BLOCKS_ID);
  const adv = countActiveRules(view.advanced, env.properties);
  const groupable = env.properties.filter(canGroupBy).sort((a, b) => a.position - b.position);
  const set = (patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch }));

  return (
    <div className="db-toolbar">
      <div className="db-bar">
        <div className="db-layouts" role="tablist" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="tab" aria-selected={view.layout === l.id} className={`db-layout ${view.layout === l.id ? "is-on" : ""}`} onClick={() => set({ layout: l.id })} title={l.label}>
              <span aria-hidden>{l.icon}</span>
              <span className="db-layout-label">{l.label}</span>
            </button>
          ))}
        </div>
        <span className="db-count" aria-live="polite">
          {count} {count === 1 ? "note" : "notes"}
          {filtering && count !== total && <span className="text-faint"> of {total}</span>}
        </span>
        <div className="ml-auto shrink-0">
          <NewNoteButton templates={env.templates} values={env.newValues} />
        </div>
      </div>

      <div className="db-bar db-bar-tools">
        <label className="db-search">
          <span aria-hidden className="text-faint">⌕</span>
          <input
            type="search"
            value={view.search}
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && view.search) {
                e.preventDefault();
                set({ search: "" });
              }
            }}
            placeholder="Search notes…"
            aria-label="Search notes"
          />
          {view.search && (
            <button type="button" className="db-search-x" aria-label="Clear search" onClick={() => set({ search: "" })}>
              ✕
            </button>
          )}
        </label>
        <ToolButton onClick={open("add")} title="Add a filter chip">
          <span aria-hidden>⚲</span> Filter
        </ToolButton>
        <ToolButton onClick={open("advanced")} on={adv > 0} title="Filters with And / Or and groups">
          Advanced{adv > 0 && <span className="db-badge-n">{adv}</span>}
        </ToolButton>
        <ToolButton onClick={open("sort")} on={view.sorts.length > 0} title="Sort">
          <span aria-hidden>⇅</span> Sort{view.sorts.length > 0 && <span className="db-badge-n">{view.sorts.length}</span>}
        </ToolButton>
        <ToolButton onClick={open("props")} title="Show, hide and order properties">
          Properties
        </ToolButton>
        {kindPropId && (
          <ToolButton
            on={hiding}
            title={hiding ? "Block notes are hidden" : "Hide block notes (✏️)"}
            onClick={() =>
              setView((v) => ({
                ...v,
                quick: hiding ? v.quick.filter((r) => r.id !== HIDE_BLOCKS_ID) : [...v.quick, { kind: "rule", id: HIDE_BLOCKS_ID, prop: kindPropId, op: "is_not", value: "block" }],
              }))
            }
          >
            <span className={`db-check ${hiding ? "is-on" : ""}`} aria-hidden>
              {hiding ? "✓" : ""}
            </span>
            Hide block notes
          </ToolButton>
        )}
        {view.layout === "board" && groupable.length > 0 && (
          <>
            <label className="db-tool db-tool-select">
              <span className="text-faint">Group by</span>
              <select value={view.groupBy ?? ""} onChange={(e) => set({ groupBy: e.target.value || null })} aria-label="Group board by">
                {groupable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || "Untitled"}
                  </option>
                ))}
              </select>
            </label>
            <ToolButton on={hideEmpty} onClick={() => setHideEmpty(!hideEmpty)} title="Hide columns without notes">
              <span className={`db-check ${hideEmpty ? "is-on" : ""}`} aria-hidden>
                {hideEmpty ? "✓" : ""}
              </span>
              Hide empty columns
            </ToolButton>
          </>
        )}
        {view.layout === "gallery" && (
          <div className="db-segs" role="radiogroup" aria-label="Card size">
            {(["small", "medium", "large"] as CardSize[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={cardSize === s} className={`db-seg ${cardSize === s ? "is-on" : ""}`} onClick={() => setCardSize(s)}>
                {s === "small" ? "S" : s === "medium" ? "M" : "L"}
              </button>
            ))}
          </div>
        )}
      </div>

      {(chips.length > 0 || filtering) && (
        <div className="db-chips">
          {chips.map((r) => (
            <FilterChip
              key={r.id}
              rule={r}
              open={openChip === r.id}
              onOpen={() => setOpenChip(r.id)}
              onClose={() => setOpenChip(null)}
              onChange={(next) => setView((v) => ({ ...v, quick: v.quick.map((x) => (x.id === r.id ? next : x)) }))}
              onDelete={() => {
                setOpenChip(null);
                setView((v) => ({ ...v, quick: v.quick.filter((x) => x.id !== r.id) }));
              }}
            />
          ))}
          <button type="button" className="db-chip is-add" onClick={open("add")}>
            + Filter
          </button>
          {filtering && (
            <button type="button" className="db-link ml-1" onClick={onClearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {menu?.kind === "add" && (
        <PropertyPicker
          rect={menu.rect}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            onAddFilter(id);
          }}
        />
      )}
      {menu?.kind === "advanced" && <AdvancedFilter rect={menu.rect} value={view.advanced} onChange={(g) => set({ advanced: g })} onClose={() => setMenu(null)} />}
      {menu?.kind === "sort" && <SortMenu rect={menu.rect} sorts={view.sorts} onChange={(s) => set({ sorts: s })} onClose={() => setMenu(null)} />}
      {menu?.kind === "props" && <PropertiesMenu rect={menu.rect} visible={view.visible} onChange={setVisible} onClose={() => setMenu(null)} />}
    </div>
  );
}
