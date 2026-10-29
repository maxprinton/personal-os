"use client";
// OWNED BY: property editing UI. Edit a property (name, type, options, format, relation target, rollup,
// ID prefix, hide in page, delete) and "+ Add a property".
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Popover, useListKeys } from "@/components/editor/ui";
import { createProperty, deleteProperty, updateProperty } from "@/app/notes-db-actions";
import { COLOR_LABEL, COLOR_NAMES, type ColorName } from "@/lib/editor/colors";
import { isBuiltinRelation, resolvePropRef } from "@/lib/notes-db/builtins";
import { CREATABLE_TYPES, TYPE_ICON, TYPE_LABEL, newId, statusGroups, type NoteProperty, type PropConfig, type PropType, type RelationTarget, type RollupCalc, type SelectOption, type StatusGroup } from "@/lib/notes-db/types";
import { GROUP_LABEL } from "./prop-pickers";
import { ColorDot, OptionPill, Switch, anchorOf, errorText, fitWidth, moveItem, useDragReorder, type Anchor } from "./prop-ui";
import "./properties.css";

export type Rect = { left: number; top: number; bottom: number; right?: number };

type Patch = { name?: string; type?: PropType; config?: PropConfig; hidden?: boolean };

const PALETTE: ColorName[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const NUMBER_FORMATS: { id: NonNullable<PropConfig["numberFormat"]>; label: string; hint: string }[] = [
  { id: "number", label: "Number", hint: "1,234.5" },
  { id: "dollar", label: "Dollar", hint: "$1,234.50" },
  { id: "percent", label: "Percent", hint: "12%" },
  { id: "bar", label: "Bar", hint: "▬▬▭" },
];
const TARGETS: { id: RelationTarget; label: string; icon: string }[] = [
  { id: "notes", label: "Notes", icon: "📄" },
  { id: "tasks", label: "Tasks", icon: "☑" },
  { id: "events", label: "Events & blocks", icon: "📅" },
];
const CALCS: { id: RollupCalc; label: string }[] = [
  { id: "count", label: "Count" },
  { id: "count_pending", label: "Pending tasks" },
  { id: "count_done", label: "Done tasks" },
  { id: "percent_done", label: "% done" },
  { id: "next_date", label: "Next date" },
  { id: "show_titles", label: "Show titles" },
];

function Row({ icon, label, right, onClick, danger, active, disabled }: { icon?: ReactNode; label: ReactNode; right?: ReactNode; onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void; danger?: boolean; active?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`np-row-btn ${danger ? "is-danger" : ""} ${active ? "is-active" : ""}`} onClick={onClick} disabled={disabled}>
      {icon !== undefined && <span className="np-icon">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right !== undefined && <span className="np-right">{right}</span>}
    </button>
  );
}

/** Saves on Enter / blur. */
function SaveInput({ value, onSave, placeholder, className = "", autoFocus, label, inputMode }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; label: string; inputMode?: "text" | "decimal" }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => {
    if (v !== value) onSave(v);
  };
  return (
    <input
      value={v}
      aria-label={label}
      autoFocus={autoFocus}
      inputMode={inputMode}
      placeholder={placeholder}
      className={`n-input np-input ${className}`}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

type Sub = { kind: "type"; anchor: Anchor } | { kind: "option"; id: string; anchor: Anchor } | null;

export function PropertyMenu({
  prop,
  properties,
  rect,
  onClose,
  onChanged,
  actions,
}: {
  prop: NoteProperty;
  properties: NoteProperty[];
  rect: Rect;
  onClose: () => void;
  /** The full, updated list of properties after any change (or after delete). */
  onChanged: (properties: NoteProperty[]) => void;
  /** Extra items shown first (the table puts Sort / Filter / Hide here). */
  actions?: ReactNode;
}) {
  const [p, setP] = useState<NoteProperty>(prop);
  const [sub, setSub] = useState<Sub>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<StatusGroup | "any" | null>(null);
  const listRef = useRef(properties);
  listRef.current = properties;
  const cur = useRef(p);
  cur.current = p;
  const req = useRef(0);
  useEffect(() => {
    if (prop.id !== cur.current.id) setP(prop);
  }, [prop]);

  const replace = (x: NoteProperty) => (listRef.current.some((y) => y.id === x.id) ? listRef.current.map((y) => (y.id === x.id ? x : y)) : [...listRef.current, x]);

  /** Optimistic: shows `next` now, then saves `patch`. */
  const save = async (patch: Patch, next?: NoteProperty) => {
    const before = cur.current;
    const n = ++req.current;
    setErr(null);
    if (next) {
      setP(next);
      onChanged(replace(next));
    }
    try {
      const r = await updateProperty(before.id, patch);
      if (n !== req.current) return; // a newer change is on its way
      if (r.ok) {
        setP(r.property);
        onChanged(replace(r.property));
      } else throw r;
    } catch (e) {
      if (n !== req.current) return;
      setP(before);
      onChanged(replace(before));
      setErr(errorText(e));
    }
  };
  const setConfig = (patch: Partial<PropConfig>) => {
    const config = { ...cur.current.config, ...patch };
    void save({ config }, { ...cur.current, config });
  };
  const setOptions = (options: SelectOption[], extra: Partial<PropConfig> = {}) => setConfig({ options, ...extra });

  const own = !p.builtin;
  const type = p.type;
  const options = p.config.options ?? [];
  const hasOptions = type === "select" || type === "multi_select" || type === "status";

  // ---- options ----
  const addOpt = (name: string, group?: StatusGroup) => {
    const clean = name.trim().slice(0, 100);
    if (!clean) return;
    if (options.some((o) => o.name.toLowerCase() === clean.toLowerCase())) {
      setErr("That option already exists.");
      return;
    }
    const o: SelectOption = { id: newId("o"), name: clean, color: PALETTE[options.length % PALETTE.length], ...(type === "status" ? { group: group ?? "todo" } : {}) };
    setOptions([...options, o]);
  };
  const drag = useDragReorder((id, targetId, before) =>
    setOptions(moveItem(options, id, targetId, before, (item, target) => (type === "status" ? { ...item, group: target.group ?? "todo" } : item))),
  );

  const optRow = (o: SelectOption) => (
    <div key={o.id} data-drag-id={o.id} className={`np-opt ${drag.rowClass(o.id)}`}>
      <span className="np-grip" title="Drag to reorder" {...drag.gripProps(o.id)}>
        ⋮⋮
      </span>
      <button type="button" className="np-opt-main" onClick={(e) => setSub({ kind: "option", id: o.id, anchor: anchorOf(e.currentTarget) })}>
        <OptionPill option={o} status={type === "status"} />
        {p.config.defaultOptionId === o.id && <span className="np-tag-default">Default</span>}
        <span className="flex-1" />
        <span className="np-faint">›</span>
      </button>
    </div>
  );
  const addRow = (group?: StatusGroup) =>
    adding === (group ?? "any") ? (
      <div className="px-1 py-1">
        <input
          autoFocus
          className="n-input np-input"
          placeholder="Option name, then Enter"
          aria-label="New option"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOpt((e.target as HTMLInputElement).value, group);
              (e.target as HTMLInputElement).value = "";
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setAdding(null);
            }
          }}
          onBlur={(e) => {
            if (e.target.value.trim()) addOpt(e.target.value, group);
            setAdding(null);
          }}
        />
      </div>
    ) : null;

  function optionsEditor() {
    if (!hasOptions) return null;
    if (type === "status")
      return (
        <div className="np-section" ref={drag.containerRef}>
          {statusGroups(p).map((g) => (
            <div key={g.group}>
              <div className="flex items-center">
                <p className="n-menu-label flex-1">{GROUP_LABEL[g.group]}</p>
                <button type="button" className="np-tiny-btn" title={`Add an option to ${GROUP_LABEL[g.group]}`} aria-label={`Add an option to ${GROUP_LABEL[g.group]}`} onClick={() => setAdding(g.group)}>
                  +
                </button>
              </div>
              {g.options.map(optRow)}
              {addRow(g.group)}
            </div>
          ))}
        </div>
      );
    return (
      <div className="np-section" ref={drag.containerRef}>
        <div className="flex items-center">
          <p className="n-menu-label flex-1">Options</p>
          <button type="button" className="np-tiny-btn" title="Add an option" aria-label="Add an option" onClick={() => setAdding("any")}>
            +
          </button>
        </div>
        {options.map(optRow)}
        {addRow()}
        {!options.length && adding !== "any" && <Row icon="+" label="Add an option" onClick={() => setAdding("any")} />}
      </div>
    );
  }

  // ---- type-specific settings ----
  function settings() {
    switch (type) {
      case "number":
        return (
          <div className="np-section">
            <p className="n-menu-label">Number format</p>
            {NUMBER_FORMATS.map((f) => (
              <Row key={f.id} label={f.label} right={(p.config.numberFormat ?? "number") === f.id ? "✓" : <span className="np-faint">{f.hint}</span>} onClick={() => setConfig({ numberFormat: f.id })} />
            ))}
            {p.config.numberFormat === "bar" && (
              <div className="np-field">
                <span className="np-label">Bar max</span>
                <SaveInput
                  label="Bar max"
                  inputMode="decimal"
                  value={String(p.config.barMax ?? 100)}
                  onSave={(v) => {
                    const n = Number(v.replace(",", "."));
                    if (Number.isFinite(n) && n > 0) setConfig({ barMax: n });
                    else setErr("The bar max must be a number above 0.");
                  }}
                />
              </div>
            )}
          </div>
        );
      case "date":
        return (
          <div className="np-section">
            <Row label="Include time" right={<Switch on={!!p.config.includeTime} />} onClick={() => setConfig({ includeTime: !p.config.includeTime })} />
          </div>
        );
      case "relation": {
        const target = p.config.target ?? "notes";
        if (isBuiltinRelation(p))
          return (
            <div className="np-section">
              <Row icon="↗" label="Links to" right={TARGETS.find((t) => t.id === target)?.label ?? "Notes"} />
              {target === "notes" && <p className="np-hint">Two-way: it also shows on the other note.</p>}
            </div>
          );
        return (
          <div className="np-section">
            <p className="n-menu-label">Links to</p>
            {TARGETS.map((t) => (
              <Row key={t.id} icon={t.icon} label={t.label} right={target === t.id ? "✓" : ""} onClick={() => target !== t.id && setConfig({ target: t.id, twoWay: t.id === "notes" ? p.config.twoWay : false })} />
            ))}
            {target === "notes" && <Row label="Two-way (show on the other note too)" right={<Switch on={!!p.config.twoWay} />} onClick={() => setConfig({ twoWay: !p.config.twoWay })} />}
          </div>
        );
      }
      case "rollup": {
        const rels = properties.filter((x) => x.type === "relation");
        const chosen = resolvePropRef(p.config.relationPropId, properties);
        const calc = p.config.calc ?? "count";
        return (
          <>
            <div className="np-section">
              <p className="n-menu-label">Relation</p>
              {rels.map((r) => (
                <Row key={r.id} icon={TYPE_ICON.relation} label={r.name} right={chosen?.id === r.id ? "✓" : ""} onClick={() => setConfig({ relationPropId: r.builtin ? `@${r.key}` : r.id })} />
              ))}
              {!rels.length && <p className="np-hint">Add a Relation property first.</p>}
            </div>
            <div className="np-section">
              <p className="n-menu-label">Calculate</p>
              {CALCS.map((c) => (
                <Row key={c.id} label={c.label} right={calc === c.id ? "✓" : ""} onClick={() => setConfig({ calc: c.id })} />
              ))}
            </div>
          </>
        );
      }
      case "unique_id":
        return (
          <div className="np-section">
            <div className="np-field">
              <span className="np-label">Prefix</span>
              <SaveInput label="ID prefix" value={p.config.prefix ?? ""} placeholder="e.g. NOTE" onSave={(v) => setConfig({ prefix: v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12).toUpperCase() })} />
            </div>
            <p className="np-hint">Shows as {p.config.prefix ? `${p.config.prefix}-` : ""}12.</p>
          </div>
        );
      default:
        return null;
    }
  }

  const remove = async () => {
    if (!own || busy) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete the property “${p.name}”? Its values are hidden from every note.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await deleteProperty(p.id);
      if (!r.ok) throw r;
      onChanged(listRef.current.filter((x) => x.id !== p.id));
      onClose();
    } catch (e) {
      setErr(errorText(e, "Couldn't delete it."));
    } finally {
      setBusy(false);
    }
  };

  const subOption = sub?.kind === "option" ? options.find((o) => o.id === sub.id) ?? null : null;

  return (
    <>
      <Popover rect={rect} onClose={onClose} width={fitWidth(290)} className="np-menu" closeOnEsc={!sub}>
        {actions && <div className="np-section">{actions}</div>}
        <div className="np-section">
          <div className="flex items-center gap-2 px-1 pb-1">
            <span className="np-icon" title={TYPE_LABEL[type] ?? type}>
              {TYPE_ICON[type] ?? "•"}
            </span>
            <SaveInput label="Property name" value={p.name} onSave={(v) => v.trim() && void save({ name: v }, { ...cur.current, name: v.trim() })} />
          </div>
          {own ? (
            <Row icon="⇄" label="Type" right={<>{TYPE_ICON[type]} {TYPE_LABEL[type] ?? type} ›</>} onClick={(e) => setSub({ kind: "type", anchor: anchorOf(e.currentTarget) })} />
          ) : (
            <Row icon="⇄" label="Type" right={<>{TYPE_ICON[type]} {TYPE_LABEL[type] ?? type}</>} />
          )}
        </div>
        {optionsEditor()}
        {settings()}
        <div className="np-section">
          <Row icon="👁" label="Hide in page" right={<Switch on={p.hidden} />} onClick={() => void save({ hidden: !p.hidden }, { ...cur.current, hidden: !p.hidden })} />
          {own ? (
            <Row icon="🗑" label={busy ? "Deleting…" : "Delete property"} danger onClick={() => void remove()} disabled={busy} />
          ) : (
            <p className="np-hint">Built-in: can be hidden, not deleted.</p>
          )}
        </div>
        {err && <p className="np-hint np-err">{err}</p>}
      </Popover>
      {sub?.kind === "type" && (
        <TypeMenu
          anchor={sub.anchor}
          current={type}
          onClose={() => setSub(null)}
          onPick={(t) => {
            setSub(null);
            if (t === type) return;
            void save({ type: t }, { ...cur.current, type: t });
          }}
        />
      )}
      {subOption && sub?.kind === "option" && (
        <OptionEditor
          anchor={sub.anchor}
          option={subOption}
          status={type === "status"}
          isDefault={p.config.defaultOptionId === subOption.id}
          index={options.findIndex((o) => o.id === subOption.id)}
          count={options.length}
          onClose={() => setSub(null)}
          onChange={(o) => setOptions(options.map((x) => (x.id === o.id ? o : x)))}
          onMove={(dir) => {
            const i = options.findIndex((o) => o.id === subOption.id);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= options.length) return;
            const next = [...options];
            [next[i], next[j]] = [next[j], next[i]];
            setOptions(next);
          }}
          onDefault={() => setConfig({ defaultOptionId: subOption.id })}
          onDelete={() => {
            if (p.config.defaultOptionId === subOption.id) {
              setErr("That's the default option: pick another default first.");
              return;
            }
            setSub(null);
            setOptions(options.filter((o) => o.id !== subOption.id));
          }}
        />
      )}
    </>
  );
}

function TypeMenu({ anchor, current, onClose, onPick }: { anchor: Anchor; current: PropType; onClose: () => void; onPick: (t: PropType) => void }) {
  const [index, setIndex] = useListKeys(CREATABLE_TYPES.length, (i) => onPick(CREATABLE_TYPES[i]));
  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(230)} placement="right" className="np-menu">
      <p className="n-menu-label">Type</p>
      {CREATABLE_TYPES.map((t, i) => (
        <button key={t} type="button" className={`np-row-btn ${index === i ? "is-active" : ""}`} onMouseMove={() => setIndex(i)} onClick={() => onPick(t)}>
          <span className="np-icon">{TYPE_ICON[t]}</span>
          <span className="flex-1">{TYPE_LABEL[t]}</span>
          {t === current && <span className="np-right">✓</span>}
        </button>
      ))}
    </Popover>
  );
}

function OptionEditor({
  anchor,
  option,
  status,
  isDefault,
  index,
  count,
  onClose,
  onChange,
  onMove,
  onDefault,
  onDelete,
}: {
  anchor: Anchor;
  option: SelectOption;
  status: boolean;
  isDefault: boolean;
  index: number;
  count: number;
  onClose: () => void;
  onChange: (o: SelectOption) => void;
  onMove: (dir: -1 | 1) => void;
  onDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(230)} placement="right" className="np-menu">
      <div className="px-1 pb-1">
        <SaveInput label="Option name" value={option.name} autoFocus onSave={(v) => v.trim() && onChange({ ...option, name: v.trim() })} />
      </div>
      <div className="np-section">
        <Row icon="🗑" label={isDefault ? "Default: can't delete" : "Delete"} danger={!isDefault} disabled={isDefault} onClick={onDelete} />
        {status && <Row icon="★" label="Set as default" right={isDefault ? "✓" : ""} onClick={() => !isDefault && onDefault()} />}
        <Row icon="↑" label="Move up" onClick={() => onMove(-1)} disabled={index <= 0} />
        <Row icon="↓" label="Move down" onClick={() => onMove(1)} disabled={index < 0 || index >= count - 1} />
      </div>
      {status && (
        <div className="np-section">
          <p className="n-menu-label">Group</p>
          {(["todo", "in_progress", "done"] as StatusGroup[]).map((g) => (
            <Row key={g} label={GROUP_LABEL[g]} right={(option.group ?? "todo") === g ? "✓" : ""} onClick={() => onChange({ ...option, group: g })} />
          ))}
        </div>
      )}
      <div className="np-section np-color-grid">
        <p className="n-menu-label">Colors</p>
        {COLOR_NAMES.map((c) => (
          <Row key={c} icon={<ColorDot color={c} />} label={COLOR_LABEL[c]} right={option.color === c ? "✓" : ""} onClick={() => onChange({ ...option, color: c })} />
        ))}
      </div>
    </Popover>
  );
}

// ---- + Add a property ------------------------------------------------------------------------------

export function AddPropertyMenu({ rect, properties, onClose, onCreated }: { rect: Rect; properties: NoteProperty[]; onClose: () => void; onCreated: (prop: NoteProperty, properties: NoteProperty[]) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async (t: PropType) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      let base = name.trim() || TYPE_LABEL[t];
      // Avoid two properties with the same name ("Number", "Number 2"…)
      const taken = new Set(properties.map((p) => p.name.toLowerCase()));
      if (taken.has(base.toLowerCase())) {
        let i = 2;
        while (taken.has(`${base} ${i}`.toLowerCase())) i++;
        base = `${base} ${i}`;
      }
      const r = await createProperty(base, t);
      if (!r.ok) throw r;
      onCreated(r.property, [...properties.filter((p) => p.id !== r.property.id), r.property]);
      onClose();
    } catch (e) {
      setErr(errorText(e, "Couldn't create it."));
    } finally {
      setBusy(false);
    }
  };
  const [index, setIndex] = useListKeys(CREATABLE_TYPES.length, (i) => void create(CREATABLE_TYPES[i]));
  return (
    <Popover rect={rect} onClose={onClose} width={fitWidth(280)} className="np-menu">
      <div className="px-1 pb-1">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Property name" aria-label="Property name" className="n-input np-input" />
      </div>
      <p className="n-menu-label">{busy ? "Creating…" : "Type"}</p>
      {CREATABLE_TYPES.map((t, i) => (
        <button key={t} type="button" disabled={busy} className={`np-row-btn ${index === i ? "is-active" : ""}`} onMouseMove={() => setIndex(i)} onClick={() => void create(t)}>
          <span className="np-icon">{TYPE_ICON[t]}</span>
          <span className="flex-1">{TYPE_LABEL[t]}</span>
        </button>
      ))}
      {err && <p className="np-hint np-err">{err}</p>}
    </Popover>
  );
}
