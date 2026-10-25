"use client";

import { useEffect } from "react";

export default function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    // Capture phase: Esc closes the window even while typing in one of its fields
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-[2px] pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        className={`w-full ${wide ? "max-w-xl" : "max-w-md"} space-y-4 rounded-xl border border-line bg-surface p-5 shadow-pop`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-fg">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputCls = "w-full rounded-md border border-line-strong px-3 py-2 text-sm";
export const btnPrimary = "rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg disabled:opacity-50";
export const btnSecondary = "rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-2 text-sm disabled:opacity-50";
