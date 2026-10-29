"use client";
// Filters of the notes database: the quick chips ("Status: Inbox ▾", all AND), the property picker of
// "+ Filter", the value editors of every type, and "Advanced filter" (rules with AND / OR and groups).
import { useEffect, useMemo, useRef, useState } from "react";
import { MenuItem, MenuLabel, Popover, useListKeys } from "@/components/editor/ui";
import { OptionPill } from "@/components/notes-db/prop-ui";
import { fit, rectOf, useDb, type Rect } from "@/components/notes-db/db-shared";
import { KIND_OPTIONS, OP_LABEL, RELATIVE_DAYS, STATUS_GROUP_LABEL, WITHIN_OPTIONS, fold, needsValue, newRule, opLabel, operatorsForProp, ruleIsActive, valueKind } from "@/lib/notes-db/query";
import { formatDate } from "@/lib/notes-db/values";
import { TYPE_ICON, newId, statusGroups, type FilterGroup, type FilterOp, type FilterRule, type NoteProperty } from "@/lib/notes-db/types";
import type { ColorName } from "@/lib/editor/colors";

type P = NoteProperty | "title";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const propName = (p: P) => (p === "title" ? "Name" : p.name || "Untitled");
export const propIcon = (p: P) => (p === "title" ? "Aa" : TYPE_ICON[p.type] ?? "≡");
export function findProp(id: string, properties: NoteProperty[]): P | null {
  return id === "title" ? "title" : properties.find((p) => p.id === id) ?? null;
}

const toList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : typeof v === "string" && v !== "" ? [v] : []);
const isSingle = (p: P, op: FilterOp) => {
  const k = valueKind(p);
  return (k === "select" || k === "status" || k === "kind") && (op === "is" || op === "is_not");
};

type Item = { id: string; name: string; color?: ColorName; group?: boolean; status?: boolean };

/** The choices of an option-like property (for the pickers). */
function useItems(p: P): Item[] {
  const env = useDb();
  return useMemo(() => {
    if (p === "title") return [];
    if (p.type === "kind") return KIND_OPTIONS.map((k) => ({ id: k.id, name: k.label }));
    if (p.type === "tags") return env.tagNames.map((t) => ({ id: t, name: `#${t}` }));
    if (p.type === "relation") return env.relationItems(p.id).map((r) => ({ id: r.id, name: r.title || "Untitled" }));
    if (p.type === "status") {
      const groups = statusGroups(p);
      return [
        ...groups.map((g) => ({ id: `group:${g.group}`, name: `${STATUS_GROUP_LABEL[g.group]} (group)`, group: true })),
        ...groups.flatMap((g) => g.options.map((o) => ({ id: o.id, name: o.name, color: o.color, status: true }))),
      ];
    }
    return (p.config.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color }));
  }, [p, env]);
}

function dayLabel(v: unknown) {
  if (typeof v !== "string") return "";
  const rel = RELATIVE_DAYS.find((d) => d.id === v);
  if (rel) return rel.label;
  return DAY_RE.test(v) ? formatDate({ start: v }) : "";
}

/** Just the value of a rule, as text ("Idea, Plan", "Today", "“budget”"). */
export function useValueSummary(rule: FilterRule, p: P | null): string {
  const items = useItems(p ?? "title");
  if (!p || !needsValue(rule.op)) return "";
  const k = valueKind(p);
  if (k === "text" || k === "files") return typeof rule.value === "string" && rule.value.trim() ? `“${rule.value.trim()}”` : "";
  if (k === "number") return rule.value === undefined || rule.value === null ? "" : String(rule.value);
  if (k === "date") return rule.op === "within" ? WITHIN_OPTIONS.find((w) => w.id === rule.value)?.label ?? "" : dayLabel(rule.value);
  const names = toList(rule.value).map((id) => items.find((i) => i.id === id)?.name ?? (p !== "title" && p.type === "tags" ? `#${id}` : "Unknown"));
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

// ---- Value editors -------------------------------------------------------------------------------

function OptionList({ items, selected, single, onChange, empty }: { items: Item[]; selected: string[]; single: boolean; onChange: (ids: string[]) => void; empty: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = fold(q.trim());
    return t ? items.filter((i) => fold(i.name).includes(t)) : items;
  }, [items, q]);
  const toggle = (id: string) => {
    const on = selected.includes(id);
    if (single) onChange(on ? [] : [id]);
    else onChange(on ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  const [index, setIndex] = useListKeys(shown.length, (i) => shown[i] && toggle(shown[i].id));
  return (
    <div>
      {items.length > 7 && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="n-input mb-1 w-full" />}
      <div className="db-opt-list" role="listbox" aria-multiselectable={!single}>
        {!shown.length && <p className="db-hint">{items.length ? "No matches" : empty}</p>}
        {shown.map((it, i) => {
          const on = selected.includes(it.id);
          return (
            <MenuItem
              key={it.id}
              active={i === index}
              onHover={() => setIndex(i)}
              onClick={() => toggle(it.id)}
              icon={<span className={`db-check ${on ? "is-on" : ""} ${single ? "is-radio" : ""}`} aria-hidden>{on ? "✓" : ""}</span>}
              label={it.color ? <OptionPill option={{ name: it.name, color: it.color }} status={it.status} small /> : <span className={it.group ? "font-medium" : ""}>{it.name}</span>}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayPicker({ value, onChange }: { value: unknown; onChange: (v: string | undefined) => void }) {
  const exact = typeof value === "string" && DAY_RE.test(value) ? value : "";
  return (
    <div className="space-y-2 p-1">
      <div className="flex flex-wrap gap-1">
        {RELATIVE_DAYS.map((d) => (
          <button key={d.id} type="button" className={`db-seg ${value === d.id ? "is-on" : ""}`} onClick={() => onChange(value === d.id ? undefined : d.id)}>
            {d.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        Date
        <input type="date" value={exact} onChange={(e) => onChange(e.target.value || undefined)} className="n-input flex-1" />
      </label>
    </div>
  );
}

/** The value part of a rule, full size (chip popover, advanced value popover). */
export function ValueEditor({ rule, prop, onChange }: { rule: FilterRule; prop: P; onChange: (value: unknown) => void }) {
  const items = useItems(prop);
  const k = valueKind(prop);
  if (!needsValue(rule.op)) return null;
  if (k === "text" || k === "files")
    return <input autoFocus value={typeof rule.value === "string" ? rule.value : ""} onChange={(e) => onChange(e.target.value)} placeholder="Type a value…" className="n-input w-full" />;
  if (k === "number")
    return <input autoFocus inputMode="decimal" value={rule.value === undefined || rule.value === null ? "" : String(rule.value)} onChange={(e) => onChange(e.target.value.trim() === "" ? undefined : e.target.value)} placeholder="Type a number…" className="n-input w-full" />;
  if (k === "date") {
    if (rule.op === "within")
      return <OptionList items={WITHIN_OPTIONS.map((w) => ({ id: w.id, name: w.label }))} selected={toList(rule.value)} single onChange={(ids) => onChange(ids[0])} empty="" />;
    return <DayPicker value={rule.value} onChange={onChange} />;
  }
  const single = isSingle(prop, rule.op);
  const empty = prop !== "title" && prop.type === "tags" ? "No tags yet" : prop !== "title" && prop.type === "relation" ? "No linked items yet" : "No options yet";
  return <OptionList items={items} selected={toList(rule.value)} single={single} onChange={(ids) => onChange(ids.length ? ids : undefined)} empty={empty} />;
}

/** The rule with another operator (keeps the value when it still makes sense). */
export function withOp(rule: FilterRule, prop: P, op: FilterOp): FilterRule {
  const k = valueKind(prop);
  let value = rule.value;
  if (!needsValue(op)) value = undefined;
  else if (k === "date" && (op === "within") !== (rule.op === "within")) value = undefined;
  else if (isSingle(prop, op)) value = toList(value).slice(0, 1);
  const next: FilterRule = { ...rule, op };
  if (value === undefined || (Array.isArray(value) && !value.length)) delete next.value;
  else next.value = value;
  return next;
}

export function OpSelect({ prop, op, onChange, className = "" }: { prop: P; op: FilterOp; onChange: (op: FilterOp) => void; className?: string }) {
  const k = valueKind(prop);
  const ops = operatorsForProp(prop);
  return (
    <select value={ops.includes(op) ? op : ops[0]} onChange={(e) => onChange(e.target.value as FilterOp)} className={`n-input db-select ${className}`} aria-label="Condition">
      {ops.map((o) => (
        <option key={o} value={o}>
          {opLabel(k, o) || OP_LABEL[o]}
        </option>
      ))}
    </select>
  );
}

// ---- Property picker ("+ Filter", "+ Add sort") -------------------------------------------------------

export function PropertyPicker({ rect, onClose, onPick, title = "Filter by", exclude = [] }: { rect: Rect; onClose: () => void; onPick: (id: string) => void; title?: string; exclude?: string[] }) {
  const { properties } = useDb();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = fold(q.trim());
    const all: P[] = ["title", ...[...properties].sort((a, b) => a.position - b.position)];
    return all.filter((p) => !exclude.includes(p === "title" ? "title" : p.id) && (!t || fold(propName(p)).includes(t)));
  }, [properties, q, exclude]);
  const [index, setIndex] = useListKeys(list.length, (i) => list[i] && onPick(list[i] === "title" ? "title" : (list[i] as NoteProperty).id));
  return (
    <Popover rect={rect} onClose={onClose} width={fit(260)} className="n-menu">
      <div className="p-1">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${title}…`} className="n-input mb-1 w-full" />
        <div className="max-h-[320px] overflow-y-auto">
          {!list.length && <p className="db-hint">No properties</p>}
          {list.map((p, i) => (
            <MenuItem key={p === "title" ? "title" : p.id} icon={<span className="n-type-icon">{propIcon(p)}</span>} label={propName(p)} active={i === index} onHover={() => setIndex(i)} onClick={() => onPick(p === "title" ? "title" : p.id)} />
          ))}
        </div>
      </div>
    </Popover>
  );
}

// ---- Quick chips -------------------------------------------------------------------------------------

export function FilterChip({ rule, open, onOpen, onClose, onChange, onDelete }: { rule: FilterRule; open: boolean; onOpen: () => void; onClose: () => void; onChange: (r: FilterRule) => void; onDelete: () => void }) {
  const { properties } = useDb();
  const prop = findProp(rule.prop, properties);
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (open) setRect(rectOf(btn.current));
    else setRect(null);
  }, [open]);
  const summary = useValueSummary(rule, prop);
  if (!prop) return null;
  const k = valueKind(prop);
  const active = ruleIsActive(rule, properties);
  const neg = ["is_not", "none_of", "not_contains"].includes(rule.op);
  const text = !active ? "" : !needsValue(rule.op) ? opLabel(k, rule.op) : k === "number" ? `${OP_LABEL[rule.op]} ${summary}` : k === "date" && rule.op !== "is" && rule.op !== "within" ? `${opLabel(k, rule.op).replace(/^is /, "")} ${summary}` : k === "multi" && rule.op === "all_of" ? `all of ${summary}` : k === "text" && rule.op !== "contains" ? `${opLabel(k, rule.op)} ${summary}` : `${neg ? "not " : ""}${summary}`;
  return (
    <>
      <button ref={btn} type="button" onClick={() => (open ? onClose() : onOpen())} className={`db-chip ${active ? "is-active" : ""}`} aria-expanded={open}>
        <span className="db-chip-icon" aria-hidden>{propIcon(prop)}</span>
        <span className="truncate">
          {propName(prop)}
          {active && <span className="font-normal">: {text}</span>}
        </span>
        <span aria-hidden className="db-caret">▾</span>
      </button>
      {open && rect && (
        <Popover rect={rect} onClose={onClose} width={fit(300)} className="n-menu">
          <div className="space-y-1.5 p-2">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-xs font-medium text-muted">{propName(prop)}</span>
              <OpSelect prop={prop} op={rule.op} onChange={(op) => onChange(withOp(rule, prop, op))} className="ml-auto max-w-[60%]" />
              <button type="button" className="db-icon-btn" title="Delete filter" aria-label="Delete filter" onClick={onDelete}>
                🗑
              </button>
            </div>
            <ValueEditor rule={rule} prop={prop} onChange={(value) => onChange(value === undefined ? withoutValue(rule) : { ...rule, value })} />
          </div>
        </Popover>
      )}
    </>
  );
}

const withoutValue = (r: FilterRule): FilterRule => {
  const n = { ...r };
  delete n.value;
  return n;
};

// ---- Advanced filter -------------------------------------------------------------------------------------

function ValueButton({ rule, prop, onChange }: { rule: FilterRule; prop: P; onChange: (r: FilterRule) => void }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const summary = useValueSummary(rule, prop);
  const k = valueKind(prop);
  if (!needsValue(rule.op)) return null;
  if (k === "text" || k === "files" || k === "number")
    return (
      <input
        inputMode={k === "number" ? "decimal" : undefined}
        value={rule.value === undefined || rule.value === null ? "" : String(rule.value)}
        onChange={(e) => onChange(e.target.value === "" ? withoutValue(rule) : { ...rule, value: e.target.value })}
        placeholder={k === "number" ? "Number" : "Value"}
        className="n-input db-adv-input"
      />
    );
  return (
    <>
      <button type="button" className="n-input db-adv-input db-adv-valuebtn" onClick={(e) => setRect(rectOf(e.currentTarget))}>
        <span className={`truncate ${summary ? "" : "text-faint"}`}>{summary || "Select…"}</span>
        <span aria-hidden className="db-caret">▾</span>
      </button>
      {rect && (
        <Popover rect={rect} onClose={() => setRect(null)} width={fit(280)} className="n-menu">
          <div className="p-1.5">
            <ValueEditor rule={rule} prop={prop} onChange={(value) => onChange(value === undefined ? withoutValue(rule) : { ...rule, value })} />
          </div>
        </Popover>
      )}
    </>
  );
}

function RuleRow({ rule, onChange }: { rule: FilterRule; onChange: (r: FilterRule) => void }) {
  const { properties } = useDb();
  const prop = findProp(rule.prop, properties) ?? "title";
  const sorted = useMemo(() => [...properties].sort((a, b) => a.position - b.position), [properties]);
  return (
    <div className="db-adv-rule">
      <select
        value={prop === "title" ? "title" : prop.id}
        onChange={(e) => {
          const p = findProp(e.target.value, properties);
          if (p) onChange({ ...newRule(p), id: rule.id });
        }}
        className="n-input db-select db-adv-prop"
        aria-label="Property"
      >
        <option value="title">Name</option>
        {sorted.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name || "Untitled"}
          </option>
        ))}
      </select>
      <OpSelect prop={prop} op={rule.op} onChange={(op) => onChange(withOp(rule, prop, op))} className="db-adv-op" />
      <ValueButton rule={rule} prop={prop} onChange={onChange} />
    </div>
  );
}

const emptyGroup = (): FilterGroup => ({ kind: "group", id: newId("g"), join: "and", items: [] });

function GroupEditor({ group, depth, onChange }: { group: FilterGroup; depth: number; onChange: (g: FilterGroup) => void }) {
  const setItem = (id: string, it: FilterRule | FilterGroup | null) => onChange({ ...group, items: it ? group.items.map((x) => (x.id === id ? it : x)) : group.items.filter((x) => x.id !== id) });
  const joinWord = group.join === "and" ? "And" : "Or";
  return (
    <div className={depth ? "db-adv-group" : "db-adv-root"}>
      {group.items.map((it, i) => (
        <div key={it.id} className="db-adv-row">
          <div className="db-adv-join">
            {i === 0 ? (
              <span>Where</span>
            ) : i === 1 ? (
              <select value={group.join} onChange={(e) => onChange({ ...group, join: e.target.value === "or" ? "or" : "and" })} className="n-input db-select" aria-label="Join rules with">
                <option value="and">And</option>
                <option value="or">Or</option>
              </select>
            ) : (
              <span>{joinWord}</span>
            )}
          </div>
          <div className="db-adv-body">{it.kind === "rule" ? <RuleRow rule={it} onChange={(r) => setItem(it.id, r)} /> : <GroupEditor group={it} depth={depth + 1} onChange={(g) => setItem(it.id, g)} />}</div>
          <button type="button" className="db-icon-btn" title={it.kind === "group" ? "Delete group" : "Delete rule"} aria-label="Delete" onClick={() => setItem(it.id, null)}>
            ✕
          </button>
        </div>
      ))}
      {depth > 0 && (
        <div className="db-adv-actions">
          <button type="button" className="db-link" onClick={() => onChange({ ...group, items: [...group.items, newRule("title")] })}>
            + Add rule
          </button>
          {depth < 2 && (
            <button type="button" className="db-link" onClick={() => onChange({ ...group, items: [...group.items, { ...emptyGroup(), items: [newRule("title")] }] })}>
              + Add group
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AdvancedFilter({ rect, value, onChange, onClose }: { rect: Rect; value: FilterGroup | null; onChange: (g: FilterGroup | null) => void; onClose: () => void }) {
  const root = value ?? { kind: "group" as const, id: "root", join: "and" as const, items: [] };
  const set = (g: FilterGroup) => onChange(g.items.length ? g : null);
  return (
    <Popover rect={rect} onClose={onClose} width={fit(640)} className="n-menu">
      <div className="p-2">
        <MenuLabel>Advanced filter</MenuLabel>
        {!root.items.length && <p className="db-hint px-2.5">Rules here can be joined with And / Or, and grouped. They work together with the chips.</p>}
        <GroupEditor group={root} depth={0} onChange={set} />
        <div className="db-adv-actions mt-1 border-t pt-2" style={{ borderColor: "var(--n-divider)" }}>
          <button type="button" className="db-link" onClick={() => set({ ...root, items: [...root.items, newRule("title")] })}>
            + Add filter rule
          </button>
          <button type="button" className="db-link" onClick={() => set({ ...root, items: [...root.items, { ...emptyGroup(), items: [newRule("title")] }] })}>
            + Add filter group
          </button>
          {root.items.length > 0 && (
            <button type="button" className="db-link is-danger ml-auto" onClick={() => onChange(null)}>
              Delete all
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}
