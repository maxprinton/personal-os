"use client";
// The editors a property value opens: options (select / multi-select / status), tags, relations,
// dates, files and plain text. Each one gets the current value and calls back with the new one;
// saving (optimistic, with undo on error) is done by PropertyValue.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Popover, useListKeys } from "@/components/editor/ui";
import { searchRelationTargets } from "@/app/notes-db-actions";
import { uploadNoteFile } from "@/lib/note-files";
import { statusGroups, type DateValue, type FileValue, type NoteProperty, type RelatedItem, type RelationTarget, type SelectOption, type StatusGroup } from "@/lib/notes-db/types";
import { OptionPill, Switch, addDays, errorText, fileSize, fitWidth, isYmd, okColor, relationHref, toast, todayIn, useEscape, type Anchor } from "./prop-ui";

export const GROUP_LABEL: Record<StatusGroup, string> = { todo: "To-do", in_progress: "In progress", done: "Done" };

// ---- Options -------------------------------------------------------------------------------------

type OptItem = { kind: "opt"; o: SelectOption } | { kind: "create"; name: string };

export function OptionPicker({
  prop,
  selected,
  multi,
  anchor,
  onClose,
  onChange,
  onCreate,
}: {
  prop: NoteProperty;
  selected: string[];
  multi: boolean;
  anchor: Anchor;
  onClose: () => void;
  onChange: (ids: string[]) => void;
  /** Creates the option and selects it. */
  onCreate: (name: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const isStatus = prop.type === "status";
  const options = prop.config.options ?? [];
  const term = q.trim().toLowerCase();
  const match = (o: SelectOption) => !term || o.name.toLowerCase().includes(term);
  const groups = isStatus ? statusGroups(prop).map((g) => ({ ...g, options: g.options.filter(match) })) : null;
  const flat: SelectOption[] = groups ? groups.flatMap((g) => g.options) : options.filter(match);
  const exact = options.some((o) => o.name.toLowerCase() === term);
  const items: OptItem[] = [...flat.map((o) => ({ kind: "opt" as const, o })), ...(term && !exact ? [{ kind: "create" as const, name: q.trim() }] : [])];

  const pick = async (it: OptItem | undefined) => {
    if (!it) return;
    if (it.kind === "create") {
      if (creating) return;
      setCreating(true);
      try {
        await onCreate(it.name);
      } finally {
        setCreating(false);
      }
      setQ("");
      if (!multi) onClose();
      return;
    }
    const id = it.o.id;
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      if (selected[0] !== id) onChange([id]);
      onClose();
    }
    setQ("");
  };
  const [index, setIndex] = useListKeys(items.length, (i) => void pick(items[i]));

  const chosen = selected.map((id) => options.find((o) => o.id === id)).filter((o): o is SelectOption => !!o);
  let n = -1;
  const row = (o: SelectOption) => {
    n += 1;
    const i = n;
    const on = selected.includes(o.id);
    return (
      <button key={o.id} type="button" className={`np-row-btn ${index === i ? "is-active" : ""}`} onMouseMove={() => setIndex(i)} onClick={() => void pick({ kind: "opt", o })}>
        <OptionPill option={o} status={isStatus} />
        {prop.config.defaultOptionId === o.id && isStatus && <span className="np-tag-default">Default</span>}
        <span className="np-right">{on ? "✓" : ""}</span>
      </button>
    );
  };

  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(Math.max(anchor.width, 280))} className="np-menu">
      <div className="np-search">
        {chosen.map((o) => (
          <OptionPill
            key={o.id}
            option={o}
            status={isStatus}
            onRemove={isStatus ? undefined : () => onChange(selected.filter((x) => x !== o.id))}
          />
        ))}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !q && chosen.length && !isStatus) {
              e.preventDefault();
              onChange(selected.slice(0, -1));
            }
          }}
          placeholder={chosen.length ? "" : isStatus ? "Search for an option…" : "Search for an option…"}
          aria-label="Search options"
        />
      </div>
      <p className="np-hint">{isStatus ? "Select an option" : multi ? "Select options or create one" : "Select an option or create one"}</p>
      {groups
        ? groups.map((g) =>
            g.options.length ? (
              <div key={g.group}>
                <p className="n-menu-label">{GROUP_LABEL[g.group]}</p>
                {g.options.map(row)}
              </div>
            ) : null,
          )
        : flat.map(row)}
      {items.length > 0 && items[items.length - 1].kind === "create" && (
        <button type="button" className={`np-row-btn ${index === items.length - 1 ? "is-active" : ""}`} onMouseMove={() => setIndex(items.length - 1)} onClick={() => void pick(items[items.length - 1])} disabled={creating}>
          <span className="np-faint">{creating ? "Creating…" : "Create"}</span>
          <OptionPill option={{ name: q.trim(), color: "default", group: isStatus ? "todo" : undefined }} status={isStatus} />
        </button>
      )}
      {!items.length && <p className="np-hint">No options yet. Type a name to create one.</p>}
    </Popover>
  );
}

// ---- Tags ----------------------------------------------------------------------------------------

type TagItem = { kind: "tag"; name: string; color: string | null } | { kind: "create"; name: string };

export function TagPicker({
  names,
  known,
  anchor,
  onClose,
  onChange,
}: {
  names: string[];
  known: { name: string; color: string | null }[];
  anchor: Anchor;
  onClose: () => void;
  onChange: (names: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const term = q.trim().replace(/^#/, "").trim();
  const low = term.toLowerCase();
  const has = (n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase());
  const pool = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const t of known) if (t?.name && !m.has(t.name.toLowerCase())) m.set(t.name.toLowerCase(), t);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [known]);
  const list = pool.filter((t) => !has(t.name) && (!low || t.name.toLowerCase().includes(low))).slice(0, 50);
  const exists = pool.some((t) => t.name.toLowerCase() === low) || has(term);
  const items: TagItem[] = [...list.map((t) => ({ kind: "tag" as const, ...t })), ...(term && !exists ? [{ kind: "create" as const, name: term }] : [])];
  const add = (name: string) => {
    const clean = name.trim().replace(/^#/, "").trim().slice(0, 60);
    if (!clean || has(clean)) return;
    onChange([...names, clean]);
    setQ("");
  };
  const [index, setIndex] = useListKeys(items.length, (i) => {
    const it = items[i];
    if (it) add(it.name);
  });
  const colorOf = (n: string) => pool.find((t) => t.name.toLowerCase() === n.toLowerCase())?.color ?? null;
  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(Math.max(anchor.width, 280))} className="np-menu">
      <div className="np-search">
        {names.map((n) => (
          <OptionPill key={n} option={{ name: `#${n}`, color: okColor(colorOf(n)) }} status={false} onRemove={() => onChange(names.filter((x) => x !== n))} />
        ))}
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            // "work, home" → two tags
            if (/[,]$/.test(v)) {
              add(v.slice(0, -1));
              return;
            }
            setQ(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !q && names.length) {
              e.preventDefault();
              onChange(names.slice(0, -1));
            }
          }}
          placeholder={names.length ? "" : "Search or create a tag…"}
          aria-label="Search tags"
        />
      </div>
      <p className="np-hint">Select a tag or create one</p>
      {items.map((it, i) => (
        <button key={`${it.kind}:${it.name}`} type="button" className={`np-row-btn ${index === i ? "is-active" : ""}`} onMouseMove={() => setIndex(i)} onClick={() => add(it.name)}>
          {it.kind === "create" && <span className="np-faint">Create</span>}
          <OptionPill option={{ name: `#${it.name}`, color: it.kind === "tag" ? okColor(it.color) : "default" }} status={false} />
        </button>
      ))}
      {!items.length && <p className="np-hint">{pool.length ? "No more tags. Type to create one." : "Type to create a tag."}</p>}
    </Popover>
  );
}

// ---- Relations -----------------------------------------------------------------------------------

export function relatedIcon(it: Pick<RelatedItem, "type" | "done" | "icon">) {
  if (it.type === "task") return it.done ? "✓" : "☐";
  if (it.type === "event") return "📅";
  if (it.type === "block_type") return "▦";
  return it.icon || "📄";
}

const TARGET_LABEL: Record<RelationTarget, string> = { notes: "notes", tasks: "tasks", events: "events and blocks" };

export function RelationPicker({
  target,
  items,
  noteId,
  anchor,
  onClose,
  onChange,
}: {
  target: RelationTarget;
  items: RelatedItem[];
  noteId: string;
  anchor: Anchor;
  onClose: () => void;
  onChange: (items: RelatedItem[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(
      async () => {
        try {
          const r = await searchRelationTargets(target, q, noteId);
          if (!live) return;
          if (r.ok) {
            setResults(r.items);
            setErr(null);
          } else setErr(errorText(r, "Couldn't search."));
        } catch (e) {
          if (live) setErr(errorText(e, "Couldn't search."));
        } finally {
          if (live) setLoading(false);
        }
      },
      q ? 220 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, target, noteId]);

  const key = (r: Pick<RelatedItem, "type" | "id">) => `${r.type}:${r.id}`;
  const linked = new Set(items.map(key));
  const toggle = (r: RelatedItem) => onChange(linked.has(key(r)) ? items.filter((x) => key(x) !== key(r)) : [...items, r]);
  const fresh = results.filter((r) => !linked.has(key(r)));
  const [index, setIndex] = useListKeys(fresh.length, (i) => {
    if (fresh[i]) toggle(fresh[i]);
  });

  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(Math.max(anchor.width, 320))} className="np-menu">
      <div className="np-search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Link ${TARGET_LABEL[target]}…`} aria-label="Search" />
      </div>
      {items.length > 0 && (
        <div className="np-section">
          <p className="n-menu-label">Linked</p>
          {items.map((it) => (
            <div key={key(it)} className="np-row-btn">
              <span className="np-icon">{relatedIcon(it)}</span>
              <Link href={relationHref(it.type, it.id)} className={`np-link min-w-0 flex-1 truncate ${it.done ? "line-through opacity-60" : ""}`}>
                {it.title || "Untitled"}
              </Link>
              <button type="button" className="np-tiny-btn" aria-label={`Remove ${it.title}`} title="Remove" onClick={() => toggle(it)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="np-section">
        <p className="n-menu-label">{q ? "Results" : "Recent"}</p>
        {err && <p className="np-hint np-err">{err}</p>}
        {fresh.map((r, i) => (
          <button key={key(r)} type="button" className={`np-row-btn ${index === i ? "is-active" : ""}`} onMouseMove={() => setIndex(i)} onClick={() => toggle(r)}>
            <span className="np-icon">{relatedIcon(r)}</span>
            <span className={`min-w-0 flex-1 truncate ${r.done ? "line-through opacity-60" : ""}`}>{r.title || "Untitled"}</span>
            {r.type === "block_type" && <span className="np-right">Block</span>}
            {r.type !== "block_type" && r.date && <span className="np-right">{r.date.slice(0, 10)}</span>}
          </button>
        ))}
        {!loading && !fresh.length && !err && <p className="np-hint">{q ? "Nothing found." : "Nothing to link yet."}</p>}
        {loading && <p className="np-hint">Searching…</p>}
      </div>
    </Popover>
  );
}

// ---- Date ----------------------------------------------------------------------------------------

export function DatePicker({
  value,
  includeTime,
  timezone,
  anchor,
  onClose,
  onSave,
}: {
  value: DateValue | null;
  includeTime: boolean;
  timezone: string;
  anchor: Anchor;
  onClose: () => void;
  onSave: (v: DateValue | null) => void;
}) {
  const [start, setStart] = useState(value?.start ?? "");
  const [hasEnd, setHasEnd] = useState(!!value?.end);
  const [end, setEnd] = useState(value?.end ?? "");
  const [hasTime, setHasTime] = useState(includeTime || !!value?.time);
  const [time, setTime] = useState(value?.time ?? "");
  const done = useRef(false);

  const build = (s = start, e = end, he = hasEnd, t = time, ht = hasTime): DateValue | null | undefined => {
    if (!s) return null;
    if (!isYmd(s)) return undefined; // half typed: don't save
    return { start: s, end: he && isYmd(e) && e >= s ? e : null, time: ht && /^\d{2}:\d{2}$/.test(t) ? t : null };
  };
  const same = (a: DateValue | null, b: DateValue | null) => (a?.start ?? "") === (b?.start ?? "") && (a?.end ?? "") === (b?.end ?? "") && (a?.time ?? "") === (b?.time ?? "");
  const finish = (v: DateValue | null | undefined) => {
    if (done.current) return;
    done.current = true;
    if (v !== undefined && !same(v, value)) onSave(v);
    onClose();
  };
  useEscape(() => {
    done.current = true;
    onClose();
  });
  const today = todayIn(timezone);
  const quick = (d: string) => finish(build(d, "", false));

  return (
    <Popover rect={anchor} onClose={() => finish(build())} width={fitWidth(290)} className="np-menu" closeOnEsc={false}>
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(build());
          }
        }}
      >
        <div className="np-quick">
          <button type="button" onClick={() => quick(today)}>Today</button>
          <button type="button" onClick={() => quick(addDays(today, 1))}>Tomorrow</button>
          <button type="button" onClick={() => quick(addDays(today, 7))}>Next week</button>
        </div>
        <div className="np-field">
          <label htmlFor="np-date-start">{hasEnd ? "Start" : "Date"}</label>
          <input id="np-date-start" type="date" className="n-input np-input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        {hasEnd && (
          <div className="np-field">
            <label htmlFor="np-date-end">End</label>
            <input id="np-date-end" type="date" className="n-input np-input" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
        {hasTime && (
          <div className="np-field">
            <label htmlFor="np-date-time">Time</label>
            <input id="np-date-time" type="time" className="n-input np-input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}
        <div className="np-section">
          <button
            type="button"
            className="np-row-btn"
            onClick={() => {
              setHasEnd(!hasEnd);
              if (!hasEnd && !end && isYmd(start)) setEnd(start);
            }}
          >
            <span className="flex-1">End date</span>
            <Switch on={hasEnd} />
          </button>
          <button type="button" className="np-row-btn" onClick={() => setHasTime(!hasTime)}>
            <span className="flex-1">Include time</span>
            <Switch on={hasTime} />
          </button>
        </div>
        <div className="np-section flex items-center gap-2 px-1 pt-2">
          <button type="button" className="n-btn" onClick={() => finish(null)}>
            Clear
          </button>
          <span className="flex-1" />
          <button type="button" className="n-btn n-btn-primary" onClick={() => finish(build())}>
            Done
          </button>
        </div>
      </div>
    </Popover>
  );
}

// ---- Files ---------------------------------------------------------------------------------------

export function FilesEditor({ files, anchor, onClose, onChange }: { files: FileValue[]; anchor: Anchor; onClose: () => void; onChange: (files: FileValue[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [link, setLink] = useState("");
  const latest = useRef(files);
  latest.current = files;

  const upload = async (list: FileList | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    setBusy((b) => b + arr.length);
    const added: FileValue[] = [];
    for (const f of arr) {
      try {
        const r = await uploadNoteFile(f);
        if (r) added.push({ url: r.url, name: r.name, size: r.size });
        else toast(`Couldn't upload “${f.name}” (50 MB max).`);
      } catch {
        toast(`Couldn't upload “${f.name}”.`);
      }
      setBusy((b) => b - 1);
    }
    if (added.length) onChange([...latest.current, ...added]);
    if (input.current) input.current.value = "";
  };
  const addLink = () => {
    const u = link.trim();
    if (!u) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
    const name = url.replace(/^https?:\/\//, "").split(/[?#]/)[0].split("/").filter(Boolean).pop() || url;
    onChange([...latest.current, { url, name: decodeURIComponent(name).slice(0, 200) }]);
    setLink("");
  };

  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(Math.max(anchor.width, 320))} className="np-menu">
      {files.length > 0 && (
        <div className="np-section">
          {files.map((f, i) => (
            <div key={`${f.url}:${i}`} className="np-row-btn">
              <span className="np-icon">📎</span>
              <a href={f.url} target="_blank" rel="noreferrer" className="np-link min-w-0 flex-1 truncate">
                {f.name || "file"}
              </a>
              {f.size ? <span className="np-right">{fileSize(f.size)}</span> : null}
              <button type="button" className="np-tiny-btn" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="np-section">
        <button type="button" className="np-row-btn" disabled={busy > 0} onClick={() => input.current?.click()}>
          <span className="np-icon">+</span>
          <span>{busy > 0 ? `Uploading ${busy}…` : "Add file"}</span>
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
        <form
          className="flex items-center gap-2 px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a link…" className="n-input np-input min-w-0 flex-1" inputMode="url" />
          <button className="n-btn" disabled={!link.trim()}>
            Add
          </button>
        </form>
      </div>
    </Popover>
  );
}

// ---- Text (text, number, URL, email, phone) ------------------------------------------------------

type TextKind = "text" | "number" | "url" | "email" | "phone";

const INPUT_MODE: Record<TextKind, "text" | "decimal" | "url" | "email" | "tel"> = { text: "text", number: "decimal", url: "url", email: "email", phone: "tel" };
const PLACEHOLDER: Record<TextKind, string> = { text: "Type something…", number: "Type a number…", url: "Paste a link…", email: "name@example.com", phone: "Phone number…" };

/** A text box that saves on Enter / blur (or when its popover closes) and cancels on Esc. */
export function TextEditor({
  kind,
  initial,
  inPopover,
  draft,
  onDone,
}: {
  kind: TextKind;
  initial: string;
  inPopover?: boolean;
  /** Always holds the text being typed (the popover saves it when it closes). */
  draft?: { current: string };
  /** text = save it; null = cancel. */
  onDone: (text: string | null) => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, []);
  if (draft) draft.current = v;
  return (
    <textarea
      ref={ref}
      rows={1}
      value={v}
      inputMode={INPUT_MODE[kind]}
      placeholder={PLACEHOLDER[kind]}
      className="np-inline-input"
      style={inPopover ? { boxShadow: "none", maxHeight: "50vh", overflowY: "auto" } : undefined}
      onChange={(e) => setV(kind === "text" ? e.target.value : e.target.value.replace(/\n/g, ""))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (kind !== "text" || !e.shiftKey) && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(v);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => {
        if (!inPopover) finish(v);
      }}
    />
  );
}

export function TextPopover({ kind, initial, anchor, onDone }: { kind: TextKind; initial: string; anchor: Anchor; onDone: (text: string | null) => void }) {
  const draft = useRef(initial);
  const done = useRef(false);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  useEscape(() => finish(null));
  return (
    <Popover rect={{ left: anchor.left, top: anchor.top, bottom: anchor.top - 6, right: anchor.right }} onClose={() => finish(draft.current)} width={fitWidth(Math.max(anchor.width, 260))} className="np-menu" closeOnEsc={false}>
      <TextEditor kind={kind} initial={initial} inPopover draft={draft} onDone={finish} />
    </Popover>
  );
}

// ---- AI summary (table cell): the summary so far + the ✨ button, in a floating panel ------------

export function AiSummaryPopover({
  text,
  anchor,
  busy,
  error,
  onRun,
  onClose,
}: {
  text: string;
  anchor: Anchor;
  busy: boolean;
  error: string | null;
  onRun: () => void;
  onClose: () => void;
}) {
  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(Math.max(anchor.width, 320))} className="np-menu">
      <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
        {text ? <div className="np-text" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{text}</div> : <div className="np-faint">No summary yet.</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="np-props-btn" style={{ minHeight: 26, padding: "0 8px", marginLeft: -8 }} disabled={busy} title={text ? "Summarize again" : "Write a one-line summary with AI"} onClick={onRun}>
            {busy ? "Summarizing…" : text ? "↻ Summarize again" : "✨ Summarize"}
          </button>
          {error && <span className="np-err">{error}</span>}
        </div>
      </div>
    </Popover>
  );
}
