"use client";

import { useActionState, useState } from "react";
import { saveCheckin } from "@/app/insights-actions";
import type { ActionState } from "@/app/actions";

type Initial = { mood: number | null; energy: number | null; bed: string; wake: string; highlight: string };

function Scale({ name, label, value, onChange }: { name: string; label: string; value: number | null; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <input type="hidden" name={name} value={value ?? ""} />
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={`rounded-md border px-0 py-1.5 text-sm tabular-nums transition-colors ${
              value === n ? "border-accent bg-accent font-medium text-accent-fg" : "border-line-strong hover:bg-subtle-2"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

type BlockFocus = { id: string; name: string; focus: number | null };
const FOCUS_LABELS = ["Scattered", "Normal", "Locked in"];

function FocusPicker({ block }: { block: BlockFocus }) {
  const [v, setV] = useState<number | null>(block.focus);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-sm">{block.name}</span>
      <input type="hidden" name={`focus_${block.id}`} value={v ?? ""} />
      <div className="flex shrink-0 gap-1">
        {FOCUS_LABELS.map((l, i) => (
          <button
            key={l}
            type="button"
            onClick={() => setV(i + 1)}
            aria-pressed={v === i + 1}
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${v === i + 1 ? "border-accent bg-accent font-medium text-accent-fg" : "border-line-strong hover:bg-subtle-2"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CheckinForm({
  dates,
  initial,
  blocks = {},
}: {
  dates: { value: string; label: string }[];
  initial: Record<string, Initial>;
  blocks?: Record<string, BlockFocus[]>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCheckin, {});
  const [date, setDate] = useState(dates[0].value);
  const start = initial[date] ?? { mood: null, energy: null, bed: "", wake: "", highlight: "" };
  // Remount the inputs when the day changes so they show that day's saved values.
  return (
    <form key={date} action={action} className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium" htmlFor="ci-date">Day</label>
        <select
          id="ci-date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm"
        >
          {dates.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>
      <ScaleState name="mood" label="Mood" initial={start.mood} />
      <ScaleState name="energy" label="Energy" initial={start.energy} />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-sm font-medium">
          Went to bed (night before)
          <input name="bed" defaultValue={start.bed} placeholder="23:30" className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm font-normal" />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Woke up
          <input name="wake" defaultValue={start.wake} placeholder="07:15" className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm font-normal" />
        </label>
      </div>
      {(blocks[date] ?? []).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">How focused were you in each block?</p>
          {(blocks[date] ?? []).map((b) => (
            <FocusPicker key={b.id} block={b} />
          ))}
        </div>
      )}
      <label className="block space-y-1 text-sm font-medium">
        Highlight of the day
        <textarea name="highlight" defaultValue={start.highlight} rows={2} maxLength={280} placeholder="One line: what made today count?" className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm font-normal" />
      </label>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50">
          {pending ? "Saving..." : "Save check-in"}
        </button>
        {state.ok && !pending && <span className="text-sm text-success">Saved.</span>}
        {state.error && <span className="text-sm text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

function ScaleState({ name, label, initial }: { name: string; label: string; initial: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return <Scale name={name} label={label} value={v} onChange={setV} />;
}
