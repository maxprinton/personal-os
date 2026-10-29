"use client";

// Small building blocks for the editor's menus: a floating popover that stays inside the window,
// menu rows like Notion's, and the color swatch.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { swatchVar, type ColorName } from "@/lib/editor/colors";

export function Popover({
  rect,
  onClose,
  children,
  width = 260,
  placement = "below",
  className = "",
  closeOnEsc = true,
}: {
  rect: { left: number; top: number; bottom: number; right?: number };
  onClose: () => void;
  children: ReactNode;
  width?: number;
  placement?: "below" | "right" | "above";
  className?: string;
  closeOnEsc?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: rect.left, top: rect.bottom + 6 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    const h = el?.offsetHeight ?? 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = placement === "right" ? (rect.right ?? rect.left) + 4 : rect.left;
    let top = placement === "right" ? rect.top - 6 : placement === "above" ? rect.top - h - 6 : rect.bottom + 6;
    if (placement !== "above" && top + h > vh - 8) top = placement === "right" ? Math.max(8, vh - h - 8) : Math.max(8, rect.top - h - 6);
    if (top < 8) top = 8;
    if (placement === "right" && left + width > vw - 8) left = Math.max(8, rect.left - width - 4);
    left = Math.max(8, Math.min(left, vw - width - 8));
    setPos({ left, top });
  }, [rect.left, rect.top, rect.bottom, rect.right, width, placement]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-popover]")) onCloseRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEsc) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const t = setTimeout(() => window.addEventListener("mousedown", down), 0);
    window.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [closeOnEsc]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      data-popover
      className={`n-pop fixed z-[90] ${className}`}
      style={{ left: pos.left, top: pos.top, width }}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, select, [contenteditable=true]")) e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="n-menu-label">{children}</p>;
}

export function MenuItem({
  icon,
  label,
  hint,
  shortcut,
  active,
  danger,
  onClick,
  onHover,
  right,
  big,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  shortcut?: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  onHover?: () => void;
  right?: ReactNode;
  big?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onMouseMove={onHover}
      onClick={onClick}
      className={`n-menu-item ${active ? "is-active" : ""} ${danger ? "is-danger" : ""} ${big ? "is-big" : ""}`}
    >
      {icon !== undefined && <span className={big ? "n-menu-thumb" : "n-menu-icon"}>{icon}</span>}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate">{label}</span>
        {hint && <span className="n-menu-hint">{hint}</span>}
      </span>
      {shortcut && <span className="n-menu-shortcut">{shortcut}</span>}
      {right}
    </button>
  );
}

export function Swatch({ color, bg }: { color: ColorName; bg: boolean }) {
  return (
    <span
      className="n-swatch"
      style={bg ? { background: color === "default" ? "transparent" : swatchVar(color, true) } : { color: swatchVar(color, false) }}
    >
      A
    </span>
  );
}

/** Arrow keys / Enter for a list of n items. */
export function useListKeys(n: number, onEnter: (i: number) => void, active = true) {
  const [index, setIndex] = useState(0);
  const ref = useRef({ index, n, onEnter });
  ref.current = { index, n, onEnter };
  useEffect(() => {
    if (index >= n) setIndex(0);
  }, [n, index]);
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      const { index: i, n: len, onEnter: go } = ref.current;
      if (!len) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i + 1) % len);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i - 1 + len) % len);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        go(Math.min(i, len - 1));
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [active]);
  return [index, setIndex] as const;
}
