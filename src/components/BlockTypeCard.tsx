"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeBlockType, renameBlockType, setBlockTypeColor, setBlockTypeFreeDayBehavior } from "@/app/calendar-actions";
import { emitCalendarChanged } from "@/components/calendar/util";

/** One block (as a concept): rename and recolor apply everywhere it appears. */
export default function BlockTypeCard({
  id,
  name,
  color,
  slots,
  freeDay = "pause",
  readOnly = false,
  children,
}: {
  id: string;
  name: string;
  color: string;
  slots: string[];
  freeDay?: "pause" | "keep";
  readOnly?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [n, setN] = useState(name);
  const [c, setC] = useState(color);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fd, setFd] = useState<"pause" | "keep">(freeDay);

  async function changeFreeDay(v: "pause" | "keep") {
    const prev = fd;
    setFd(v);
    setBusy(true);
    setMsg(null);
    const r = await setBlockTypeFreeDayBehavior({ id, behavior: v });
    setBusy(false);
    if ("error" in r && r.error) {
      setFd(prev);
      setMsg(r.error);
    } else {
      setMsg(("notice" in r && r.notice) || "Saved.");
      emitCalendarChanged();
      router.refresh();
    }
  }

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
      <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>On free days</span>
        <select
          value={fd}
          disabled={busy || readOnly}
          onChange={(e) => changeFreeDay(e.target.value as "pause" | "keep")}
          className="rounded-md border border-line-strong bg-transparent px-2 py-1 text-sm text-fg disabled:opacity-60"
        >
          <option value="pause">Pause it (ghosted, streak paused)</option>
          <option value="keep">Keep it (stays active)</option>
        </select>
      </label>
      {children}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </li>
  );
}
