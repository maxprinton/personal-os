"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import Icon from "@/components/ui/Icon";
import AskChat from "@/components/ask/AskChat";

/**
 * BL-22: the button that opens the @os panel. In the top bar (icon) it asks about everything; inside a note
 * (variant "note") the open note is always read first.
 */
export default function AskPanelButton({ variant = "bar", noteId = null, noteTitle = null }: { variant?: "bar" | "note"; noteId?: string | null; noteTitle?: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // BL-120: the panel lives in the top bar, so it stayed open on top of the page it linked to; close it on any page change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {variant === "bar" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Ask your notes (@os)"
          aria-label="Ask your notes"
          aria-expanded={open}
          className={`grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-subtle hover:text-fg ${open ? "bg-accent-soft text-accent" : "text-muted"}`}
        >
          <Icon name="spark" size={18} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-md border border-edge px-2.5 py-1 text-xs transition-colors hover:bg-subtle">
          ✨ Ask about this note
        </button>
      )}
      {/* In document.body: the top bar has backdrop-blur, which makes a "fixed" child position itself inside the 56px bar (BL-106) */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[55]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label="Ask your notes" className="absolute inset-x-0 bottom-0 top-14 flex flex-col border-l border-line bg-surface p-4 shadow-pop sm:left-auto sm:w-[420px]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Ask your notes</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-faint hover:text-fg">✕</button>
            </div>
            <div className="min-h-0 flex-1">
              <AskChat focusNoteId={variant === "note" ? noteId : null} focusTitle={noteTitle} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
