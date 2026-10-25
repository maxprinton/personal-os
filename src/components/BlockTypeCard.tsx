"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeBlockType, renameBlockType, setBlockTypeColor } from "@/app/calendar-actions";
import { emitCalendarChanged } from "@/components/calendar/util";

/** One block (as a concept): rename and recolor apply everywhere it appears. */
export default function BlockTypeCard({
  id,
  name,
  color,
  slots,
  readOnly = false,
  children,
}: {
  id: string;
  name: string;
  color: string;
  slots: string[];
  readOnly?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [n, setN] = useState(name);
  const [c, setC] = useState(color);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r1 = n.trim() !== name ? await renameBlockType({ id, name: n }) : { ok: true };
    const r2 = c !== color ? await setBlockTypeColor({ id, color: c }) : { ok: true };
    setBusy(false);
    const err = ("error" in r1 && r1.error) || ("error" in r2 && r2.error);
    setMsg(err ? String(err) : "Saved.");
    emitCalendarChanged();
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Stop "${name}" from today on? Past days keep it.`)) return;
    setBusy(true);
    const r = await removeBlockType({ id });
    setBusy(false);
    if (r.error) setMsg(r.error);
    emitCalendarChanged();
    router.refresh();
  }

  return (
    <li className="space-y-2 rounded-lg border border-line p-3 bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: c }} />
        {readOnly ? (
          <p className="font-medium">{name}</p>
        ) : (
          <>
            <input value={n} onChange={(e) => setN(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-sm" />
            <input type="color" value={c} onChange={(e) => setC(e.target.value)} className="h-8 w-10" />
            <button disabled={busy} onClick={save} className="rounded-md border border-edge transition-colors hover:bg-subtle px-2 py-1 text-xs disabled:opacity-50">
              Save
            </button>
            <button disabled={busy} onClick={remove} className="text-xs text-muted hover:text-danger">
              Remove
            </button>
          </>
        )}
      </div>
      <ul className="space-y-0.5 text-sm text-muted">
        {slots.map((s) => (
          <li key={s}>{s}</li>
        ))}
        {slots.length === 0 && <li className="text-faint">Not on the calendar from today on.</li>}
      </ul>
      {children}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </li>
  );
}
