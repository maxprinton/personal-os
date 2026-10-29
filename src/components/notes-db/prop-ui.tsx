"use client";
// Small shared pieces of the property editing UI: the environment context (timezone, known tags),
// the option pill, a tiny error toast, switch, dates in the user's timezone and popover anchors.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { COLOR_NAMES, type ColorName } from "@/lib/editor/colors";
import type { SelectOption } from "@/lib/notes-db/types";
import "./properties.css";

// ---- Environment ---------------------------------------------------------------------------------

/**
 * What the values need from around them. Wrap any screen that shows PropertyValue in
 * <PropEnvContext.Provider value={{ timezone: data.timezone, tags }}> (optional):
 * - timezone: the user's IANA timezone (DbData.timezone) for "Created", "Last edited", "Today"…
 *   Default: the browser's timezone.
 * - tags: every known tag (suggested in the Tags picker). Default: none (you can still type new ones).
 */
export type PropEnv = { timezone?: string; tags?: { name: string; color: string | null }[] };
export const PropEnvContext = createContext<PropEnv>({});

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const noSubscribe = () => () => {};

export function usePropEnv() {
  const env = useContext(PropEnvContext);
  // The browser's timezone only after hydration ("UTC" on the server), so server and browser HTML match
  const browserTz = useSyncExternalStore(noSubscribe, browserTimezone, () => "UTC");
  return { timezone: env.timezone || browserTz, tags: env.tags ?? [] };
}

/** Today (YYYY-MM-DD) in a timezone. */
export function todayIn(tz: string) {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toLocaleDateString("en-CA");
  }
}

export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1000;

// ---- Pills ---------------------------------------------------------------------------------------

export const okColor = (c: unknown): ColorName => (typeof c === "string" && (COLOR_NAMES as readonly string[]).includes(c) ? (c as ColorName) : "default");

/** A colored option (select / multi-select / status). Reusable by the database views. */
export function OptionPill({
  option,
  status,
  small,
  onRemove,
}: {
  option: Pick<SelectOption, "name" | "color"> & { group?: SelectOption["group"] };
  /** Rounded with a dot, like Notion's Status (default: when the option has a group). */
  status?: boolean;
  small?: boolean;
  onRemove?: () => void;
}) {
  const isStatus = status ?? !!option.group;
  return (
    <span className={`np-pill ${isStatus ? "is-status" : ""} ${small ? "is-small" : ""}`} data-c={okColor(option.color)} title={option.name}>
      <span className="np-pill-name">{option.name || "Untitled"}</span>
      {onRemove && (
        <button
          type="button"
          className="np-pill-x"
          aria-label={`Remove ${option.name}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** A small colored square for color pickers. */
export function ColorDot({ color }: { color: ColorName }) {
  return <span className="np-dot" style={{ background: color === "default" ? "transparent" : `var(--n-${color}-bg)`, borderColor: color === "default" ? undefined : `var(--n-${color})` }} />;
}

export function Switch({ on }: { on: boolean }) {
  return <span className={`np-switch ${on ? "is-on" : ""}`} aria-hidden />;
}

// ---- Toast ---------------------------------------------------------------------------------------

let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** A short message at the bottom of the screen (errors from saving). */
export function toast(message: string, error = true) {
  if (typeof document === "undefined") return;
  if (!toastEl || !document.body.contains(toastEl)) {
    toastEl = document.createElement("div");
    toastEl.setAttribute("role", "status");
    document.body.appendChild(toastEl);
  }
  toastEl.className = `np-toast ${error ? "is-error" : ""}`;
  toastEl.textContent = message;
  toastEl.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastEl) toastEl.style.opacity = "0";
  }, 4000);
}

/** Text of an error from a server action result (or a thrown error). */
export function errorText(r: unknown, fallback = "Couldn't save. Try again.") {
  if (r && typeof r === "object" && "error" in r && typeof (r as { error: unknown }).error === "string") return (r as { error: string }).error;
  if (r instanceof Error) return r.message || fallback;
  return fallback;
}

// ---- Anchors & widths ----------------------------------------------------------------------------

export type Anchor = { left: number; top: number; bottom: number; right?: number; width: number };

export function anchorOf(el: Element | null | undefined): Anchor {
  if (!el) return { left: 16, top: 80, bottom: 80, right: 16, width: 0 };
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, right: r.right, width: r.width };
}

/** A popover width that fits the screen (phones). */
export function fitWidth(w: number) {
  if (typeof window === "undefined") return w;
  return Math.max(200, Math.min(w, window.innerWidth - 16));
}

/** Esc inside an editor: cancel (runs before the Popover's own Esc). */
export function useEscape(on: () => void, active = true) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        ref.current();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [active]);
}

export function Section({ children, label }: { children: ReactNode; label?: ReactNode }) {
  return (
    <div className="np-section">
      {label && <p className="n-menu-label">{label}</p>}
      {children}
    </div>
  );
}

/** Where a related item opens. */
export function relationHref(type: string, id: string) {
  if (type === "note") return `/notes/${id}`;
  if (type === "task") return "/tasks";
  return "/calendar";
}

export function fileSize(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}

// ---- Drag to reorder (mouse and touch) -----------------------------------------------------------

/** Moves the item `id` before / after `targetId`. */
export function moveItem<T extends { id: string }>(list: T[], id: string, targetId: string, before: boolean, patch?: (item: T, target: T) => T): T[] {
  const item = list.find((x) => x.id === id);
  const target = list.find((x) => x.id === targetId);
  if (!item || !target || id === targetId) return list;
  const rest = list.filter((x) => x.id !== id);
  let i = rest.findIndex((x) => x.id === targetId);
  if (!before) i += 1;
  rest.splice(i, 0, patch ? patch(item, target) : item);
  return rest;
}

type DragState = { id: string; over: string | null; before: boolean; moved: boolean };

/**
 * Rows carry data-drag-id={id} inside `containerRef`; the grip spreads gripProps(id).
 * Works with a mouse and with touch (pointer capture on the grip; the grip has touch-action: none).
 */
export function useDragReorder(onDrop: (id: string, targetId: string, before: boolean) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const ref = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const set = (d: DragState | null) => {
    ref.current = d;
    setDrag(d);
  };
  const gripProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      set({ id, over: null, before: true, moved: false });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = ref.current;
      if (!d) return;
      const rows = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-drag-id]") ?? []);
      let over: string | null = null;
      let before = true;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (e.clientY >= b.top && e.clientY <= b.bottom) {
          over = r.dataset.dragId ?? null;
          before = e.clientY < b.top + b.height / 2;
          break;
        }
      }
      if (!over && rows.length) {
        const first = rows[0].getBoundingClientRect();
        const last = rows[rows.length - 1].getBoundingClientRect();
        if (e.clientY < first.top) [over, before] = [rows[0].dataset.dragId ?? null, true];
        else if (e.clientY > last.bottom) [over, before] = [rows[rows.length - 1].dataset.dragId ?? null, false];
      }
      if (over !== d.over || before !== d.before || !d.moved) set({ ...d, over, before, moved: true });
    },
    onPointerUp: () => {
      const d = ref.current;
      set(null);
      if (d && d.moved && d.over && d.over !== d.id) dropRef.current(d.id, d.over, d.before);
    },
    onPointerCancel: () => set(null),
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  });
  const rowClass = (id: string) => {
    if (!drag || !drag.moved) return "";
    if (drag.id === id) return "is-dragging";
    if (drag.over === id) return drag.before ? "is-drop-before" : "is-drop-after";
    return "";
  };
  return { containerRef, gripProps, rowClass, dragging: !!drag };
}
