"use client";
// "✎ Edit" button in the bar of selected notes: set / clear a property on all of them, add or remove
// tags / options / links without erasing what each note already has, duplicate, or move to the trash.
// Pickers are the same ones the cells use; nothing is saved until you press Apply. See db-bulk.tsx.
import { useState } from "react";
import { addOption } from "@/app/notes-db-actions";
import { MenuItem, Popover } from "@/components/editor/ui";
import { useBulk } from "@/components/notes-db/db-bulk";
import { rectOf, useDb, type Rect } from "@/components/notes-db/db-shared";
import { DatePicker, OptionPicker, RelationPicker, TagPicker } from "@/components/notes-db/prop-pickers";
import { OptionPill, anchorOf, errorText, okColor, toast, usePropEnv, type Anchor } from "@/components/notes-db/prop-ui";
import { canBulkEdit, isMulti, type MultiMode } from "@/lib/notes-db/fill";
import { formatDate } from "@/lib/notes-db/values";
import { TYPE_ICON, TYPE_LABEL, type DateValue, type NoteProperty, type RelatedItem, type RelationTarget } from "@/lib/notes-db/types";

function relationTarget(prop: NoteProperty): RelationTarget {
  if (prop.builtin && prop.key === "tasks") return "tasks";
  if (prop.builtin && prop.key === "events") return "events";
  const t = prop.config.target;
  return t === "tasks" || t === "events" ? t : "notes";
}

const MODES: { id: MultiMode; label: string; hint: string }[] = [
  { id: "add", label: "Add", hint: "keeps what each note already has" },
  { id: "remove", label: "Remove", hint: "takes these away from every note" },
  { id: "replace", label: "Replace", hint: "every note ends up with exactly these" },
];

export default function BulkEdit({ ids }: { ids: string[] }) {
  const bulk = useBulk();
  const [menu, setMenu] = useState<Rect | null>(null);
  const [dialog, setDialog] = useState(false);
  const n = ids.length;
  const close = () => setMenu(null);
  return (
    <>
      <button type="button" onClick={(e) => setMenu(rectOf(e.currentTarget))} className="rounded-lg border border-line px-2.5 py-1 text-sm hover:bg-black/5" aria-haspopup="menu">
        ✎ Edit<span className="hidden sm:inline"> {n} {n === 1 ? "note" : "notes"}</span> ▾
      </button>
      {menu && (
        <Popover rect={menu} onClose={close} width={230} className="n-menu">
          <div className="p-1">
            <MenuItem icon="✎" label="Edit property…" hint="Set, clear, add or remove" onClick={() => (close(), setDialog(true))} />
            <MenuItem icon="⧉" label="Duplicate" onClick={() => (close(), bulk.duplicate(ids))} />
            <MenuItem icon="🗑" label="Move to trash" danger onClick={() => (close(), bulk.trash(ids))} />
          </div>
        </Popover>
      )}
      {dialog && <EditDialog ids={ids} onClose={() => setDialog(false)} />}
    </>
  );
}

function EditDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const env = useDb();
  const bulk = useBulk();
  const pe = usePropEnv();
  const editable = env.properties.filter(canBulkEdit);
  const [propId, setPropId] = useState(editable[0]?.id ?? "");
  const prop = editable.find((p) => p.id === propId) ?? editable[0];

  // The value you are building (only the one that matches the property's type is used)
  const [mode, setMode] = useState<MultiMode>("add");
  const [text, setText] = useState("");
  const [check, setCheck] = useState(true);
  const [optIds, setOptIds] = useState<string[]>([]);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [date, setDate] = useState<DateValue | null>(null);
  const [items, setItems] = useState<RelatedItem[]>([]);
  const [picker, setPicker] = useState<Anchor | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!prop) return null;
  const multi = isMulti(prop);
  const type = prop.type;
  const reset = (id: string) => {
    setPropId(id);
    setText("");
    setCheck(true);
    setOptIds([]);
    setTagNames([]);
    setDate(null);
    setItems([]);
    setPicker(null);
    setErr(null);
    setMode("add");
  };

  // What gets written, in the form setNoteValue takes. undefined = not valid yet.
  const incoming = (): { value: unknown } | { error: string } => {
    switch (type) {
      case "text":
        return { value: text.trim() ? text.slice(0, 2000) : null };
      case "phone":
        return { value: text.trim() || null };
      case "url": {
        const s = text.trim();
        return { value: !s ? null : /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}` };
      }
      case "email": {
        const s = text.trim();
        return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s || null } : { error: "That isn't a valid email." };
      }
      case "number": {
        const s = text.replace(/[$%\s]/g, "");
        if (!s) return { value: null };
        const num = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
        return Number.isFinite(num) ? { value: num } : { error: "That isn't a number." };
      }
      case "checkbox":
        return { value: check };
      case "select":
      case "status":
        return { value: optIds[0] ?? null };
      case "multi_select":
        return { value: optIds };
      case "tags":
        return { value: tagNames };
      case "date":
        return { value: date };
      case "relation":
        return { value: items.map(({ type: t, id }) => ({ type: t, id })) };
      default:
        return { error: "That property can't be edited here." };
    }
  };
  const emptyList = multi && mode !== "replace" && ((type === "multi_select" && !optIds.length) || (type === "tags" && !tagNames.length) || (type === "relation" && !items.length));

  const apply = () => {
    const v = incoming();
    if ("error" in v) return setErr(v.error);
    bulk.setValue(prop, ids, v.value, multi ? mode : "replace", { items, tags: pe.tags });
    onClose();
  };

  const createOption = async (name: string) => {
    try {
      const r = await addOption(prop.id, name, undefined, type === "status" ? "todo" : undefined);
      if (!r.ok) return toast(errorText(r));
      env.onProps(env.properties.map((p) => (p.id === r.property.id ? r.property : p)));
      setOptIds((cur) => (type === "multi_select" ? [...cur, r.option.id] : [r.option.id]));
    } catch (e) {
      toast(errorText(e));
    }
  };

  const opts = prop.config.options ?? [];
  const chosen = optIds.map((id) => opts.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
  const pickBtn = (label: string) => (
    <button type="button" onClick={(e) => setPicker(anchorOf(e.currentTarget))} className="rounded-lg border border-line px-2.5 py-1 text-sm hover:bg-black/5">
      {label}
    </button>
  );
  const none = <span className="text-sm text-faint">{multi && mode !== "replace" ? "Nothing chosen yet" : "Empty: clears it on every note"}</span>;

  const field = () => {
    switch (type) {
      case "text":
      case "number":
      case "url":
      case "email":
      case "phone":
        return (
          <input
            autoFocus
            value={text}
            onChange={(e) => (setText(e.target.value), setErr(null))}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            inputMode={type === "number" ? "decimal" : undefined}
            placeholder="Leave empty to clear it"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        );
      case "checkbox":
        return (
          <div className="flex gap-4 text-sm">
            {[true, false].map((v) => (
              <label key={String(v)} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="bulk-check" checked={check === v} onChange={() => setCheck(v)} className="accent-accent" />
                {v ? "Checked" : "Unchecked"}
              </label>
            ))}
          </div>
        );
      case "select":
      case "status":
      case "multi_select":
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {chosen.length ? chosen.map((o) => <OptionPill key={o.id} option={o} status={type === "status"} onRemove={() => setOptIds((c) => c.filter((x) => x !== o.id))} />) : none}
            {pickBtn(chosen.length ? "Change…" : "Choose…")}
          </div>
        );
      case "tags":
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {tagNames.length ? tagNames.map((t) => <OptionPill key={t} option={{ name: `#${t}`, color: okColor(pe.tags.find((k) => k.name.toLowerCase() === t.toLowerCase())?.color) }} onRemove={() => setTagNames((c) => c.filter((x) => x !== t))} />) : none}
            {pickBtn(tagNames.length ? "Change…" : "Choose…")}
          </div>
        );
      case "date":
        return (
          <div className="flex flex-wrap items-center gap-2">
            {date ? <span className="text-sm">{formatDate(date, !!prop.config.includeTime)}</span> : none}
            {pickBtn(date ? "Change…" : "Pick a date…")}
            {date && (
              <button type="button" onClick={() => setDate(null)} className="text-xs text-muted underline-offset-2 hover:underline">
                Clear
              </button>
            )}
          </div>
        );
      case "relation":
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {items.length ? items.map((it) => <span key={`${it.type}:${it.id}`} className="np-chip"><span className="np-chip-title">{it.title || "Untitled"}</span></span>) : none}
            {pickBtn(items.length ? "Change…" : "Choose…")}
          </div>
        );
      default:
        return null;
    }
  };

  const n = ids.length;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={`Edit ${n} notes`} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && !picker && onClose()}>
        <h2 className="text-base font-semibold">
          Edit {n} {n === 1 ? "note" : "notes"}
        </h2>
        <label className="mt-3 block text-xs font-medium text-muted" htmlFor="bulk-prop">
          Property
        </label>
        <select id="bulk-prop" value={prop.id} onChange={(e) => reset(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm">
          {editable.map((p) => (
            <option key={p.id} value={p.id}>
              {TYPE_ICON[p.type]} {p.name} · {TYPE_LABEL[p.type]}
            </option>
          ))}
        </select>

        {multi && (
          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-muted">What to do</legend>
            <div className="mt-1 grid gap-1">
              {MODES.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-baseline gap-2 text-sm">
                  <input type="radio" name="bulk-mode" checked={mode === m.id} onChange={() => setMode(m.id)} className="accent-accent" />
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-faint">{m.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <p className="mt-3 text-xs font-medium text-muted">{multi ? (mode === "remove" ? "Remove these" : mode === "add" ? "Add these" : "New value") : "New value"}</p>
        <div className="mt-1">{field()}</div>
        {err && <p className="mt-2 text-xs text-[#d44]">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-black/5">
            Cancel
          </button>
          <button type="button" disabled={emptyList} onClick={apply} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Apply to {n} {n === 1 ? "note" : "notes"}
          </button>
        </div>
      </div>

      {picker && (type === "select" || type === "status" || type === "multi_select") && (
        <OptionPicker prop={prop} selected={optIds} multi={type === "multi_select"} anchor={picker} onClose={() => setPicker(null)} onChange={setOptIds} onCreate={createOption} />
      )}
      {picker && type === "tags" && <TagPicker names={tagNames} known={pe.tags} anchor={picker} onClose={() => setPicker(null)} onChange={setTagNames} />}
      {picker && type === "date" && <DatePicker value={date} includeTime={!!prop.config.includeTime} timezone={env.timezone} anchor={picker} onClose={() => setPicker(null)} onSave={setDate} />}
      {picker && type === "relation" && <RelationPicker target={relationTarget(prop)} items={items} noteId="" anchor={picker} onClose={() => setPicker(null)} onChange={setItems} />}
    </div>
  );
}
