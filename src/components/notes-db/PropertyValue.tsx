"use client";
// OWNED BY: property editing UI. Shows and edits one property value of one note, for every type.
// variant: "cell" (table cell, one line) · "page" (the note page, under the title) · "card" (list / gallery / board, compact, usually read-only)
//
// Saving is optimistic: onChange gets the updated note right away, then the server action runs; on an
// error the old note comes back through onChange and a small message shows at the bottom.
//
// Also exported here (for the database views):
// - OptionPill({ option, status?, small?, onRemove? }): a colored select / multi-select / status pill.
// - PropEnvContext: optional provider with { timezone, tags } (timezone for "Created" / "Last edited" /
//   "Today"; tags = all known tags, suggested in the Tags picker). Without it: the browser's timezone.
//   e.g. <PropEnvContext.Provider value={{ timezone: data.timezone, tags }}>…</PropEnvContext.Provider>
// - "cell" fills its table cell (it has its own 6px 8px padding, min-height 33px); give the cell padding 0.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addOption, setNoteValue } from "@/app/notes-db-actions";
import { summarizeNote } from "@/app/notes-ai-actions";
import { isBuiltinRelation } from "@/lib/notes-db/builtins";
import { displayText, formatDate, formatNumber, rawValue } from "@/lib/notes-db/values";
import { READONLY_TYPES, optionById, type DateValue, type DbNote, type FileValue, type NoteProperty, type PropValue, type RelatedItem, type RelationTarget, type SelectOption } from "@/lib/notes-db/types";
import { DatePicker, FilesEditor, OptionPicker, RelationPicker, TagPicker, TextPopover, TextEditor, relatedIcon } from "./prop-pickers";
import { OptionPill, anchorOf, errorText, okColor, relationHref, toast, usePropEnv, type Anchor } from "./prop-ui";
import NoteLinkButton from "./NoteLinkMenu";
import "./properties.css";
import { showAiUsage } from "@/lib/ai-usage-client";

export { OptionPill, PropEnvContext, type PropEnv } from "./prop-ui";

export type PropertyValueProps = {
  note: DbNote;
  prop: NoteProperty;
  properties: NoteProperty[];
  variant: "cell" | "page" | "card";
  readOnly?: boolean;
  /** Called right away with the note as it looks after the change (optimistic); the save runs inside. */
  onChange?: (note: DbNote) => void;
  /** Properties changed (e.g. a new select option was created while typing). */
  onPropertiesChange?: (properties: NoteProperty[]) => void;
};

type TextKind = "text" | "number" | "url" | "email" | "phone";
const TEXT_KINDS: string[] = ["text", "number", "url", "email", "phone"];
type Result = { ok?: boolean; error?: string; templateApplied?: boolean };

const asString = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asDate = (v: unknown): DateValue | null => (v && typeof v === "object" && !Array.isArray(v) && typeof (v as DateValue).start === "string" && (v as DateValue).start ? (v as DateValue) : null);

function relationTarget(prop: NoteProperty): RelationTarget {
  if (prop.builtin && prop.key === "tasks") return "tasks";
  if (prop.builtin && prop.key === "events") return "events";
  const t = prop.config.target;
  return t === "tasks" || t === "events" ? t : "notes";
}

export default function PropertyValue({ note: noteIn, prop: propIn, properties, variant, readOnly, onChange, onPropertiesChange }: PropertyValueProps) {
  const router = useRouter();
  const env = usePropEnv();
  // Local copies so a change shows even when the parent doesn't pass onChange / onPropertiesChange
  const [localNote, setLocalNote] = useState<DbNote | null>(null);
  const [localProp, setLocalProp] = useState<NoteProperty | null>(null);
  useEffect(() => setLocalNote(null), [noteIn]);
  useEffect(() => setLocalProp(null), [propIn]);
  const note = localNote ?? noteIn;
  const prop = localProp ?? propIn;

  const [open, setOpen] = useState<Anchor | null>(null);
  const [inline, setInline] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(note);
  latest.current = note;

  const type = prop.type;
  const isPage = variant === "page";
  const isCard = variant === "card";
  const editable = !readOnly && !isCard && !READONLY_TYPES.includes(type);
  let value: unknown = null;
  try {
    value = rawValue(note, prop, properties);
  } catch {
    value = null;
  }

  // ---- saving ----
  const apply = (next: DbNote) => {
    setLocalNote(next);
    onChange?.(next);
  };
  const commit = async (next: DbNote, run: () => Promise<Result>) => {
    const prev = latest.current;
    apply(next);
    try {
      const r = await run();
      if (!r || !r.ok) throw r;
      if (r.templateApplied) router.refresh();
    } catch (e) {
      apply(prev);
      toast(errorText(e));
    }
  };
  const setValue = (v: PropValue) => {
    const n = latest.current;
    const values = { ...n.values };
    if (v === null || v === undefined) {
      delete values[prop.id];
      if (type === "status" && prop.config.defaultOptionId) values[prop.id] = prop.config.defaultOptionId;
    } else values[prop.id] = v;
    void commit({ ...n, values }, () => setNoteValue(n.id, prop.id, v));
  };
  const setTagNames = (names: string[]) => {
    const n = latest.current;
    const colors = new Map([...env.tags, ...n.tags].map((t) => [t.name.toLowerCase(), t.color]));
    void commit({ ...n, tags: names.map((name) => ({ name, color: colors.get(name.toLowerCase()) ?? null })) }, () => setNoteValue(n.id, prop.id, names));
  };
  const setRelation = (items: RelatedItem[]) => {
    const n = latest.current;
    const refs = items.map(({ type: t, id }) => ({ type: t, id }));
    const next: DbNote = { ...n, relations: { ...n.relations, [prop.id]: items } };
    if (!isBuiltinRelation(prop)) next.values = { ...n.values, [prop.id]: refs.length ? refs : null };
    void commit(next, () => setNoteValue(n.id, prop.id, refs));
  };
  const updateProp = (p: NoteProperty) => {
    setLocalProp(p);
    onPropertiesChange?.(properties.some((x) => x.id === p.id) ? properties.map((x) => (x.id === p.id ? p : x)) : [...properties, p]);
  };
  const createOption = async (name: string, select: (o: SelectOption) => void) => {
    try {
      const r = await addOption(prop.id, name, undefined, type === "status" ? "todo" : undefined);
      if (!r.ok) {
        toast(errorText(r));
        return;
      }
      updateProp(r.property);
      select(r.option);
    } catch (e) {
      toast(errorText(e));
    }
  };

  const saveText = (kind: TextKind, t: string | null) => {
    setInline(false);
    setOpen(null);
    if (t === null) return;
    const s = kind === "text" ? t : t.trim();
    const before = asString(value);
    if (s === before) return;
    if (!s.trim()) {
      setValue(null);
      return;
    }
    if (kind === "number") {
      let raw = s.replace(/[$%\s]/g, "");
      raw = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "");
      const n = raw ? Number(raw) : NaN;
      if (!Number.isFinite(n)) {
        toast("That isn't a number.");
        return;
      }
      setValue(n);
      return;
    }
    if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      toast("That isn't a valid email.");
      return;
    }
    if (kind === "url") {
      setValue(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
      return;
    }
    setValue(kind === "text" ? s.slice(0, 2000) : s);
  };

  const summarize = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiErr(null);
    try {
      const r = await summarizeNote(note.id);
      if (r.ok) {
        showAiUsage(r.usage);
        const n = latest.current;
        apply({ ...n, values: { ...n.values, [prop.id]: { text: r.text, at: new Date().toISOString() } } });
      } else setAiErr(r.error || "Couldn't summarize.");
    } catch (e) {
      setAiErr(errorText(e, "Couldn't summarize."));
    } finally {
      setAiBusy(false);
    }
  };

  // ---- opening an editor ----
  const opensPopover = editable && type !== "checkbox" && type !== "ai_summary" && !(isPage && TEXT_KINDS.includes(type));
  const start = (target?: Element | null) => {
    if (!editable || type === "checkbox" || type === "ai_summary") return;
    if (isPage && TEXT_KINDS.includes(type)) {
      setInline(true);
      return;
    }
    setOpen(anchorOf(target ?? box.current));
  };
  const onBoxClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a, button, input, textarea")) return;
    start(box.current);
  };
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  // ---- display ----
  const empty = <span className="np-empty">{isPage ? "Empty" : ""}</span>;
  const opts = prop.config.options ?? [];

  function display(): ReactNode {
    switch (type) {
      case "text": {
        const s = asString(value);
        return s ? <span className="np-text">{s}</span> : empty;
      }
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) return empty;
        if (prop.config.numberFormat === "bar") {
          const max = prop.config.barMax && prop.config.barMax > 0 ? prop.config.barMax : 100;
          const pct = Math.max(0, Math.min(1, value / max));
          return (
            <span className="np-bar" title={`${value} / ${max}`}>
              <span className="np-bar-track">
                <span className="np-bar-fill" style={{ width: `${pct * 100}%` }} />
              </span>
              <span className="np-bar-num">{formatNumber(value, { ...prop, config: { ...prop.config, numberFormat: "number" } })}</span>
            </span>
          );
        }
        return <span className="np-text">{formatNumber(value, prop)}</span>;
      }
      case "select":
      case "status": {
        const o = optionById(prop, value);
        return o ? <OptionPill option={o} status={type === "status"} small={isCard} /> : empty;
      }
      case "multi_select": {
        const chosen = asArray<string>(value)
          .map((id) => opts.find((o) => o.id === id))
          .filter((o): o is SelectOption => !!o);
        return chosen.length ? chosen.map((o) => <OptionPill key={o.id} option={o} status={false} small={isCard} />) : empty;
      }
      case "tags": {
        const tags = note.tags ?? [];
        return tags.length ? tags.map((t) => <OptionPill key={t.name} option={{ name: `#${t.name}`, color: okColor(t.color) }} status={false} small={isCard} />) : empty;
      }
      case "date": {
        const d = asDate(value);
        return d ? <span className="np-text">{formatDate(d, true)}</span> : empty;
      }
      case "checkbox": {
        const on = value === true;
        const canToggle = !readOnly;
        return (
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={prop.name}
            disabled={!canToggle}
            className={`np-check ${on ? "is-on" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (canToggle) setValue(!on);
            }}
          />
        );
      }
      case "files": {
        const files = asArray<FileValue>(value).filter((f) => f && typeof f.url === "string");
        if (!files.length) return empty;
        return files.map((f, i) =>
          isCard ? (
            <span key={`${f.url}:${i}`} className="np-chip">
              <span className="np-chip-icon">📎</span>
              <span className="np-chip-title">{f.name || "file"}</span>
            </span>
          ) : (
            <a key={`${f.url}:${i}`} href={f.url} target="_blank" rel="noreferrer" className="np-chip" onClick={stop}>
              <span className="np-chip-icon">📎</span>
              <span className="np-chip-title">{f.name || "file"}</span>
            </a>
          ),
        );
      }
      case "url":
      case "email":
      case "phone": {
        const s = asString(value);
        if (!s) return empty;
        const href = type === "url" ? s : type === "email" ? `mailto:${s}` : `tel:${s.replace(/[^\d+]/g, "")}`;
        const label = type === "url" ? s.replace(/^https?:\/\//, "").replace(/\/$/, "") : s;
        if (isCard) return <span className="np-text" title={s}>{label}</span>;
        return (
          <>
            <a href={href} target={type === "url" ? "_blank" : undefined} rel="noreferrer" className="np-link np-text" onClick={stop} title={s}>
              {label}
            </a>
            {editable && (
              <button type="button" className="np-edit-btn" aria-label={`Edit ${prop.name}`} title="Edit" onClick={(e) => {
                e.stopPropagation();
                start(box.current);
              }}>
                ✎
              </button>
            )}
          </>
        );
      }
      case "relation": {
        const items = asArray<RelatedItem>(value).filter((i) => i && i.id);
        if (!items.length) return empty;
        const shown = isCard ? items.slice(0, 6) : items;
        return (
          <>
            {shown.map((it) =>
              isCard ? (
                // Cards are often links themselves: no link inside a link
                <span key={`${it.type}:${it.id}`} className={`np-chip ${it.done ? "is-done" : ""}`} title={it.title}>
                  <span className="np-chip-icon">{relatedIcon(it)}</span>
                  <span className="np-chip-title">{it.title || "Untitled"}</span>
                </span>
              ) : (
                <Link key={`${it.type}:${it.id}`} href={relationHref(it.type, it.id)} className={`np-chip ${it.done ? "is-done" : ""}`} onClick={stop} title={it.title}>
                  <span className="np-chip-icon">{relatedIcon(it)}</span>
                  <span className="np-chip-title">{it.title || "Untitled"}</span>
                </Link>
              ),
            )}
            {shown.length < items.length && <span className="np-faint">+{items.length - shown.length}</span>}
          </>
        );
      }
      case "ai_summary": {
        const s = asString(value);
        const canRun = !readOnly && isPage;
        return (
          <>
            {s ? <span className="np-text">{s}</span> : !canRun ? empty : null}
            {canRun && (
              <button
                type="button"
                className={s ? "np-tiny-btn" : "np-props-btn"}
                style={s ? undefined : { marginLeft: -8, minHeight: 22, padding: "0 8px" }}
                disabled={aiBusy}
                title={s ? "Summarize again" : "Write a one-line summary with AI"}
                onClick={(e) => {
                  e.stopPropagation();
                  void summarize();
                }}
              >
                {aiBusy ? "Summarizing…" : s ? "↻" : "✨ Summarize"}
              </button>
            )}
            {aiErr && <span className="np-err">{aiErr}</span>}
          </>
        );
      }
      default: {
        // Read-only: rollup, ID, times, kind, counts
        let s = "";
        try {
          s = displayText(note, prop, properties, env.timezone);
        } catch {
          s = "";
        }
        if (type === "rollup" && prop.config.calc === "percent_done" && typeof value === "number") {
          const pct = Math.max(0, Math.min(100, value));
          return (
            <span className="np-bar" title={`${pct}% done`}>
              <span className="np-bar-track">
                <span className="np-bar-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="np-bar-num">{pct}%</span>
            </span>
          );
        }
        return s ? <span className={`np-text ${type === "created_time" || type === "last_edited_time" ? "np-faint" : ""}`}>{s}</span> : empty;
      }
    }
  }

  // ---- editors ----
  function editor(): ReactNode {
    if (!open) return null;
    const close = () => setOpen(null);
    switch (type) {
      case "select":
      case "status":
      case "multi_select": {
        const multi = type === "multi_select";
        const selected = multi ? asArray<string>(value).filter((id) => opts.some((o) => o.id === id)) : optionById(prop, value) ? [String(value)] : [];
        const pick = (ids: string[]) => setValue(multi ? ids : ids[0] ?? null);
        return (
          <OptionPicker
            prop={prop}
            selected={selected}
            multi={multi}
            anchor={open}
            onClose={close}
            onChange={pick}
            onCreate={(name) =>
              createOption(name, (o) => {
                if (multi) {
                  const cur = asArray<string>(rawValue(latest.current, prop, properties));
                  setValue(cur.includes(o.id) ? cur : [...cur, o.id]);
                } else setValue(o.id);
              })
            }
          />
        );
      }
      case "tags":
        return <TagPicker names={(note.tags ?? []).map((t) => t.name)} known={env.tags} anchor={open} onClose={close} onChange={setTagNames} />;
      case "relation":
        return <RelationPicker target={relationTarget(prop)} items={asArray<RelatedItem>(value)} noteId={note.id} anchor={open} onClose={close} onChange={setRelation} />;
      case "date":
        return <DatePicker value={asDate(value)} includeTime={!!prop.config.includeTime} timezone={env.timezone} anchor={open} onClose={close} onSave={(v) => setValue(v)} />;
      case "files":
        return <FilesEditor files={asArray<FileValue>(value)} anchor={open} onClose={close} onChange={(f) => setValue(f.length ? f : null)} />;
      case "text":
      case "number":
      case "url":
      case "email":
      case "phone":
        return <TextPopover kind={type} initial={asString(value)} anchor={open} onDone={(t) => saveText(type, t)} />;
      default:
        return null;
    }
  }

  // Page: text-like values edit in place
  if (inline && isPage && TEXT_KINDS.includes(type)) {
    return (
      <div className="np-val is-page is-editing">
        <TextEditor kind={type as TextKind} initial={asString(value)} onDone={(t) => saveText(type as TextKind, t)} />
      </div>
    );
  }

  const cls = `np-val is-${variant} ${editable ? "is-editable" : ""}`;
  let body: ReactNode;
  try {
    body = display();
  } catch {
    body = empty;
  }
  // Kind and Block open the menu that links the note to a block or moves it (not typed values)
  if ((type === "kind" || type === "block") && !readOnly && !isCard) {
    const shown = type === "block" && note.blockName ? <span className="np-text">🧱 {note.blockName}</span> : body;
    return (
      <div className={`np-val is-${variant} is-editable`}>
        <NoteLinkButton noteId={note.id} kind={note.kind} blockName={note.blockName} label={shown} navigate={isPage} className="flex w-full min-w-0 items-center text-left" />
      </div>
    );
  }
  return (
    <>
      <div
        ref={box}
        className={cls}
        onClick={editable ? onBoxClick : undefined}
        role={opensPopover || (isPage && editable && TEXT_KINDS.includes(type)) ? "button" : undefined}
        tabIndex={editable && type !== "checkbox" && type !== "ai_summary" ? 0 : undefined}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            start(box.current);
          }
        }}
      >
        {body}
      </div>
      {editor()}
    </>
  );
}
