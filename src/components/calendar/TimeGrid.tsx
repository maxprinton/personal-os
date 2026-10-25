"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, daysBetween, minutesToTime, timeToMinutes } from "@/lib/time";
import { assignLanes, durationOf, eventSpanOn, findOccurrenceConflict } from "@/lib/calendar/overlap";
import { habitProgress, habitsForOccurrence } from "@/lib/calendar/habitview";
import { tasksForEvent, tasksForOccurrence } from "@/lib/calendar/taskview";
import type { CalendarData, CalEvent, Occurrence } from "@/lib/calendar/types";
import { alpha, dayLabel, snap, textOn, timeRange } from "@/components/calendar/util";

export type MoveRequest = { id: string; date: string; start: number; end: number; duplicate: boolean };
export type TaskDrop = { taskId: string; occurrenceId?: string; eventId?: string; date: string };
export type GroupShift = { dayShift: number; minuteShift: number };

/** A block moved by whole days and minutes (used to preview a multi-block drag). */
function shiftOcc(o: Occurrence, { dayShift, minuteShift }: GroupShift): Occurrence {
  const startAbs = timeToMinutes(o.start_time) + minuteShift;
  const start = ((startAbs % 1440) + 1440) % 1440;
  return {
    ...o,
    date: addDays(o.date, dayShift + Math.floor(startAbs / 1440)),
    start_time: minutesToTime(start),
    end_time: minutesToTime(start + durationOf(o.start_time, o.end_time)),
  };
}

/** Drag data type used for tasks (the unassigned tray and task lines inside blocks). */
export const TASK_MIME = "text/x-personal-os-task";

type Props = {
  days: string[];
  data: CalendarData;
  hourHeight: number;
  /** Minutes after midnight where each column starts (e.g. 360 = the day starts at 6:00). */
  dayStart: number;
  readOnly: boolean;
  onCreate: (date: string, start: number, end: number) => void;
  onCreateEvent: (date: string) => void;
  onOpenOccurrence: (id: string) => void;
  onOpenEvent: (id: string) => void;
  onMoveOccurrence: (req: MoveRequest) => void;
  onToggleDone: (occurrenceId: string) => void;
  onDropTask: (drop: TaskDrop) => void;
  onOpenFreeDay: (id: string) => void;
  onBlocked: (message: string) => void;
  onPickDay?: (date: string) => void;
  /** Multi-select: Ctrl/⌘/Shift+click adds or removes a block; dragging a selected block moves them all. */
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onMoveGroup: (shift: GroupShift) => void;
  onClearSelection: () => void;
  /** What a plain click on a block does: open its details (default) or tick it done, like LifeOS. */
  clickMode: "open" | "done";
};

type Drag = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  col: number;
  top: number; // column minutes (0..1440) of the block top when the drag started
  duration: number;
  grab: number;
  moved: boolean;
  group: boolean;
};

type Preview = { id: string; col: number; top: number; bottom: number; conflict: boolean };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const EVENT_GRAY = "#64748b";

/** [a, b) in minutes measured from the column date's midnight. */
function occAbs(o: Occurrence, colDate: string): [number, number] {
  const a = daysBetween(colDate, o.date) * 1440 + timeToMinutes(o.start_time);
  return [a, a + durationOf(o.start_time, o.end_time)];
}

function eventAbs(e: CalEvent, colDate: string): [number, number] | null {
  if (e.start === null || e.end === null) return null;
  return [daysBetween(colDate, e.date) * 1440 + e.start, daysBetween(colDate, e.end_date) * 1440 + e.end];
}

/** Clip [a, b) to the column window [S, S + 1440) and return column minutes, or null. */
function clip(a: number, b: number, S: number) {
  const top = Math.max(a, S) - S;
  const bottom = Math.min(b, S + 1440) - S;
  if (bottom <= top) return null;
  return { top, bottom, cutTop: a < S, cutBottom: b > S + 1440 };
}

export default function TimeGrid({
  days,
  data,
  hourHeight: H,
  dayStart: S,
  readOnly,
  onCreate,
  onCreateEvent,
  onOpenOccurrence,
  onOpenEvent,
  onMoveOccurrence,
  onToggleDone,
  onDropTask,
  onOpenFreeDay,
  onBlocked,
  onPickDay,
  selected,
  onToggleSelect,
  onMoveGroup,
  onClearSelection,
  clickMode,
}: Props) {
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dropHandlers = (key: string, target: Omit<TaskDrop, "taskId">) =>
    readOnly
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(TASK_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropOn !== key) setDropOn(key);
          },
          onDragLeave: () => setDropOn((k) => (k === key ? null : k)),
          onDrop: (e: React.DragEvent) => {
            const taskId = e.dataTransfer.getData(TASK_MIME);
            setDropOn(null);
            if (!taskId) return;
            e.preventDefault();
            e.stopPropagation();
            onDropTask({ taskId, ...target });
          },
        };
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const pointerRef = useRef<{ x: number; y: number; alt: boolean } | null>(null);
  const scrollLoop = useRef<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [groupPreview, setGroupPreview] = useState<(GroupShift & { conflict: boolean }) | null>(null);
  const selectedOccs = useMemo(() => data.occurrences.filter((o) => selected.has(o.id)), [data.occurrences, selected]);

  const typeById = useMemo(() => new Map(data.blockTypes.map((t) => [t.id, t])), [data.blockTypes]);
  const eventColor = useMemo(() => {
    const m = new Map(data.eventTypes.map((t) => [t.id, t.color]));
    return (e: CalEvent) => (e.event_type_id ? m.get(e.event_type_id) ?? EVENT_GRAY : EVENT_GRAY);
  }, [data.eventTypes]);

  /** Column date + column minute -> real date + minute of that date. */
  const toReal = (col: number, y: number) => {
    const abs = S + y;
    return { date: addDays(days[col], Math.floor(abs / 1440)), minute: ((abs % 1440) + 1440) % 1440 };
  };

  // Start scrolled near the current hour (or 7am)
  const firstDay = days[0];
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = days.includes(data.today) ? data.nowMinutes - 60 : 7 * 60;
    const y = (((target - S) % 1440) + 1440) % 1440;
    el.scrollTop = Math.max(0, (y / 60) * H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length, H, S]);

  const blocksPerCol = useMemo(
    () =>
      days.map((date) =>
        data.occurrences.flatMap((o) => {
          const [a, b] = occAbs(o, date);
          const c = clip(a, b, S);
          return c ? [{ o, ...c, realStart: a }] : [];
        })
      ),
    [days, data.occurrences, S]
  );

  const eventsPerCol = useMemo(
    () =>
      days.map((date) => {
        const timed = data.events.flatMap((e) => {
          const abs = eventAbs(e, date);
          if (!abs) return [];
          const c = clip(abs[0], abs[1], S);
          return c ? [{ e, start: c.top, end: c.bottom }] : [];
        });
        return assignLanes(timed);
      }),
    [days, data.events, S]
  );

  const allDayPerCol = useMemo(
    () => days.map((date) => data.events.filter((e) => eventSpanOn(e, date)?.allDay)),
    [days, data.events]
  );
  const hasAllDay = allDayPerCol.some((l) => l.length > 0);

  function columnAt(clientX: number) {
    let best = 0;
    let bestDist = Infinity;
    colRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }

  function minuteAt(col: number, clientY: number) {
    const el = colRefs.current[col];
    if (!el) return 0;
    return ((clientY - el.getBoundingClientRect().top) / H) * 60;
  }

  /** Speed of the auto-scroll: faster the closer the pointer is to the edge (LifeOS feel). 0 = not near an edge. */
  function edgeSpeed(clientY: number) {
    const el = scrollRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const ZONE = 60;
    const MAX = 15;
    if (clientY < r.top + ZONE) return -MAX * (1 - Math.max(0, clientY - r.top) / ZONE);
    if (clientY > r.bottom - ZONE) return MAX * (1 - Math.max(0, r.bottom - clientY) / ZONE);
    return 0;
  }

  /** Keeps scrolling while the pointer rests near an edge during a drag, updating the preview as it goes. */
  function runScrollLoop() {
    if (scrollLoop.current !== null) return;
    const tick = () => {
      const d = dragRef.current;
      const p = pointerRef.current;
      const el = scrollRef.current;
      const speed = d?.moved && p ? edgeSpeed(p.y) : 0;
      if (!d || !p || !el || speed === 0) {
        scrollLoop.current = null;
        return;
      }
      el.scrollTop += speed;
      updateDrag(p.x, p.y, p.alt);
      scrollLoop.current = requestAnimationFrame(tick);
    };
    scrollLoop.current = requestAnimationFrame(tick);
  }

  function stopScrollLoop() {
    if (scrollLoop.current !== null) cancelAnimationFrame(scrollLoop.current);
    scrollLoop.current = null;
  }

  function conflictFor(id: string, col: number, top: number, bottom: number) {
    const { date, minute } = toReal(col, top);
    return Boolean(
      findOccurrenceConflict(
        { date, start_time: minutesToTime(minute), end_time: minutesToTime(minute + (bottom - top)) },
        data.occurrences,
        new Set([id])
      )
    );
  }

  function startDrag(e: React.PointerEvent, o: Occurrence, col: number, top: number, mode: Drag["mode"]) {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    // Grabbing a block that isn't selected drops the old selection (as in LifeOS); Ctrl/⌘/Shift keep it
    const modifier = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!modifier && selected.size > 0 && !selected.has(o.id)) onClearSelection();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: o.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      col,
      top,
      duration: durationOf(o.start_time, o.end_time),
      grab: minuteAt(col, e.clientY) - top,
      moved: false,
      group: mode === "move" && selected.has(o.id) && selected.size > 1,
    };
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    pointerRef.current = { x: e.clientX, y: e.clientY, alt: e.altKey };
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 5) return;
    d.moved = true;
    updateDrag(e.clientX, e.clientY, e.altKey);
    if (edgeSpeed(e.clientY) !== 0) runScrollLoop();
  }

  /** Recomputes the drag preview for a pointer position (also called while auto-scrolling). */
  function updateDrag(clientX: number, clientY: number, altKey: boolean) {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === "move" && d.group) {
      const col = columnAt(clientX);
      const top = Math.min(Math.max(0, snap(minuteAt(col, clientY) - d.grab)), 1440 - 15);
      const shift = { dayShift: daysBetween(days[d.col], days[col]), minuteShift: top - d.top };
      const conflict = selectedOccs.some((o) => Boolean(findOccurrenceConflict(shiftOcc(o, shift), data.occurrences, selected)));
      setGroupPreview({ ...shift, conflict });
    } else if (d.mode === "move") {
      const col = columnAt(clientX);
      const top = Math.min(Math.max(0, snap(minuteAt(col, clientY) - d.grab)), 1440 - 15);
      const bottom = top + d.duration;
      setPreview({ id: d.id, col, top, bottom, conflict: !altKey && conflictFor(d.id, col, top, bottom) });
    } else {
      const bottom = Math.max(d.top + 15, Math.min(d.top + 1440 - 5, snap(minuteAt(d.col, clientY))));
      setPreview({ id: d.id, col: d.col, top: d.top, bottom, conflict: conflictFor(d.id, d.col, d.top, bottom) });
    }
  }

  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    pointerRef.current = null;
    stopScrollLoop();
    if (!d) return;
    e.stopPropagation();
    const p = preview;
    const gp = groupPreview;
    setPreview(null);
    setGroupPreview(null);
    if (!d.moved) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) onToggleSelect(d.id);
      else clickBlock(d.id);
      return;
    }
    if (d.group) {
      if (!gp || (!gp.dayShift && !gp.minuteShift)) return;
      if (e.altKey) {
        onBlocked("Alt+drag copies one block at a time. Clear the selection to copy a block.");
        return;
      }
      if (gp.conflict) {
        onBlocked("That time is taken: blocks can't overlap.");
        return;
      }
      onMoveGroup({ dayShift: gp.dayShift, minuteShift: gp.minuteShift });
      return;
    }
    if (!p) return;
    const duplicate = d.mode === "move" && e.altKey;
    if (p.conflict && !duplicate) {
      onBlocked("That time is taken: blocks can't overlap.");
      return;
    }
    const { date, minute } = toReal(p.col, p.top);
    onMoveOccurrence({ id: d.id, date, start: minute, end: minute + (p.bottom - p.top), duplicate });
  }

  /** Plain click on a block: open it, or (click mode "done") tick it done / undo, like LifeOS. */
  function clickBlock(id: string) {
    if (readOnly || clickMode === "open") {
      onOpenOccurrence(id);
      return;
    }
    const o = data.occurrences.find((x) => x.id === id);
    if (!o || o.status === "free_day") {
      onOpenOccurrence(id);
      return;
    }
    if (o.date > data.today) {
      onBlocked("This block's day hasn't come yet. Use ✏️ to edit it.");
      return;
    }
    onToggleDone(id);
  }

  function clickEmpty(e: React.MouseEvent<HTMLDivElement>, col: number) {
    if (readOnly || e.target !== e.currentTarget) return;
    const y = Math.min(Math.max(0, snap(minuteAt(col, e.clientY) - 15, 30)), 1440 - 30);
    const { date, minute } = toReal(col, y);
    onCreate(date, minute, minute + 60);
  }

  const lines = `repeating-linear-gradient(to bottom, #e5e5e5 0, #e5e5e5 1px, transparent 1px, transparent ${H}px)`;
  // Where "now" is drawn: today's column, or yesterday's when the day starts later than now
  const nowCol = data.nowMinutes >= S ? data.today : addDays(data.today, -1);
  const nowY = data.nowMinutes >= S ? data.nowMinutes - S : data.nowMinutes + 1440 - S;

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex border-b border-neutral-200">
        <div className="w-12 shrink-0" />
        {days.map((date, col) => (
          <div key={date} className="min-w-0 flex-1 border-l border-neutral-100">
            <button
              type="button"
              onClick={() => onPickDay?.(date)}
              className={`block w-full truncate px-1 py-1 text-center ${
                date === data.today ? "font-semibold text-neutral-900" : "text-neutral-500"
              }`}
            >
              {dayLabel(date)}
            </button>
            {(() => {
              const free = data.freeDays.find((f) => f.from_date <= date && date <= f.to_date);
              return free ? (
                <button
                  type="button"
                  onClick={() => onOpenFreeDay(free.id)}
                  className="mx-0.5 mb-0.5 block w-[calc(100%-4px)] truncate rounded bg-emerald-100 px-1 text-[11px] text-emerald-800"
                  title={free.note ?? "Free day"}
                >
                  🌴 {free.note ?? "Free day"}
                </button>
              ) : null;
            })()}
            {(hasAllDay || !readOnly) && (
              <div
                className={`flex min-h-5 flex-col gap-0.5 px-0.5 pb-1 ${readOnly ? "" : "cursor-cell"}`}
                onClick={(e) => {
                  if (!readOnly && e.target === e.currentTarget) onCreateEvent(date);
                }}
                title={readOnly ? undefined : "Click to add an event without time"}
              >
                {allDayPerCol[col].map((ev) => {
                  const c = eventColor(ev);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpenEvent(ev.id)}
                      className="truncate rounded-full border px-1.5 text-left text-[11px]"
                      style={{ background: alpha(c, 0.15), borderColor: c, color: "#262626" }}
                      title={ev.title}
                    >
                      {ev.is_payment ? (ev.payment_status === "paid" ? "✓💳 " : ev.payment_status === "skipped" ? "–💳 " : "💳 ") : ""}
                      {ev.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * H }}>
          <div className="relative w-12 shrink-0">
            {HOURS.map((h) => {
              const abs = S + h * 60;
              const hour = Math.floor(abs / 60) % 24;
              const next = abs >= 1440;
              return (
                <span
                  key={h}
                  className={`absolute right-1 -translate-y-1/2 text-[10px] ${next ? "text-neutral-500" : "text-neutral-400"}`}
                  style={{ top: h * H }}
                >
                  {h === 0 && S === 0 ? "" : `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"}${next ? " +1d" : ""}`}
                </span>
              );
            })}
          </div>

          {days.map((date, col) => (
            <div
              key={date}
              ref={(el) => {
                colRefs.current[col] = el;
              }}
              onClick={(e) => clickEmpty(e, col)}
              className={`relative min-w-0 flex-1 border-l border-neutral-100 ${readOnly ? "" : "cursor-cell"} ${
                date < data.today ? "bg-neutral-50/60" : ""
              }`}
              style={{ backgroundImage: lines }}
            >
              {S > 0 && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-neutral-300"
                  style={{ top: ((1440 - S) / 60) * H }}
                />
              )}

              {/* Blocks */}
              {blocksPerCol[col].map(({ o, top, bottom, cutTop, cutBottom }) => {
                const type = typeById.get(o.block_type_id);
                const color = type?.color ?? "#6366f1";
                const dragging = preview?.id === o.id || (groupPreview !== null && selected.has(o.id));
                const isSelected = selected.has(o.id);
                const height = Math.max(((bottom - top) / 60) * H, 14);
                const muted = o.status === "free_day";
                const realStart = timeToMinutes(o.start_time);
                const realEnd = realStart + durationOf(o.start_time, o.end_time);
                const hp = habitProgress(habitsForOccurrence(o, data.habits, data.checks, data.today));
                const canTick = !readOnly && !cutTop && !muted && o.date <= data.today;
                const blockTasks = cutTop ? [] : tasksForOccurrence(o, data.occurrences, data.tasks);
                const taskRows = Math.max(0, Math.floor((height - 30) / 14));
                return (
                  <div
                    key={`${o.id}-${date}`}
                    onPointerDown={(e) => !cutTop && startDrag(e, o, col, top, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    {...(o.date >= data.today && !muted ? dropHandlers(`occ-${o.id}-${date}`, { occurrenceId: o.id, date: o.date }) : {})}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!readOnly && cutTop && (e.ctrlKey || e.metaKey || e.shiftKey)) onToggleSelect(o.id);
                      else if (readOnly) onOpenOccurrence(o.id);
                      else if (cutTop) clickBlock(o.id);
                    }}
                    title={`${type?.name ?? "Block"} · ${timeRange(realStart, realEnd)}${
                      readOnly ? "" : clickMode === "done" ? " · click = done/undo · ✏️ = edit · Ctrl+click = select" : " · Ctrl+click to select several"
                    }`}
                    className={`absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 shadow-sm ${
                      readOnly || cutTop ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
                    } ${dragging ? "opacity-40" : ""} ${
                      dropOn === `occ-${o.id}-${date}`
                        ? "ring-2 ring-neutral-900 ring-offset-1"
                        : isSelected
                          ? "ring-2 ring-sky-500 ring-offset-1"
                          : ""
                    }`}
                    style={{
                      top: (top / 60) * H,
                      height,
                      background: muted ? alpha(color, 0.18) : color,
                      color: muted ? "#525252" : textOn(color),
                      touchAction: readOnly ? "auto" : "none",
                    }}
                  >
                    <p className={`truncate font-medium leading-tight ${canTick || (!readOnly && clickMode === "done") ? "pr-4" : ""}`}>
                      {o.status === "done" ? "✓ " : o.status === "partial" ? "◐ " : ""}
                      {type?.name ?? "Block"}
                      {muted ? " · free day" : ""}
                      {hp.all > 0 && !muted ? <span className="ml-1 font-normal opacity-80">{hp.done}/{hp.total}</span> : null}
                      {blockTasks.length > 0 && taskRows === 0 ? (
                        <span className="ml-1 font-normal opacity-80">· {blockTasks.length} task{blockTasks.length > 1 ? "s" : ""}</span>
                      ) : null}
                    </p>
                    {!readOnly && clickMode === "done" && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenOccurrence(o.id);
                        }}
                        title="Edit this block"
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center text-[10px] leading-none opacity-70 hover:opacity-100"
                      >
                        ✏️
                      </button>
                    )}
                    {canTick && clickMode === "open" && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleDone(o.id);
                        }}
                        title={o.status === "done" ? "Undo done" : "Mark block done (ticks all its habits)"}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none opacity-70 hover:opacity-100"
                      >
                        {o.status === "done" ? "✓" : ""}
                      </button>
                    )}
                    {height >= 28 && (
                      <p className="truncate leading-tight opacity-80">
                        {cutTop ? "…" : ""}
                        {timeRange(realStart, realEnd)}
                        {cutBottom ? "…" : ""}
                      </p>
                    )}
                    {taskRows > 0 &&
                      blockTasks.slice(0, taskRows).map((t) => (
                        <p
                          key={t.id}
                          draggable={!readOnly && t.status === "pending"}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(TASK_MIME, t.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className={`truncate leading-tight ${t.status === "completed" ? "line-through opacity-60" : ""} ${
                            !readOnly && t.status === "pending" ? "cursor-move" : ""
                          }`}
                          title={t.moved ? `${t.title} · moved ${t.moved}×` : t.title}
                        >
                          {t.status === "completed" ? "☑" : "☐"} {t.title}
                          {t.moved > 0 ? ` (${t.moved}×)` : ""}
                        </p>
                      ))}
                    {taskRows > 0 && blockTasks.length > taskRows && (
                      <p className="truncate leading-tight opacity-70">+{blockTasks.length - taskRows} more</p>
                    )}
                    {!readOnly && !cutTop && !cutBottom && (
                      <div
                        onPointerDown={(e) => startDrag(e, o, col, top, "resize")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      />
                    )}
                  </div>
                );
              })}

              {/* Events: a translucent, dashed layer on top. Only the title strip is clickable,
                  so the blocks underneath stay easy to grab. */}
              {eventsPerCol[col].placed.map(({ item, lane }) => {
                const { e, start, end } = item;
                const c = eventColor(e);
                const lanes = eventsPerCol[col].lanes;
                const evTasks = tasksForEvent(e.id, date, data.tasks);
                const dropKey = `ev-${e.id}-${date}`;
                return (
                  <div
                    key={`ev-${e.id}-${date}`}
                    className="pointer-events-none absolute z-20 rounded-md border-2 border-dashed"
                    style={{
                      top: (start / 60) * H,
                      height: Math.max(((end - start) / 60) * H, 16),
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                      background: alpha(c, 0.14),
                      borderColor: c,
                    }}
                  >
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpenEvent(e.id);
                      }}
                      {...(date >= data.today ? dropHandlers(dropKey, { eventId: e.id, date }) : {})}
                      className={`pointer-events-auto block max-w-full truncate rounded-br px-1 text-left text-[11px] font-medium ${
                        dropOn === dropKey ? "ring-2 ring-neutral-900" : ""
                      }`}
                      style={{ background: alpha(c, 0.85), color: textOn(c) }}
                      title={`${e.title}${evTasks.length ? ` · ${evTasks.length} task(s)` : ""} — drop a task here to put it in this event`}
                    >
                      {e.title}
                      {evTasks.length > 0 ? ` · ${evTasks.filter((t) => t.status === "completed").length}/${evTasks.length} ☑` : ""}
                    </button>
                  </div>
                );
              })}

              {groupPreview &&
                selectedOccs.map((o) => {
                  const g = shiftOcc(o, groupPreview);
                  const [a, b] = occAbs(g, date);
                  const c = clip(a, b, S);
                  if (!c) return null;
                  const start = timeToMinutes(g.start_time);
                  return (
                    <div
                      key={`ghost-${o.id}-${date}`}
                      className={`pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-2 border-dashed px-1.5 py-0.5 ${
                        groupPreview.conflict ? "border-red-600 bg-red-100/80 text-red-700" : "border-sky-600 bg-white/70"
                      }`}
                      style={{ top: (c.top / 60) * H, height: Math.max(((c.bottom - c.top) / 60) * H, 14) }}
                    >
                      <p className="truncate font-medium">
                        {typeById.get(o.block_type_id)?.name ?? "Block"} · {timeRange(start, start + durationOf(o.start_time, o.end_time))}
                        {groupPreview.conflict ? " · taken" : ""}
                      </p>
                    </div>
                  );
                })}

              {preview && preview.col === col && (
                <div
                  className={`pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-2 border-dashed px-1.5 py-0.5 ${
                    preview.conflict ? "border-red-600 bg-red-100/80 text-red-700" : "border-neutral-900 bg-white/70"
                  }`}
                  style={{
                    top: (preview.top / 60) * H,
                    height: Math.max(((Math.min(preview.bottom, 1440) - preview.top) / 60) * H, 14),
                  }}
                >
                  <p className="truncate font-medium">
                    {timeRange(toReal(col, preview.top).minute, toReal(col, preview.top).minute + preview.bottom - preview.top)}
                    {preview.conflict ? " · taken" : ""}
                  </p>
                </div>
              )}

              {date === nowCol && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                  style={{ top: (nowY / 60) * H }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
