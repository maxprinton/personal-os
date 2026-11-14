"use client";

import { useState } from "react";
import { saveDefaultNags } from "@/app/nags-actions";
import NagEditor from "@/components/nags/NagEditor";
import type { NagDraft } from "@/lib/nags/db";

/** Settings: the nags every event gets unless it has its own list. */
export default function NagDefaults({ initial, allDayTime }: { initial: NagDraft[]; allDayTime: string }) {
  const [list, setList] = useState<NagDraft[]>(initial);
  const [time, setTime] = useState(allDayTime);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await saveDefaultNags({ nags: list, allDayTime: time });
    setBusy(false);
    setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: "Saved." });
  }

  return (
    <section className="space-y-3 card p-5">
      <div>
        <h2 className="font-medium">Event nags</h2>
        <p className="text-sm text-muted">
          Messages before, at the start and halfway through a calendar event. These apply to every event; any event can have its own list in its edit window. With no nags here, events send nothing.
        </p>
      </div>
      <NagEditor initial={initial} onChange={setList} />
      <label className="flex items-center gap-2 text-sm">
        All-day events nag at
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-md border border-edge bg-surface px-2 py-1 text-sm" />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg">
          {busy ? "Saving…" : "Save nags"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
