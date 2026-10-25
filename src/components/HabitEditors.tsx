"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createHabit, removeHabit, updateHabit } from "@/app/calendar-actions";
import type { CalResult } from "@/lib/calendar/types";
import { emitCalendarChanged } from "@/components/calendar/util";

type BlockOption = { id: string; name: string };

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<CalResult>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setMsg(r.error ?? null);
    emitCalendarChanged();
    router.refresh();
    return !r.error;
  }
  return { run, msg, busy };
}

/** New habit: it lives inside a block. Without a block it waits in "Unscheduled". */
export function NewHabitForm({ blocks, defaultBlockId = "" }: { blocks: BlockOption[]; defaultBlockId?: string }) {
  const { run, msg, busy } = useRun();
  const [name, setName] = useState("");
  const [block, setBlock] = useState(defaultBlockId);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => createHabit({ name, blockTypeId: block || null }))) setName("");
      }}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3 bg-surface shadow-card"
    >
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New habit, e.g. Stretch, Read 10 pages"
        className="min-w-0 flex-1 rounded-md border border-line-strong px-3 py-2 text-sm"
      />
      <select value={block} onChange={(e) => setBlock(e.target.value)} className="rounded-md border border-line-strong px-2 py-2 text-sm">
        <option value="">Unscheduled (no block yet)</option>
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            In {b.name}
          </option>
        ))}
      </select>
      <button disabled={busy} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg disabled:opacity-50">
        Add habit
      </button>
      {msg && <p className="w-full text-sm text-danger">{msg}</p>}
    </form>
  );
}

/** Rename, move to another block (from today on) or stop tracking. */
export function HabitEditRow({
  id,
  name,
  blockTypeId,
  blocks,
}: {
  id: string;
  name: string;
  blockTypeId: string | null;
  blocks: BlockOption[];
}) {
  const { run, msg, busy } = useRun();
  const [n, setN] = useState(name);
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted underline">
        Edit
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-subtle p-2">
      <input value={n} onChange={(e) => setN(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-sm" />
      <button disabled={busy} onClick={() => run(() => updateHabit({ id, name: n }))} className="rounded-md border border-edge transition-colors hover:bg-subtle px-2 py-1 text-xs">
        Rename
      </button>
      <select
        value={blockTypeId ?? ""}
        disabled={busy}
        onChange={(e) => run(() => updateHabit({ id, blockTypeId: e.target.value || null }))}
        className="rounded-md border border-line-strong px-2 py-1 text-xs"
        title="Moving applies from today on; past marks stay where they were"
      >
        <option value="">Unscheduled</option>
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            In {b.name}
          </option>
        ))}
      </select>
      <button
        disabled={busy}
        onClick={() => window.confirm(`Stop tracking "${name}"? Its history is kept.`) && run(() => removeHabit({ id }))}
        className="text-xs text-muted hover:text-danger"
      >
        Stop tracking
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted">
        Close
      </button>
      {msg && <p className="w-full text-xs text-danger">{msg}</p>}
    </div>
  );
}
