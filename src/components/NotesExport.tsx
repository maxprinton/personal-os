"use client";

// Select notes in the Notes module and copy them (instantly) or export them (Markdown, PDF, Word,
// plain text, web page, Mermaid) — one note or many, as one file or a ZIP with one file per note.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COPY_KINDS, FORMATS, type CopyKind, type ExportFormat } from "@/lib/note-export/formats";
import { getLiveNote } from "@/lib/note-export/live";
import type { ExportNote } from "@/lib/note-export/model";
import SummarizeNotes from "@/components/SummarizeNotes";
import { isStaleBuildError, reloadOnce } from "@/lib/recover";

type Lib = typeof import("@/lib/note-export");
let libPromise: Promise<Lib> | null = null;
/** Loads the exporter once; if loading fails (e.g. the app was just updated) the next try starts over. */
const loadLib = () =>
  (libPromise ??= import("@/lib/note-export").catch((e) => {
    libPromise = null;
    throw e;
  }));

/** Loads the exporter as soon as the page shows, so Copy works on the very click. */
function useLib() {
  const ref = useRef<Lib | null>(null);
  useEffect(() => {
    let alive = true;
    loadLib()
      .then((l) => {
        if (alive) ref.current = l;
      })
      .catch(() => {}); // a click tries again (and an outdated tab reloads itself)
    return () => {
      alive = false;
    };
  }, []);
  return ref;
}

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private window: just don't remember */
    }
  },
};

// ---------- little "Copied ✓" message ----------

function useFlash() {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string, bad = false) => {
    setMsg({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2200);
  }, []);
  const node = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6">
      {msg && (
        <p
          className={`max-w-sm truncate rounded-full px-4 py-2 text-sm font-medium shadow-lg ${
            msg.bad ? "bg-danger-solid text-white" : "bg-fg text-app"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
  return { flash, node };
}

// ---------- popover ----------

function Popover({ open, onClose, children, className = "" }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className={`absolute right-0 top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-xl ${className}`}
    >
      {children}
    </div>
  );
}

const base = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const btn = `${base} border-edge bg-surface hover:bg-subtle`;
const primary = `${base} border-accent bg-accent text-accent-fg hover:bg-accent-hover`;

const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);
const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
const Caret = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * Copy + Export buttons. getNotes is read at click time (the selection or the note as it is right now).
 * Copy = formatted (Word, Docs, email) and Markdown at the same time; ▾ copies in another format.
 */
export function ExportMenu({ getNotes, count, compact = false }: { getNotes: () => ExportNote[]; count: number; compact?: boolean }) {
  const lib = useLib();
  const { flash, node } = useFlash();
  const [menu, setMenu] = useState<"copy" | "export" | null>(null);
  const [zip, setZip] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = useCallback(() => setMenu(null), []);
  useEffect(() => setZip(store.get("notes-export-zip") === "1"), []);
  const what = count === 1 ? "note" : `${count} notes`;

  async function copy(kind: CopyKind) {
    setMenu(null);
    const notes = getNotes();
    if (!notes.length) return;
    let l: Lib;
    try {
      l = lib.current ?? (await loadLib());
    } catch (e) {
      if (isStaleBuildError(e) && reloadOnce()) return;
      flash("Couldn’t load the copy tool. Reload the page.", true);
      return;
    }
    const ok = await l.writeClipboard(l.buildCopy(notes, kind));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      flash(`Copied ${what}${kind === "rich" ? "" : ` as ${COPY_KINDS.find((k) => k.id === kind)!.label}`} ✓`);
    } else flash("Your browser blocked the clipboard", true);
  }

  async function exportAs(format: ExportFormat) {
    setMenu(null);
    const notes = getNotes();
    if (!notes.length) return;
    store.set("notes-export-format", format);
    try {
      const l = lib.current ?? (await loadLib());
      const file = l.buildExport(notes, format, zip && notes.length > 1);
      l.downloadFile(file);
      flash(`Downloaded ${file.name}`);
    } catch (e) {
      console.error(e);
      if (isStaleBuildError(e) && reloadOnce()) return;
      flash("Could not export those notes", true);
    }
  }

  const disabled = count === 0;
  const last = (typeof window !== "undefined" && store.get("notes-export-format")) || "";

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void copy("rich")}
          onPointerEnter={() => void loadLib().catch(() => {})}
          title="Copy (keeps formatting in Word, Docs and email; Markdown in plain-text apps)"
          className={`${btn} rounded-r-none ${copied ? "text-success" : ""}`}
        >
          {copied ? <span aria-hidden>✓</span> : <CopyIcon />}
          {compact ? <span className="sr-only">Copy</span> : copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="Copy as…"
          aria-expanded={menu === "copy"}
          onClick={() => setMenu(menu === "copy" ? null : "copy")}
          className={`${btn} -ml-px rounded-l-none px-1.5`}
        >
          <Caret />
        </button>
        <Popover open={menu === "copy"} onClose={close}>
          <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted">Copy {what} as</p>
          {COPY_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="menuitem"
              onClick={() => void copy(k.id)}
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-subtle"
            >
              <span className="text-sm font-medium">{k.label}</span>
              <span className="text-xs text-muted">{k.hint}</span>
            </button>
          ))}
        </Popover>
      </div>

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={menu === "export"}
          onClick={() => {
            void loadLib().catch(() => {});
            setMenu(menu === "export" ? null : "export");
          }}
          className={primary}
        >
          <DownloadIcon />
          {compact ? <span className="sr-only">Export</span> : "Export"}
        </button>
        <Popover open={menu === "export"} onClose={close}>
          <p className="px-2 pb-1.5 pt-0.5 text-xs font-medium text-muted">Export {what} as</p>
          {count > 1 && (
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1 text-xs" role="radiogroup" aria-label="How to export several notes">
              {[
                { v: false, label: "One file", hint: "all together" },
                { v: true, label: "ZIP", hint: "one file each" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={zip === o.v}
                  onClick={() => {
                    setZip(o.v);
                    store.set("notes-export-zip", o.v ? "1" : "0");
                  }}
                  className={`rounded-md px-2 py-1.5 ${zip === o.v ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-fg"}`}
                >
                  {o.label} <span className="font-normal text-faint">· {o.hint}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                onClick={() => void exportAs(f.id)}
                className={`flex flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-subtle ${
                  last === f.id ? "border-accent/50" : "border-line"
                }`}
              >
                <span className="text-sm font-medium">
                  {f.label} <span className="text-xs font-normal text-faint">.{count > 1 && zip ? "zip" : f.ext}</span>
                </span>
                <span className="text-xs text-muted">{f.hint}</span>
              </button>
            ))}
          </div>
        </Popover>
      </div>
      {node}
    </div>
  );
}

// ---------- selection in the notes list ----------

type Sel = {
  notes: ExportNote[];
  selected: Set<string>;
  toggle: (id: string, on: boolean) => void;
  setAll: (on: boolean) => void;
};
const SelCtx = createContext<Sel | null>(null);

/** Wraps a list of notes: their checkboxes, the bar, and Ctrl/⌘+C to copy the selected notes. */
export function NoteSelection({ notes, children }: { notes: ExportNote[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lib = useLib();
  const { flash, node } = useFlash();
  const ids = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);

  // Notes that left the list (a new search) leave the selection too
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [ids]);

  const toggle = useCallback((id: string, on: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const setAll = useCallback((on: boolean) => setSelected(on ? new Set(ids) : new Set()), [ids]);

  // Ctrl/⌘+C with notes selected (and no text selected) copies them; Esc clears the selection
  useEffect(() => {
    const editable = (el: Element | null) => !!el && (el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable='true']") || !!el.closest("[contenteditable='true']"));
    const onCopy = (e: ClipboardEvent) => {
      if (!selected.size || !lib.current || !e.clipboardData) return;
      const sel = window.getSelection();
      if ((sel && !sel.isCollapsed && sel.toString().trim()) || editable(document.activeElement)) return;
      const picked = notes.filter((n) => selected.has(n.id));
      const c = lib.current.buildCopy(picked, "rich");
      e.clipboardData.setData("text/plain", c.text);
      if (c.html) e.clipboardData.setData("text/html", c.html);
      e.preventDefault();
      flash(`Copied ${picked.length === 1 ? "note" : `${picked.length} notes`} ✓`);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selected.size && !editable(document.activeElement)) setSelected(new Set());
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected, notes, lib, flash]);

  const value = useMemo(() => ({ notes, selected, toggle, setAll }), [notes, selected, toggle, setAll]);
  return (
    <SelCtx.Provider value={value}>
      {children}
      {node}
    </SelCtx.Provider>
  );
}

/** The checkbox of one note in the list. */
export function NoteCheckbox({ id, title }: { id: string; title: string }) {
  const ctx = useContext(SelCtx);
  if (!ctx) return null;
  return (
    <label className="-mx-1.5 -my-1 flex shrink-0 cursor-pointer items-center p-1.5" title="Select to copy or export">
      <input
        type="checkbox"
        checked={ctx.selected.has(id)}
        onChange={(e) => ctx.toggle(id, e.target.checked)}
        aria-label={`Select “${title || "Untitled"}”`}
        className="h-4 w-4 cursor-pointer accent-accent"
      />
    </label>
  );
}

/** Select all · count · Copy · Export (sticks to the top while scrolling). */
export function NotesExportBar() {
  const ctx = useContext(SelCtx);
  const allRef = useRef<HTMLInputElement>(null);
  const n = ctx?.selected.size ?? 0;
  const total = ctx?.notes.length ?? 0;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = n > 0 && n < total;
  }, [n, total]);
  if (!ctx || !total) return null;
  const getNotes = () => ctx.notes.filter((x) => ctx.selected.has(x.id)).map((x) => ({ ...x, ...fresh(x) }));

  return (
    <div className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-card backdrop-blur">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          ref={allRef}
          type="checkbox"
          checked={n > 0 && n === total}
          onChange={(e) => ctx.setAll(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-accent"
          aria-label="Select all notes"
        />
        {n ? (
          <span className="font-medium">
            {n} selected<span className="hidden font-normal text-faint sm:inline"> · Ctrl+C copies them</span>
          </span>
        ) : (
          <span className="text-muted">Select all ({total})</span>
        )}
      </label>
      {n > 0 && (
        <button type="button" onClick={() => ctx.setAll(false)} className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
          Clear
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <SummarizeNotes getNotes={getNotes} count={n} />
        <ExportMenu getNotes={getNotes} count={n} />
      </div>
    </div>
  );
}

/** What the editor on screen holds for this note, if it is newer than the list. */
function fresh(n: ExportNote) {
  const live = getLiveNote(n.kind === "block" ? `block:${n.title}` : n.id);
  return live ? { content: live.content, ...(live.title !== undefined ? { title: live.title } : {}) } : {};
}

/** Copy / Export for the note that is open (uses what is on screen, even if not saved yet). */
export function NoteExportMenu({ note, liveKey }: { note: ExportNote; liveKey: string }) {
  const getNotes = () => {
    const live = getLiveNote(liveKey);
    return [{ ...note, ...(live ? { content: live.content, ...(live.title !== undefined ? { title: live.title } : {}) } : {}) }];
  };
  return <ExportMenu getNotes={getNotes} count={1} />;
}
