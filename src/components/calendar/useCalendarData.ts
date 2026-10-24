"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData } from "@/lib/calendar/types";

/** Loads /api/calendar for a range and reloads on focus, every minute and on "calendar-changed". */
export function useCalendarData(from: string, to: string, enabled = true) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "You are signed out." : `Could not load the calendar (${res.status}).`);
      const json = (await res.json()) as CalendarData;
      if (id === seq.current) {
        setData(json);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Could not load the calendar.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [from, to, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener("calendar-changed", onChange);
    window.addEventListener("focus", onChange);
    const timer = setInterval(load, 60_000);
    return () => {
      window.removeEventListener("calendar-changed", onChange);
      window.removeEventListener("focus", onChange);
      clearInterval(timer);
    };
  }, [load]);

  return { data, error, loading, reload: load };
}
