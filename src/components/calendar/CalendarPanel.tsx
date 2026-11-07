"use client";

import Link from "next/link";
import Calendar from "@/components/calendar/Calendar";
import Icon from "@/components/ui/Icon";

/**
 * The calendar as a slide-over on the right (desktop only; phones use the Calendar tab).
 * Open it from the calendar button in the top bar or with "\". Esc or a click outside closes it.
 */
export default function CalendarPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 hidden bg-black/30 lg:block" onClick={onToggle} aria-hidden />
      <aside
        aria-label="Calendar"
        className="fixed inset-y-0 right-0 z-50 hidden w-[460px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-pop lg:flex"
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-4">
          <span className="font-display text-lg font-bold tracking-tight">Calendar</span>
          <Link
            href="/calendar"
            title="Open full calendar"
            aria-label="Open full calendar"
            className="ml-auto grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Icon name="expand" size={16} />
          </Link>
          <button
            type="button"
            onClick={onToggle}
            title={"Close calendar ( \\ )"}
            aria-label="Close calendar"
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Calendar variant="panel" />
        </div>
      </aside>
    </>
  );
}
