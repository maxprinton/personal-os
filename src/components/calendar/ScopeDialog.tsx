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
      {detail && <p className="text-sm text-neutral-600">{detail}</p>}
      <ScopeButtons occ={occ} today={today} verb={verb} onPick={onPick} />
      {!forwardLabel(occ, today) && (
        <p className="text-xs text-neutral-500">
          {occ.date < today ? "Past days only change for that day." : "This block was only for one day."}
        </p>
      )}
    </Modal>
  );
}
