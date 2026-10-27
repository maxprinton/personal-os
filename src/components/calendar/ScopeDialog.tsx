"use client";

import type { EditScope, Occurrence } from "@/lib/calendar/types";
import Modal, { btnPrimary, btnSecondary } from "@/components/calendar/Modal";
import { dayLabel } from "@/components/calendar/util";

/** Label for the "forward" option, or null when only "this day" is possible. */
export function forwardLabel(occ: Pick<Occurrence, "slot_id" | "date">, today: string) {
  if (!occ.slot_id || occ.date < today) return null;
  return occ.date === today ? "From today on" : `From ${dayLabel(occ.date)} on`;
}

/** Two buttons: "Only this day" (default) and "From today on". */
export function ScopeButtons({
  occ,
  today,
  verb,
  busy,
  onPick,
}: {
  occ: Pick<Occurrence, "slot_id" | "date">;
  today: string;
  verb: string;
  busy?: boolean;
  onPick: (scope: EditScope) => void;
}) {
  const fwd = forwardLabel(occ, today);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} autoFocus onClick={() => onPick("this_day")} className={btnPrimary}>
        {verb} only this day
      </button>
      {fwd && (
        <button type="button" disabled={busy} onClick={() => onPick("forward")} className={btnSecondary}>
          {verb} {fwd.charAt(0).toLowerCase() + fwd.slice(1)}
        </button>
      )}
    </div>
  );
}

/** Asked after dragging or resizing a block. */
export default function ScopeDialog({
  title,
  detail,
  occ,
  today,
  verb,
  onPick,
  onClose,
}: {
  title: string;
  detail?: string;
  occ: Pick<Occurrence, "slot_id" | "date">;
  today: string;
  verb: string;
  onPick: (scope: EditScope) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {detail && <p className="text-sm text-muted">{detail}</p>}
      <ScopeButtons occ={occ} today={today} verb={verb} onPick={onPick} />
      {!forwardLabel(occ, today) && (
        <p className="text-xs text-muted">
          {occ.date < today ? "Past days only change for that day." : "This block was only for one day."}
        </p>
      )}
    </Modal>
  );
}

/**
 * Asked after resizing a block: only this day, or this one and every following week on the same
 * weekday (the weekly pattern). Days changed by hand keep their own size. If the weekly change would
 * overlap another block somewhere, it says where and offers "only this day" instead.
 */
export function ResizeDialog({
  occ,
  name,
  start,
  end,
  today,
  conflict,
  onPick,
  onClose,
}: {
  occ: Pick<Occurrence, "slot_id" | "date" | "origin_date" | "start_time" | "end_time">;
  name: string;
  start: number;
  end: number;
  today: string;
  /** Why "every week" can't be done (the block was put back as it was). */
  conflict?: string | null;
  onPick: (scope: EditScope) => void;
  onClose: () => void;
}) {
  const fwd = forwardLabel(occ, today);
  // The weekday of its weekly pattern (a block moved to another day this week still belongs to its usual day)
  const weekday = new Date(`${occ.origin_date ?? occ.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const was = `${occ.start_time.slice(0, 5)}–${occ.end_time.slice(0, 5)}`;
  const now = `${hm(start)}–${hm(end)}`;
  return (
    <Modal title="Resize block" onClose={onClose}>
      <p className="text-sm">
        <span className="font-medium">{name}</span> · {dayLabel(occ.date)} · {now} <span className="text-muted">(was {was})</span>
      </p>
      {conflict ? (
        <>
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            Not every {weekday}: {conflict} The block was left as it was.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" autoFocus onClick={() => onPick("this_day")} className={btnPrimary}>
              Resize only this day
            </button>
            <button type="button" onClick={onClose} className={btnSecondary}>
              Leave it as it was
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" autoFocus onClick={() => onPick("this_day")} className={btnPrimary}>
              Only this day
            </button>
            {fwd && (
              <button type="button" onClick={() => onPick("forward")} className={btnSecondary}>
                This and every following {weekday}
              </button>
            )}
          </div>
          {fwd && (
            <p className="text-xs text-muted">
              Every following {weekday} that still has its usual size changes too (same start, new length). Days you changed by
              hand keep their own size. If another block is in the way on any of those days, nothing changes and you can resize
              only this day.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function hm(min: number) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
