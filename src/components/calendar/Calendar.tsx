"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { editOccurrence } from "@/app/calendar-actions";
import { dateRange, minutesToTime } from "@/lib/time";
import type { CalResult, EditScope } from "@/lib/calendar/types";
import TimeGrid from "@/components/calendar/TimeGrid";
import MonthGrid from "@/components/calendar/MonthGrid";
import BlockDialog from "@/components/calendar/BlockDialog";
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
  | { kind: "new-block"; date: string; start: number; end: number }
  | { kind: "occurrence"; id: string }
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

  // Desktop opens on the week, phones on the day (unless the user picked another view before)
  useEffect(() => {
    const saved = readPref(`cal.view.${variant}`);
    if (saved === "day" || saved === "week" || saved === "month") setView(saved);
    else setView(window.innerWidth >= 768 ? "week" : "day");
    setMounted(true);
  }, [variant]);

  const { from, to } = rangeFor(view, anchor);
  const { data, error, loading, reload } = useCalendarData(from, to, mounted);
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

  const occ = dialog && (dialog.kind === "occurrence" || dialog.kind === "move")
    ? data?.occurrences.find((o) => o.id === dialog.id) ?? null
    : null;
  const hourHeight = variant === "page" ? 48 : 36;

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
        {loading && <span className="text-xs text-neutral-400">Loading…</span>}
        <div className="ml-auto flex items-center gap-2">
          {!readOnly && data && (
            <button
              type="button"
              onClick={() => setDialog({ kind: "new-block", date: view === "day" ? anchor : data.today, start: 9 * 60, end: 10 * 60 })}
              className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs text-white"
            >
              + Block
            </button>
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
        </div>
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
              days={dateRange(from, to)}
              data={data}
              hourHeight={hourHeight}
              readOnly={readOnly}
              onCreate={(date, start, end) => setDialog({ kind: "new-block", date, start, end })}
              onOpenOccurrence={(id) => setDialog({ kind: "occurrence", id })}
              onMoveOccurrence={(id, date, start, end) => setDialog({ kind: "move", id, date, start, end })}
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
          blockTypes={data.blockTypes}
          run={run}
          onClose={() => setDialog(null)}
        />
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
