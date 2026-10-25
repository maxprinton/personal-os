"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Calendar from "@/components/calendar/Calendar";
import { readPref, writePref } from "@/components/calendar/util";

const HIDDEN = ["/login", "/reset-password", "/auth", "/calendar"];
const BAR = 36;

/** Calendar panel docked at the bottom of every module. Collapsible; remembers its state. */
export default function CalendarDock() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);

  useEffect(() => {
    setOpen(readPref("cal.dock") === "open");
    setTall(readPref("cal.dock.tall") === "1");
  }, []);

  if (HIDDEN.some((p) => pathname.startsWith(p))) return null;

  const height = open ? (tall ? "75vh" : "45vh") : `${BAR}px`;
  function toggle() {
    setOpen(!open);
    writePref("cal.dock", open ? "closed" : "open");
  }
  function toggleTall() {
    setTall(!tall);
    writePref("cal.dock.tall", tall ? "0" : "1");
  }

  return (
    <>
      <div aria-hidden style={{ height }} />
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-edge bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
        style={{ height }}
      >
        <div className="flex shrink-0 items-center gap-3 px-3 text-sm" style={{ height: BAR }}>
          <button type="button" onClick={toggle} className="font-medium" aria-expanded={open}>
            {open ? "▾" : "▴"} Calendar
          </button>
          {open && (
            <button type="button" onClick={toggleTall} className="text-xs text-muted hover:text-fg">
              {tall ? "Smaller" : "Taller"}
            </button>
          )}
          <Link href="/calendar" className="ml-auto text-xs text-muted hover:text-fg">
            Full screen
          </Link>
        </div>
        {open && (
          <div className="min-h-0 flex-1 border-t border-line">
            <Calendar variant="dock" />
          </div>
        )}
      </div>
    </>
  );
}
