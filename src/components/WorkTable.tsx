"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReportRows } from "@/app/work-actions";
import { groupKey, isOrigin, shortDay, SHEET_TYPE_LABEL, type WorkClass } from "@/lib/work-log";

const INPUT = "rounded-md border border-line-strong px-2 py-1 text-sm text-fg";
const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";

type Row = { teacher: string; url: string; type: string };

/**
 * Everything the report needs, class by class, in one place: who asked (the teacher — it comes from the class code, change it only when
 * it is someone else), the video link, and the type. One Save for the whole table.
 */
export default function WorkTable({ classes, map, people }: { classes: WorkClass[]; map: Record<string, string>; people: string[] }) {
  const router = useRouter();
  const list = classes.filter((c) => c.status === "taught");
  const stored = (c: WorkClass): Row => ({
    teacher: c.requested_by && !isOrigin(c.requested_by) ? c.requested_by : map[groupKey(c.group_name)] ?? "",
    url: c.video_url ?? "",
    type: c.sheet_type ?? "extra", // your usual class
  });
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const val = (c: WorkClass): Row => ({ ...stored(c), ...edits[c.id] });
  const set = (id: string, patch: Partial<Row>) => setEdits((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  // what is in the database today (to know which rows really change when saving)
  const inDb = (c: WorkClass): Row => ({ teacher: c.requested_by ?? "", url: c.video_url ?? "", type: c.sheet_type ?? "" });
  const dirty = list.filter((c) => {
    const v = val(c);
    const d = inDb(c);
    const typeChanged = v.type === "none" ? !!d.type : v.type !== d.type;
    return v.teacher.trim() !== d.teacher.trim() || v.url.trim() !== d.url.trim() || typeChanged;
  });

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await saveReportRows(
        dirty.map((c) => {
          const v = val(c);
          return { id: c.id, label: `${c.group_name} ${shortDay(c.class_date)}`, teacher: v.teacher, video_url: v.url, sheet_type: v.type };
        }),
      );
      setMsg({ text: r.error ?? r.info ?? "Saved.", error: !!r.error });
      if (!r.error) {
        setEdits({});
        router.refresh();
      }
    });
  }

  if (!list.length) return <p className="text-sm text-muted">No classes this month.</p>;
  return (
    <div className="space-y-3">
      <datalist id="table-people">
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <p className="text-xs text-muted">
        One line per class. <b>Teacher</b> = who asked for it (it is filled from the class code; change it only if it was someone else). <b>Video link</b> = the Drive
        recording. They are separate: the Excel puts the teacher in “Solicitud” and the link in “Evidencia”. Nothing is stored until you press Save.
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
        {list.map((c) => {
          const v = val(c);
          const changed = dirty.includes(c);
          return (
            <li key={c.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${changed ? "bg-subtle" : ""}`}>
              <span className="w-32 shrink-0 text-sm">
                <b>{c.group_name}</b>
                <span className="block text-xs text-muted">{shortDay(c.class_date)}</span>
              </span>
              <input
                value={v.teacher}
                onChange={(e) => set(c.id, { teacher: e.target.value })}
                list="table-people"
                placeholder="Teacher who asked"
                autoComplete="off"
                aria-label={`Teacher for ${c.group_name} ${shortDay(c.class_date)}`}
                className={`${INPUT} w-44`}
              />
              <input
                value={v.url}
                onChange={(e) => set(c.id, { url: e.target.value })}
                placeholder="Video link (Drive)"
                autoComplete="off"
                aria-label={`Video link for ${c.group_name} ${shortDay(c.class_date)}`}
                className={`${INPUT} min-w-0 flex-1 basis-48`}
              />
              <select value={v.type} onChange={(e) => set(c.id, { type: e.target.value })} aria-label="Type in the Sheet" className={`${INPUT} w-36`}>
                {(["extra", "collaboration", "recovery"] as const).map((k) => (
                  <option key={k} value={k}>
                    {SHEET_TYPE_LABEL[k]}
                  </option>
                ))}
                <option value="none">Not in the report</option>
              </select>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY} disabled={busy || !dirty.length} onClick={save}>
          {busy ? "Saving…" : dirty.length ? `Save ${dirty.length} ${dirty.length === 1 ? "change" : "changes"}` : "Everything is saved"}
        </button>
        {msg && <span className={`text-sm ${msg.error ? "text-danger" : "text-success"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
