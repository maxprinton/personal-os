"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarData } from "@/lib/calendar/types";

/** Loads /api/calendar for a range and reloads on focus, every minute and on "calendar-changed". */
export function useCalendarData(from: string, to: string, enabled = true) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const [id] = useState(() => `cal-${Math.random().toString(36).slice(2)}`);

  /** Instant local change while the server works; loads already on the way are dropped so they can't undo it. */
  const patch = useCallback((fn: (d: CalendarData) => CalendarData) => {
    seq.current++;
    setLoading(false);
    setData((d) => (d ? fn(d) : d));
  }, []);

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
    const onChange = (e: Event) => {
      const source = (e as CustomEvent<{ source?: string }>).detail?.source;
      if (source && source === id) return; // our own change: we already reloaded
      load();
    };
    const onFocus = () => load();
    window.addEventListener("calendar-changed", onChange);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(load, 60_000);
    return () => {
      window.removeEventListener("calendar-changed", onChange);
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [load, id]);

  return { data, error, loading, reload: load, patch, id };
}
