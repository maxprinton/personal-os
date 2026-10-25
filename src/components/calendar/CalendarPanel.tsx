"use client";

import Link from "next/link";
import Calendar from "@/components/calendar/Calendar";
import Icon from "@/components/ui/Icon";

/**
 * The persistent calendar, on the right of every module (desktop only; phones use the Calendar tab).
 * ≥ 1280 px it sits beside the page; between 1024 and 1280 px it floats over it.
 */
export default function CalendarPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  if (!open) {
    return (
      <div className="sticky top-0 hidden h-dvh w-12 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface py-3 lg:flex">
        <button
          type="button"
          onClick={onToggle}
          title={"Show calendar ( \\ )"}
          aria-label="Show calendar"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
        >
          <Icon name="calendar" size={18} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 text-xs font-medium tracking-wide text-faint hover:text-fg [writing-mode:vertical-rl]"
        >
          Calendar
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Medium screens: click outside closes the floating panel */}
      <div className="fixed inset-0 z-30 hidden bg-black/20 lg:block xl:hidden" onClick={onToggle} aria-hidden />
      <aside
        aria-label="Calendar"
        className="fixed inset-y-0 right-0 z-40 hidden w-[400px] max-w-[92vw] shrink-0 flex-col border-l border-line bg-surface shadow-pop lg:flex xl:sticky xl:top-0 xl:z-auto xl:h-dvh xl:shadow-none 2xl:w-[440px]"
      >
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
          <Icon name="calendar" size={16} className="text-accent" />
          <span className="ml-1 text-sm font-semibold">Calendar</span>
          <Link
            href="/calendar"
            title="Open full calendar"
            aria-label="Open full calendar"
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Icon name="expand" size={16} />
          </Link>
          <button
            type="button"
            onClick={onToggle}
            title={"Hide calendar ( \\ )"}
            aria-label="Hide calendar"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Icon name="panelRight" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Calendar variant="panel" />
        </div>
      </aside>
    </>
  );
}
