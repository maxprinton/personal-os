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
      className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3"
    >
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New habit, e.g. Stretch, Read 10 pages"
        className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      <select value={block} onChange={(e) => setBlock(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-2 text-sm">
        <option value="">Unscheduled (no block yet)</option>
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            In {b.name}
          </option>
        ))}
      </select>
      <button disabled={busy} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        Add habit
      </button>
      {msg && <p className="w-full text-sm text-red-600">{msg}</p>}
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
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-neutral-500 underline">
        Edit
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-neutral-50 p-2">
      <input value={n} onChange={(e) => setN(e.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      <button disabled={busy} onClick={() => run(() => updateHabit({ id, name: n }))} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
        Rename
      </button>
      <select
        value={blockTypeId ?? ""}
        disabled={busy}
        onChange={(e) => run(() => updateHabit({ id, blockTypeId: e.target.value || null }))}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
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
        className="text-xs text-neutral-500 hover:text-red-600"
      >
        Stop tracking
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-neutral-500">
        Close
      </button>
      {msg && <p className="w-full text-xs text-red-600">{msg}</p>}
    </div>
  );
}
