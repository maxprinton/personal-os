"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { deleteItemAction, saveItem, type BacklogActionResult } from "@/app/backlog-actions";
import MoveMenu from "@/components/backlog/MoveMenu";
import TriagePrompt from "@/components/backlog/TriagePrompt";
import { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import { STATUS_LABEL, TYPE_LABEL, capsFrom, daysSince, type BacklogItem, type BacklogSettings, type Triage } from "@/lib/backlog/board";
import { SIZES, TYPES, itemCode, type BacklogSize, type BacklogType } from "@/lib/backlog/rules";
import type { BacklogEvent } from "@/lib/backlog/data";

const SCORES = ["", "1", "2", "3"];

/** One item: edit the details, move it, see its history. */
export default function ItemEditor({
  item,
  items,
  settings,
  events,
  nowIso,
}: {
  item: BacklogItem;
  items: BacklogItem[];
  settings: BacklogSettings;
  events: BacklogEvent[];
  nowIso: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const [type, setType] = useState<BacklogType>(item.type);
  const [size, setSize] = useState<BacklogSize | "">(item.size ?? "");
  const [area, setArea] = useState(item.area ?? "");
  const [spec, setSpec] = useState(item.spec_link ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [value, setValue] = useState(item.value ? String(item.value) : "");
  const [effort, setEffort] = useState(item.effort ? String(item.effort) : "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [triage, setTriage] = useState<Triage | null>(null);
  const now = new Date(nowIso);

  function onResult(r: BacklogActionResult) {
    if (r.error) setNote({ text: r.error, bad: true });
    else {
      if (r.message) setNote({ text: r.message, bad: false });
      router.refresh();
    }
    if (r.triage) setTriage(r.triage);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await saveItem({ number: item.number, title, type, size, area, spec_link: spec, notes, value, effort });
    setBusy(false);
    onResult(r);
  }
  async function remove() {
    if (!window.confirm(`Delete ${itemCode(item.number)} for good? Rejected ideas are better parked with a reason.`)) return;
    const r = await deleteItemAction({ number: item.number });
    if (r.error) return setNote({ text: r.error, bad: true });
    router.push("/backlog");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/backlog" className="text-sm text-muted underline">
            ← Backlog
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {itemCode(item.number)} · {item.title}
          </h1>
          <p className="text-sm text-muted">
            {STATUS_LABEL[item.status]} for {daysSince(item.status_changed_at, now)} days
            {item.reopened_count > 0 && ` · reopened ${item.reopened_count}×`}
            {item.status === "parked" && item.parked_reason && ` · parked: ${item.parked_reason}`}
          </p>
        </div>
        <MoveMenu item={item} items={items} caps={capsFrom(settings)} onResult={onResult} />
      </div>

      {note && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${note.bad ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"}`}>
          {note.text}
        </p>
      )}

      <form onSubmit={save} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <label className="block text-sm">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`${inputCls} mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as BacklogType)} className={`${inputCls} mt-1`}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Size
            <select value={size} onChange={(e) => setSize(e.target.value as BacklogSize | "")} className={`${inputCls} mt-1`}>
              <option value="">Not set</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Value (1-3)
            <select value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} mt-1`}>
              {SCORES.map((s) => (
                <option key={s} value={s}>
                  {s || "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Effort (1-3)
            <select value={effort} onChange={(e) => setEffort(e.target.value)} className={`${inputCls} mt-1`}>
              {SCORES.map((s) => (
                <option key={s} value={s}>
                  {s || "—"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Area
            <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} placeholder="e.g. notes, telegram, youtube" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-sm">
            Spec link (needed before Now)
            <input value={spec} onChange={(e) => setSpec(e.target.value)} maxLength={300} placeholder="/notes/… (the spec note)" className={`${inputCls} mt-1`} />
            {spec.startsWith("/") && <a href={spec} className="mt-1 inline-block text-xs underline">Open the spec note</a>}
          </label>
        </div>
        <label className="block text-sm">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} className={`${inputCls} mt-1`} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy || !title.trim()} className={btnPrimary}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={remove} className={`${btnSecondary} text-danger`}>
            Delete
          </button>
        </div>
      </form>

      <section className="space-y-2">
        <h2 className="section-title">History</h2>
        {events.length === 0 ? (
          <p className="text-sm text-faint">No moves yet.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted">{new Date(e.at).toLocaleString()}</span>
                <span>
                  {e.from_status ? `${STATUS_LABEL[e.from_status as keyof typeof STATUS_LABEL] ?? e.from_status} → ` : "Created in "}
                  {STATUS_LABEL[e.to_status as keyof typeof STATUS_LABEL] ?? e.to_status}
                </span>
                <span className="text-faint">by {e.by}</span>
                {e.note && <span className="text-muted">· {e.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
      {triage && <TriagePrompt triage={triage} title="30 seconds: what's next?" onClose={() => setTriage(null)} />}
    </div>
  );
}
