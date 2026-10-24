"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { editOccurrence, toggleOccurrenceDone } from "@/app/calendar-actions";
import { addDays, dateRange, isoWeekday, minutesToTime, ISO_DAY_SHORT } from "@/lib/time";
import type { CalResult, EditScope } from "@/lib/calendar/types";
import TimeGrid, { type MoveRequest } from "@/components/calendar/TimeGrid";
import MonthGrid from "@/components/calendar/MonthGrid";
import BlockDialog from "@/components/calendar/BlockDialog";
import EventDialog from "@/components/calendar/EventDialog";
import OccurrenceDialog from "@/components/calendar/OccurrenceDialog";
import ScopeDialog from "@/components/calendar/ScopeDialog";
import { useCalendarData } from "@/components/calendar/useCalendarData";
import {
  browserToday,
  emitCalendarChanged,
  rangeFor,
  rangeLabel,
  readPref,
  shiftAnchor,
  timeRange,
  writePref,
  type View,
} from "@/components/calendar/util";

type Dialog =
  | { kind: "new-block"; date: string; start: number; end: number; name?: string }
  | { kind: "new-event"; date: string; start?: number; end?: number; title?: string }
  | { kind: "occurrence"; id: string }
  | { kind: "event"; id: string }
  | { kind: "move"; id: string; date: string; start: number; end: number }
  | null;

export default function Calendar({ variant }: { variant: "dock" | "page" }) {
  const router = useRouter();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<string>(() => browserToday());
  const [anchorSynced, setAnchorSynced] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dayStart, setDayStart] = useState(0);
  const [hidden, setHidden] = useState<number[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Desktop opens on the week, phones on the day (unless the user picked another view before)
  useEffect(() => {
    const saved = readPref(`cal.view.${variant}`);
    if (saved === "day" || saved === "week" || saved === "month") setView(saved);
    else setView(window.innerWidth >= 768 ? "week" : "day");
    const ds = Number(readPref("cal.dayStart"));
    if (Number.isInteger(ds) && ds >= 0 && ds < 1440) setDayStart(ds);
    const hd = (readPref("cal.hiddenDays") ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 7);
    setHidden(hd);
    setMounted(true);
  }, [variant]);

  const { from, to } = rangeFor(view, anchor);
  // When the day starts after midnight, the last column also shows the next morning
  const fetchTo = dayStart > 0 && view !== "month" ? addDays(to, 1) : to;
  const { data, error, loading, reload } = useCalendarData(from, fetchTo, mounted);
  const readOnly = false;

  // The server knows the user's real "today" (their timezone); follow it once
  useEffect(() => {
    if (data && !anchorSynced) {
      setAnchorSynced(true);
      if (data.today !== browserToday()) setAnchor(data.today);
    }
  }, [data, anchorSynced]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ok ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function changeView(v: View) {
    setView(v);
    writePref(`cal.view.${variant}`, v);
  }

  function changeDayStart(min: number) {
    setDayStart(min);
    writePref("cal.dayStart", String(min));
  }

  function toggleHidden(w: number) {
    const next = hidden.includes(w) ? hidden.filter((x) => x !== w) : [...hidden, w];
    if (next.length >= 7) return;
    setHidden(next);
    writePref("cal.hiddenDays", next.join(","));
  }

  /** Runs a server action; shows its error, or reloads everything on success. */
  const run = useCallback(
    async (fn: () => Promise<CalResult>): Promise<boolean> => {
      let res: CalResult;
      try {
        res = await fn();
      } catch {
        res = { error: "Could not reach the server. Check your connection." };
      }
      if (res.error) {
        setToast({ ok: false, text: res.error });
        return false;
      }
      await reload();
      emitCalendarChanged();
      router.refresh();
      return true;
    },
    [reload, router]
  );

  function onMove(req: MoveRequest) {
    if (!data) return;
    if (req.duplicate) {
      const o = data.occurrences.find((x) => x.id === req.id);
      const name = data.blockTypes.find((t) => t.id === o?.block_type_id)?.name ?? "";
      setDialog({ kind: "new-block", date: req.date, start: req.start, end: req.end, name });
      return;
    }
    setDialog({ kind: "move", id: req.id, date: req.date, start: req.start, end: req.end });
  }

  const occ =
    dialog && (dialog.kind === "occurrence" || dialog.kind === "move")
      ? data?.occurrences.find((o) => o.id === dialog.id) ?? null
      : null;
  const ev = dialog?.kind === "event" ? data?.events.find((e) => e.id === dialog.id) ?? null : null;
  const hourHeight = variant === "page" ? 48 : 36;
  const days = view === "week" ? dateRange(from, to).filter((d) => !hidden.includes(isoWeekday(d))) : dateRange(from, to);

  // Progress of the visible week/day so far (idea from the LifeOS prototype): done = 1, partial = ½
  const scored = (data?.occurrences ?? []).filter(
    (o) => o.date >= from && o.date <= to && data && o.date <= data.today && o.status !== "free_day" && o.status !== "cancelled"
  );
  const progress = scored.length
    ? Math.round((scored.reduce((s, o) => s + (o.status === "done" ? 1 : o.status === "partial" ? 0.5 : 0), 0) / scored.length) * 100)
    : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-1.5 text-sm">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} className="rounded px-2 py-0.5 hover:bg-neutral-100" aria-label="Previous">
            ‹
          </button>
          <button
            type="button"
            onClick={() => setAnchor(data?.today ?? browserToday())}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
          >
            Today
          </button>
          <button type="button" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} className="rounded px-2 py-0.5 hover:bg-neutral-100" aria-label="Next">
            ›
          </button>
        </div>
        <span className="font-medium">{rangeLabel(view, anchor)}</span>
        {progress !== null && view !== "month" && (
          <span className="flex items-center gap-1 text-xs text-neutral-500" title="Blocks done so far in this range (partly done counts half)">
            <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200">
              <span className="block h-full bg-green-600" style={{ width: `${progress}%` }} />
            </span>
            {progress}%
          </span>
        )}
        {loading && <span className="text-xs text-neutral-400">Loading…</span>}
        <div className="ml-auto flex items-center gap-2">
          {!readOnly && data && (
            <>
              <button
                type="button"
                onClick={() => setDialog({ kind: "new-block", date: view === "day" ? anchor : data.today, start: 9 * 60, end: 10 * 60 })}
                className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs text-white"
              >
                + Block
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: "new-event", date: view === "day" ? anchor : data.today })}
                className="rounded-md border border-dashed border-neutral-500 px-2 py-0.5 text-xs"
              >
                + Event
              </button>
            </>
          )}
          <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                className={`px-2 py-0.5 capitalize ${view === v ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowSettings(!showSettings)} className="rounded px-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="View settings" title="View settings">
            ⚙
          </button>
        </div>
        {showSettings && (
          <div className="flex w-full flex-wrap items-center gap-3 border-t border-neutral-100 pt-1.5 text-xs text-neutral-600">
            <label className="flex items-center gap-1">
              Day starts at
              <select value={dayStart} onChange={(e) => changeDayStart(Number(e.target.value))} className="rounded border border-neutral-300 px-1 py-0.5">
                {Array.from({ length: 13 }, (_, h) => h * 60).map((m) => (
                  <option key={m} value={m}>
                    {minutesToTime(m)}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex items-center gap-1">
              Show in week:
              {ISO_DAY_SHORT.map((d, i) => (
                <label key={d} className="flex items-center gap-0.5">
                  <input type="checkbox" checked={!hidden.includes(i + 1)} onChange={() => toggleHidden(i + 1)} />
                  {d}
                </label>
              ))}
            </span>
          </div>
        )}
      </div>

      {error && !data && <p className="p-4 text-sm text-red-600">{error}</p>}
      {data && (
        <div className="min-h-0 flex-1">
          {view === "month" ? (
            <MonthGrid
              data={data}
              month={anchor.slice(0, 7)}
              onPickDay={(d) => {
                setAnchor(d);
                changeView("day");
              }}
            />
          ) : (
            <TimeGrid
              days={days}
              data={data}
              hourHeight={hourHeight}
              dayStart={dayStart}
              readOnly={readOnly}
              onCreate={(date, start, end) => setDialog({ kind: "new-block", date, start, end })}
              onCreateEvent={(date) => setDialog({ kind: "new-event", date })}
              onOpenOccurrence={(id) => setDialog({ kind: "occurrence", id })}
              onOpenEvent={(id) => setDialog({ kind: "event", id })}
              onMoveOccurrence={onMove}
              onToggleDone={(id) => run(() => toggleOccurrenceDone({ occurrenceId: id }))}
              onBlocked={(text) => setToast({ ok: false, text })}
              onPickDay={(d) => {
                setAnchor(d);
                changeView("day");
              }}
            />
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`absolute bottom-3 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg px-3 py-2 text-sm shadow-lg ${
            toast.ok ? "bg-neutral-900 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}

      {data && dialog?.kind === "new-block" && (
        <BlockDialog
          date={dialog.date}
          start={dialog.start}
          end={dialog.end}
          initialName={dialog.name}
          blockTypes={data.blockTypes}
          run={run}
          onClose={() => setDialog(null)}
          onMakeEvent={(date, start, end, title) =>
            setDialog({
              kind: "new-event",
              date,
              start: Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)),
              end: Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)),
              title,
            })
          }
        />
      )}
      {data && dialog?.kind === "new-event" && (
        <EventDialog
          initial={{ date: dialog.date, start: dialog.start, end: dialog.end, title: dialog.title }}
          eventTypes={data.eventTypes}
          readOnly={readOnly}
          run={run}
          onClose={() => setDialog(null)}
        />
      )}
      {data && dialog?.kind === "event" && ev && (
        <EventDialog event={ev} eventTypes={data.eventTypes} readOnly={readOnly} run={run} onClose={() => setDialog(null)} />
      )}
      {data && dialog?.kind === "occurrence" && occ && (
        <OccurrenceDialog occ={occ} data={data} readOnly={readOnly} run={run} onClose={() => setDialog(null)} />
      )}
      {data && dialog?.kind === "move" && occ && (
        <ScopeDialog
          title="Move block"
          detail={`${dialog.date} · ${timeRange(dialog.start, dialog.end)}`}
          occ={occ}
          today={data.today}
          verb="Move"
          onClose={() => setDialog(null)}
          onPick={async (scope: EditScope) => {
            const d = dialog as Extract<Dialog, { kind: "move" }>;
            setDialog(null);
            await run(() =>
              editOccurrence({ id: d.id, date: d.date, start: minutesToTime(d.start), end: minutesToTime(d.end), scope })
            );
          }}
        />
      )}
    </div>
  );
}
