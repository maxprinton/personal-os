"use client";

import { useActionState, useMemo, useState } from "react";
import { importWorkClasses } from "@/app/work-actions";
import type { ActionState } from "@/app/actions";
import { parseNotionTable } from "@/lib/work-import";
import { fmtHours, shortDay } from "@/lib/work-log";
import { formatMinutes, timeToMinutes } from "@/lib/time";

const INPUT = "rounded-md border border-line-strong px-2 py-1.5 text-sm";
const PRIMARY = "rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50";

/** Paste the table copied out of Notion (or its CSV export): you see what was understood before anything is saved. */
export default function WorkImport({ today }: { today: string }) {
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(importWorkClasses, {});
  const parsed = useMemo(() => (text.trim() ? parseNotionTable(text, today) : null), [text, today]);
  const rows = parsed?.rows ?? [];
  return (
    <details className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <summary className="cursor-pointer text-sm font-medium">Import your Notion table</summary>
      <form action={action} className="mt-3 space-y-3">
        <p className="text-xs text-muted">
          In Notion select all the rows of your table (or export it as CSV), copy, and paste here. Columns Clase, Horario, URL, Horas and Dinero are read; a link in
          URL counts as the posted video. Attendance screenshots can’t travel through copy-paste — add them to each class afterwards. Classes already in the
          log are skipped, so pasting twice is safe.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"Clase\tHorario\tURL\tHoras\tDinero\nB2-5\tOct 27 9:00 PM → 10:00 PM\t\t1\t$6.00"}
          className={`${INPUT} w-full font-mono text-xs`}
        />
        {parsed && (
          <div className="space-y-2 text-sm">
            <p>
              <b>{rows.length}</b> {rows.length === 1 ? "class" : "classes"} understood
              {parsed.errors.length > 0 && <span className="text-warning"> · {parsed.errors.length} line{parsed.errors.length === 1 ? "" : "s"} I could not read</span>}
            </p>
            {rows.length > 0 && (
              <ul className="max-h-48 space-y-0.5 overflow-auto rounded-md border border-line p-2 text-xs">
                {rows.slice(0, 40).map((r) => (
                  <li key={r.line} className="flex flex-wrap gap-x-3">
                    <span className="font-medium">{r.group_name}</span>
                    <span className="text-muted">
                      {shortDay(r.class_date)} · {formatMinutes(timeToMinutes(r.start_time))} – {formatMinutes(timeToMinutes(r.end_time))} · {fmtHours(r.hours)} h
                      {r.rate !== null && ` · $${r.rate}/h`}
                      {r.video_url && " · video ✓"}
                    </span>
                  </li>
                ))}
                {rows.length > 40 && <li className="text-faint">+ {rows.length - 40} more</li>}
              </ul>
            )}
            {parsed.errors.length > 0 && (
              <ul className="space-y-0.5 rounded-md border border-warning p-2 text-xs">
                {parsed.errors.slice(0, 8).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.reason} <span className="text-faint">({e.text})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <>
            <input type="hidden" name="payload" value={JSON.stringify(rows)} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-muted">
                Type in the Sheet
                <select name="sheet_type" defaultValue="" className={`${INPUT} w-full text-fg`}>
                  <option value="">Not reported in the Sheet (history)</option>
                  <option value="extra">Hora Extra</option>
                  <option value="collaboration">Colaboración</option>
                  <option value="recovery">Recuperación</option>
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted">
                Requested by
                <input name="requested_by" placeholder="Teacher who asked (needed for Hora Extra)" className={`${INPUT} w-full text-fg`} />
              </label>
              <label className="space-y-1 text-xs text-muted">
                I taught as
                <select name="role" defaultValue="substitute" className={`${INPUT} w-full text-fg`}>
                  <option value="substitute">Substitute</option>
                  <option value="head">Head teacher</option>
                </select>
              </label>
            </div>
            <button disabled={pending} className={PRIMARY}>
              {pending ? "Importing…" : `Import ${rows.length} ${rows.length === 1 ? "class" : "classes"}`}
            </button>
          </>
        )}
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.ok && state.info && <p className="text-sm text-success">{state.info}</p>}
      </form>
    </details>
  );
}
