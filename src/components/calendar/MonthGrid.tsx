"use client";

import { useMemo } from "react";
import { dateRange, ISO_DAY_SHORT } from "@/lib/time";
import type { CalendarData } from "@/lib/calendar/types";
import { eventSpanOn } from "@/lib/calendar/overlap";
import { alpha, textOn } from "@/components/calendar/util";

/** Month overview: small chips per block. Clicking a day opens it in day view. */
export default function MonthGrid({
  data,
  month,
  onPickDay,
}: {
  data: CalendarData;
  month: string; // YYYY-MM
  onPickDay: (date: string) => void;
}) {
  const typeById = useMemo(() => new Map(data.blockTypes.map((t) => [t.id, t])), [data.blockTypes]);
  const eventColor = useMemo(() => new Map(data.eventTypes.map((t) => [t.id, t.color])), [data.eventTypes]);
  const days = dateRange(data.from, data.to);
  const byDate = useMemo(() => {
    const m = new Map<string, typeof data.occurrences>();
    for (const o of data.occurrences) {
      const list = m.get(o.date) ?? [];
      list.push(o);
      m.set(o.date, list);
    }
    return m;
  }, [data]);

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="grid grid-cols-7 border-b border-neutral-200">
        {ISO_DAY_SHORT.map((d) => (
          <div key={d} className="px-1 py-1 text-center text-neutral-500">{d}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {days.map((date) => {
          const list = (byDate.get(date) ?? []).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
          const inMonth = date.startsWith(month);
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPickDay(date)}
              className={`min-h-16 space-y-0.5 border-b border-l border-neutral-100 p-1 text-left align-top ${
                inMonth ? "" : "bg-neutral-50 text-neutral-400"
              }`}
            >
              <span className={`inline-block rounded px-1 ${date === data.today ? "bg-neutral-900 text-white" : ""}`}>
                {Number(date.slice(8))}
              </span>
              {data.freeDays.some((f) => f.from_date <= date && date <= f.to_date) && <span className="ml-1">🌴</span>}
              {data.events
                .filter((e) => eventSpanOn(e, date))
                .slice(0, 2)
                .map((e) => {
                  const c = (e.event_type_id && eventColor.get(e.event_type_id)) || "#64748b";
                  return (
                    <span
                      key={e.id}
                      className="block truncate rounded-full border border-dashed px-1"
                      style={{ borderColor: c, background: alpha(c, 0.12) }}
                    >
                      {e.title}
                    </span>
                  );
                })}
              {list.slice(0, 3).map((o) => {
                const t = typeById.get(o.block_type_id);
                const color = t?.color ?? "#6366f1";
                return (
                  <span
                    key={o.id}
                    className={`block truncate rounded px-1 ${o.status === "free_day" ? "opacity-40" : ""}`}
                    style={{ background: color, color: textOn(color) }}
                  >
                    {o.start_time.slice(0, 5)} {t?.name ?? "Block"}
                  </span>
                );
              })}
              {list.length > 3 && <span className="block text-neutral-400">+{list.length - 3} more</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
