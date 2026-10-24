"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { durationOf, spanOn } from "@/lib/calendar/overlap";
import type { CalendarData, Occurrence } from "@/lib/calendar/types";
import { alpha, dayLabel, snap, textOn, timeRange } from "@/components/calendar/util";

type Props = {
  days: string[];
  data: CalendarData;
  hourHeight: number;
  readOnly: boolean;
  onCreate: (date: string, start: number, end: number) => void;
  onOpenOccurrence: (id: string) => void;
  onMoveOccurrence: (id: string, date: string, start: number, end: number) => void;
  onPickDay?: (date: string) => void;
};

type Drag = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  dayIdx: number;
  start: number;
  duration: number;
  grab: number; // minutes between the block's top and the pointer
  moved: boolean;
};

type Preview = { id: string; dayIdx: number; start: number; end: number };

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number) {
  if (h === 0) return "";
  const ap = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}${ap}`;
}

export default function TimeGrid({
  days,
  data,
  hourHeight: H,
  readOnly,
  onCreate,
  onOpenOccurrence,
  onMoveOccurrence,
  onPickDay,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const typeById = useMemo(() => new Map(data.blockTypes.map((t) => [t.id, t])), [data.blockTypes]);

  // Start scrolled near the current hour (or 7am on other days)
  const firstDay = days[0];
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = days.includes(data.today);
    const minute = showsToday ? data.nowMinutes - 60 : 7 * 60;
    el.scrollTop = Math.max(0, (minute / 60) * H);
    // only when the visible range changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length, H]);

  const perDay = useMemo(
    () =>
      days.map((date) =>
        data.occurrences
          .map((o) => ({ o, span: spanOn(o, date) }))
          .filter((x): x is { o: Occurrence; span: NonNullable<ReturnType<typeof spanOn>> } => x.span !== null)
      ),
    [days, data.occurrences]
  );

  function columnAt(clientX: number) {
    let best = 0;
    let bestDist = Infinity;
    colRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        best = i;
        bestDist = 0;
      } else {
        const d = Math.min(Math.abs(clientX - r.left), Math.abs(clientX - r.right));
        if (d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
    });
    return best;
  }

  function minuteAt(dayIdx: number, clientY: number) {
    const el = colRefs.current[dayIdx];
    if (!el) return 0;
    return ((clientY - el.getBoundingClientRect().top) / H) * 60;
  }

  function startDrag(e: React.PointerEvent, o: Occurrence, dayIdx: number, start: number, mode: Drag["mode"]) {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: o.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      dayIdx,
      start,
      duration: durationOf(o.start_time, o.end_time),
      grab: minuteAt(dayIdx, e.clientY) - start,
      moved: false,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 5) return;
    d.moved = true;
    if (d.mode === "move") {
      const dayIdx = columnAt(e.clientX);
      const start = Math.min(Math.max(0, snap(minuteAt(dayIdx, e.clientY) - d.grab)), 1440 - 15);
      setPreview({ id: d.id, dayIdx, start, end: start + d.duration });
    } else {
      const end = Math.max(d.start + 15, Math.min(1440, snap(minuteAt(d.dayIdx, e.clientY))));
      setPreview({ id: d.id, dayIdx: d.dayIdx, start: d.start, end });
    }
  }

  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    e.stopPropagation();
    const p = preview;
    setPreview(null);
    if (!d.moved) {
      onOpenOccurrence(d.id);
      return;
    }
    if (p) onMoveOccurrence(d.id, days[p.dayIdx], p.start, p.end);
  }

  function clickEmpty(e: React.MouseEvent<HTMLDivElement>, dayIdx: number) {
    if (readOnly || e.target !== e.currentTarget) return;
    const start = Math.min(snap(minuteAt(dayIdx, e.clientY) - 15, 30), 1440 - 30);
    onCreate(days[dayIdx], Math.max(0, start), Math.min(1440, Math.max(0, start) + 60));
  }

  const lines = `repeating-linear-gradient(to bottom, #e5e5e5 0, #e5e5e5 1px, transparent 1px, transparent ${H}px)`;

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex border-b border-neutral-200 pr-[var(--sbw,0px)]">
        <div className="w-12 shrink-0" />
        {days.map((date) => (
          <button
            key={date}
            type="button"
            onClick={() => onPickDay?.(date)}
            className={`flex-1 truncate border-l border-neutral-100 px-1 py-1 text-center ${
              date === data.today ? "font-semibold text-neutral-900" : "text-neutral-500"
            }`}
          >
            {dayLabel(date)}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * H }}>
          <div className="relative w-12 shrink-0">
            {HOURS.map((h) => (
              <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-neutral-400" style={{ top: h * H }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>

          {days.map((date, dayIdx) => (
            <div
              key={date}
              ref={(el) => {
                colRefs.current[dayIdx] = el;
              }}
              onClick={(e) => clickEmpty(e, dayIdx)}
              className={`relative flex-1 border-l border-neutral-100 ${readOnly ? "" : "cursor-cell"} ${
                date < data.today ? "bg-neutral-50/60" : ""
              }`}
              style={{ backgroundImage: lines }}
            >
              {perDay[dayIdx].map(({ o, span }) => {
                const type = typeById.get(o.block_type_id);
                const color = type?.color ?? "#6366f1";
                const dragging = preview?.id === o.id;
                const top = (span.start / 60) * H;
                const height = Math.max(((span.end - span.start) / 60) * H, 14);
                const muted = o.status === "free_day";
                return (
                  <div
                    key={`${o.id}-${date}`}
                    onPointerDown={(e) => !span.continued && startDrag(e, o, dayIdx, span.start, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (readOnly || span.continued) onOpenOccurrence(o.id);
                    }}
                    title={`${type?.name ?? "Block"} · ${timeRange(span.start, span.end)}`}
                    className={`absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 shadow-sm ${
                      readOnly || span.continued ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
                    } ${dragging ? "opacity-40" : ""}`}
                    style={{
                      top,
                      height,
                      background: muted ? alpha(color, 0.18) : color,
                      color: muted ? "#525252" : textOn(color),
                      touchAction: readOnly ? "auto" : "none",
                    }}
                  >
                    <p className="truncate font-medium leading-tight">
                      {o.status === "done" ? "✓ " : o.status === "partial" ? "◐ " : ""}
                      {type?.name ?? "Block"}
                      {muted ? " · free day" : ""}
                    </p>
                    {height >= 28 && (
                      <p className="truncate leading-tight opacity-80">
                        {span.continued ? "…" : ""}
                        {timeRange(span.start, span.end)}
                        {span.continues ? "…" : ""}
                      </p>
                    )}
                    {!readOnly && !span.continued && !span.continues && (
                      <div
                        onPointerDown={(e) => startDrag(e, o, dayIdx, span.start, "resize")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      />
                    )}
                  </div>
                );
              })}

              {preview && preview.dayIdx === dayIdx && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-dashed border-neutral-900 bg-white/60 px-1.5 py-0.5"
                  style={{
                    top: (preview.start / 60) * H,
                    height: Math.max(((Math.min(preview.end, 1440) - preview.start) / 60) * H, 14),
                  }}
                >
                  <p className="truncate font-medium">{timeRange(preview.start, preview.end)}</p>
                </div>
              )}

              {date === data.today && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                  style={{ top: (data.nowMinutes / 60) * H }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
