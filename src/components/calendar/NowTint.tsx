"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { daysBetween, timeToMinutes } from "@/lib/time";
import { durationOf } from "@/lib/calendar/overlap";
import { alpha, browserToday, readPref } from "@/components/calendar/util";
import { useCalendarData } from "@/components/calendar/useCalendarData";

/**
 * Optional (Calendar ⚙ → "Page color of the current block"): tints the whole page with a soft version
 * of the color of the block you are in right now, like LifeOS did. Off by default.
 */
export default function NowTint() {
  const pathname = usePathname() ?? "/";
  const [on, setOn] = useState(false);

  useEffect(() => {
    const read = () => setOn(readPref("cal.tint") === "1");
    read();
    window.addEventListener("calendar-prefs", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("calendar-prefs", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  const signedOut = ["/login", "/reset-password", "/auth"].some((p) => pathname.startsWith(p));
  const today = browserToday();
  const { data } = useCalendarData(today, today, on && !signedOut);

  useEffect(() => {
    let color: string | null = null;
    if (on && !signedOut && data) {
      const now = data.nowMinutes;
      const current = data.occurrences.find((o) => {
        if (o.status === "cancelled" || o.status === "free_day") return false;
        const a = daysBetween(data.today, o.date) * 1440 + timeToMinutes(o.start_time);
        const b = a + durationOf(o.start_time, o.end_time);
        return now >= a && now < b;
      });
      if (current) color = data.blockTypes.find((t) => t.id === current.block_type_id)?.color ?? null;
    }
    document.body.style.backgroundColor = color ? alpha(color, 0.14) : "";
    document.body.style.transition = "background-color 0.6s";
  }, [on, signedOut, data]);

  return null;
}
