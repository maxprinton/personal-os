"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { removeSeries, saveSeries, setSeriesActive } from "@/app/series-actions";
import type { ActionState } from "@/app/actions";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import { WritingInput } from "@/components/WritingField";
import { emitCalendarChanged } from "@/components/calendar/util";

type Option = { value: string; label: string };

export type SeriesRowData = {
  id: string;
  title: string;
  every: number;
  unit: string;
  label: string; // "Every 3 days after done"
  policy: string;
  active: boolean;
  homeBlockId: string | null;
  homeBlockName: string | null;
  status: string;
  late: boolean;
  lastDoneOn: string | null;
  history: string[];
  avgGap: number | null;
};

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One recurring task: what it is, when it is due, and Edit / Pause / Stop. */
export default function SeriesRow({ series: s, blockOptions }: { series: SeriesRowData; blockOptions: Option[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  async function act(fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setNote(r.error ? { ok: false, text: r.error } : r.message ? { ok: true, text: r.message } : null);
    if (!r.error) {
      emitCalendarChanged();
      router.refresh();
    }
  }

  const btn = "compact rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-50";
  return (
    <li className={`rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-edge ${s.active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 sm:flex-nowrap">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            <span aria-hidden className="mr-1 text-accent">↻</span>
            {s.title}
          </p>
          <p className="text-xs text-muted">
            {s.label}
            {s.homeBlockName ? ` · home: ${s.homeBlockName}` : ""}
            {s.policy === "backlog" ? " · if missed: backlog" : ""}
          </p>
          <p className={`text-xs ${s.late ? "font-medium text-danger" : "text-muted"}`}>{s.status}</p>
          <p className="text-xs text-faint">
            {s.lastDoneOn ? `Last done ${day(s.lastDoneOn)}` : "Not done yet"}
            {s.avgGap !== null ? ` · usually every ${s.avgGap} days` : ""}
            {s.history.length > 0 && (
              <>
                {" · "}
                <button type="button" onClick={() => setShowHistory((v) => !v)} className="underline">
                  {showHistory ? "hide" : "history"}
                </button>
              </>
            )}
          </p>
          {showHistory && s.history.length > 0 && <p className="text-xs text-muted">Done on: {s.history.map(day).join(" · ")}</p>}
        </div>
        <div className="-mr-1 flex shrink-0 flex-wrap items-center gap-0.5 sm:flex-nowrap">
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={`${btn} text-muted hover:bg-subtle hover:text-fg`}>
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => setSeriesActive({ seriesId: s.id, active: !s.active }))}
            className={`${btn} text-muted hover:bg-subtle hover:text-fg`}
          >
            {s.active ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Stop repeating “${s.title}”? Its open task stays as a normal task.`)) return;
              void act(() => removeSeries({ seriesId: s.id }));
            }}
            className={`${btn} text-faint hover:bg-danger-soft hover:text-danger`}
          >
            Stop
          </button>
        </div>
      </div>
      {note && <p className={`mt-1 text-xs ${note.ok ? "text-success" : "text-danger"}`}>{note.text}</p>}
      {editing && <EditSeries series={s} blockOptions={blockOptions} onClose={() => setEditing(false)} />}
    </li>
  );
}

function EditSeries({ series: s, blockOptions, onClose }: { series: SeriesRowData; blockOptions: Option[]; onClose: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSeries, {});
  useEffect(() => {
    if (state.ok) {
      emitCalendarChanged();
      onClose();
    }
  }, [state, onClose]);
  const blocks =
    s.homeBlockId && !blockOptions.some((b) => b.value === s.homeBlockId)
      ? [{ value: s.homeBlockId, label: "Current block (removed)" }, ...blockOptions]
      : blockOptions;
  return (
    <Modal title="Edit recurring task" onClose={onClose} wide>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={s.id} />
        <label className="block text-sm">
          Title
          <WritingInput area="tasks" name="title" required defaultValue={s.title} autoFocus className={`mt-1 ${inputCls}`} />
        </label>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="w-24">
            Every
            <input type="number" name="repeat_every" min={1} max={366} defaultValue={s.every} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="w-32">
            <span className="sr-only">Unit</span>
            <select name="repeat_unit" defaultValue={s.unit} className={inputCls}>
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
          </label>
          <span className="pb-2 text-muted">after I finish it</span>
        </div>
        <label className="block text-sm">
          Home block
          <select name="home_block" defaultValue={s.homeBlockId ?? ""} className={`mt-1 ${inputCls}`}>
            <option value="">— None (I&apos;ll place it) —</option>
            {blocks.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          If not done by the end of the day
          <select name="rollover_policy" defaultValue={s.policy} className={`mt-1 ${inputCls}`}>
            <option value="migrate">Reschedule to the next time its block happens (else tomorrow)</option>
            <option value="backlog">Send to backlog</option>
          </select>
        </label>
        <p className="text-xs text-muted">
          The title, block and rule apply to its open task now and to every future one. A new interval applies from the next time you finish it.
        </p>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={pending} className={btnPrimary}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
