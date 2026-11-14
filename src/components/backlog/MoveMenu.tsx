"use client";

import { useState } from "react";
import { moveItemAction, type BacklogActionResult } from "@/app/backlog-actions";
import { SIZES, moveOptions, type BacklogSize, type BacklogStatus, type Caps, type Missing } from "@/lib/backlog/rules";
import { STATUS_LABEL, countsFor, type BacklogItem } from "@/lib/backlog/board";
import { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";

/** Asks only for what the move still needs (size, spec link, reason), then moves the item. */
export function MoveForm({
  item,
  to,
  missing,
  onCancel,
  onResult,
}: {
  item: BacklogItem;
  to: BacklogStatus;
  missing: Missing[];
  onCancel: () => void;
  onResult: (r: BacklogActionResult) => void;
}) {
  const [size, setSize] = useState<BacklogSize | "">(item.size ?? "");
  const [spec, setSpec] = useState(item.spec_link ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setError("");
    if (missing.includes("size") && !size) return setError("Pick a size first.");
    if (missing.includes("spec_link") && !spec.trim()) return setError("Add the spec link first.");
    if (missing.includes("reason") && !reason.trim()) return setError("Give a reason first.");
    setBusy(true);
    const r = await moveItemAction({
      number: item.number,
      to,
      size: missing.includes("size") ? (size as BacklogSize) : undefined,
      spec_link: missing.includes("spec_link") ? spec.trim() : undefined,
      parked_reason: missing.includes("reason") ? reason.trim() : undefined,
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    onResult(r);
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">
        BL-{item.number} → {STATUS_LABEL[to]}
      </p>
      {missing.includes("size") && (
        <label className="block">
          Size
          <select value={size} onChange={(e) => setSize(e.target.value as BacklogSize | "")} className={`${inputCls} mt-1`}>
            <option value="">Pick…</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s === "S" ? "S · under a day" : s === "M" ? "M · a few days" : "L · a week or more"}
              </option>
            ))}
          </select>
        </label>
      )}
      {missing.includes("spec_link") && (
        <label className="block">
          Spec link
          <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="claude/some-spec.md" className={`${inputCls} mt-1`} />
        </label>
      )}
      {missing.includes("reason") && (
        <label className="block">
          Why are we not doing it?
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One line" className={`${inputCls} mt-1`} />
        </label>
      )}
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={go} className={btnPrimary}>
          {busy ? "Moving…" : "Move"}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "Move ▾": the statuses this item can go to right now, with the plain reason when one is blocked. */
export default function MoveMenu({
  item,
  items,
  caps,
  onResult,
}: {
  item: BacklogItem;
  items: BacklogItem[];
  caps: Caps;
  onResult: (r: BacklogActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ to: BacklogStatus; missing: Missing[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = moveOptions(item, countsFor(items, item.id), caps);

  async function choose(to: BacklogStatus, missing: Missing[]) {
    if (missing.length) return setPending({ to, missing });
    setBusy(true);
    const r = await moveItemAction({ number: item.number, to });
    setBusy(false);
    setOpen(false);
    onResult(r);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => { setOpen(!open); setPending(null); }} aria-expanded={open} disabled={busy} className="compact rounded-md border border-edge px-2 py-1 text-xs transition-colors hover:bg-subtle disabled:opacity-50">
        Move ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 max-w-[85vw] rounded-xl border border-line bg-surface p-2 shadow-pop">
          {pending ? (
            <MoveForm
              item={item}
              to={pending.to}
              missing={pending.missing}
              onCancel={() => setPending(null)}
              onResult={(r) => {
                setPending(null);
                setOpen(false);
                onResult(r);
              }}
            />
          ) : (
            <ul className="space-y-1">
              {options.map((o) => (
                <li key={o.to}>
                  <button
                    type="button"
                    disabled={!o.ok}
                    onClick={() => choose(o.to, o.missing)}
                    className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="font-medium">
                      → {STATUS_LABEL[o.to]}
                      {o.reopen ? " (reopen)" : ""}
                      {o.ok && o.missing.length ? <span className="font-normal text-muted"> · needs {o.missing.map((m) => (m === "spec_link" ? "spec link" : m)).join(" + ")}</span> : null}
                    </span>
                    {!o.ok && <span className="text-xs text-muted">{o.message}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
