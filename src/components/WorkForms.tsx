"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createWorkClass, saveWorkSettings } from "@/app/work-actions";
import type { ActionState } from "@/app/actions";
import { SHEET_TYPE_LABEL, toTsv } from "@/lib/work-log";

const INPUT = "rounded-md border border-line-strong px-2 py-1.5 text-sm";
const PRIMARY =
  "rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50";
const GHOST = "rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-subtle disabled:opacity-50";

export type ClassDefaults = {
  id?: string;
  class_date?: string;
  start_time?: string;
  end_time?: string;
  group_name?: string;
  role?: "substitute" | "head";
  sheet_type?: string | null;
  requested_by?: string | null;
  notes?: string | null;
  rate?: number | null;
};

export type Suggestions = { groups: string[]; people: string[] };

/** The fields of a class, shared by "Add a class" and "Edit". */
export function ClassFields({ d, s, idp }: { d: ClassDefaults; s: Suggestions; idp: string }) {
  return (
    <>
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <label className="space-y-1 text-xs text-muted">
        Date
        <input type="date" name="class_date" required defaultValue={d.class_date} className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        Start
        <input type="time" name="start_time" required defaultValue={d.start_time?.slice(0, 5)} className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        End
        <input type="time" name="end_time" required defaultValue={d.end_time?.slice(0, 5)} className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        Class
        <input
          name="group_name"
          required
          list={`${idp}-groups`}
          defaultValue={d.group_name}
          placeholder="B2-5"
          autoComplete="off"
          className={`${INPUT} w-full text-fg`}
        />
        <datalist id={`${idp}-groups`}>
          {s.groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </label>
      <label className="space-y-1 text-xs text-muted">
        Type in the Sheet
        <select name="sheet_type" defaultValue={d.sheet_type ?? (d.id ? "" : "extra")} className={`${INPUT} w-full text-fg`}>
          {(["extra", "collaboration", "recovery"] as const).map((k) => (
            <option key={k} value={k}>
              {SHEET_TYPE_LABEL[k]}
            </option>
          ))}
          <option value="">Not reported in the Sheet</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted">
        Requested by (Solicitud)
        <input
          name="requested_by"
          list={`${idp}-people`}
          defaultValue={d.requested_by ?? ""}
          placeholder="Propia, Academia or a teacher"
          autoComplete="off"
          className={`${INPUT} w-full text-fg`}
        />
        <datalist id={`${idp}-people`}>
          {s.people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label className="space-y-1 text-xs text-muted">
        I taught as
        <select name="role" defaultValue={d.role ?? "substitute"} className={`${INPUT} w-full text-fg`}>
          <option value="substitute">Substitute</option>
          <option value="head">Head teacher</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted">
        $ per hour
        <input
          name="rate"
          inputMode="decimal"
          defaultValue={d.rate ?? ""}
          placeholder="Default for the role"
          className={`${INPUT} w-full text-fg`}
        />
      </label>
      <label className="col-span-2 space-y-1 text-xs text-muted sm:col-span-4">
        Details (goes in “Información adicional”)
        <input
          name="notes"
          defaultValue={d.notes ?? ""}
          placeholder="Why the class happened, who it was for…"
          className={`${INPUT} w-full text-fg`}
        />
      </label>
    </>
  );
}

export function NewClassForm({ today, suggestions }: { today: string; suggestions: Suggestions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createWorkClass, {});
  const ref = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (state.ok) setKey((k) => k + 1); // new defaults → the form starts clean
  }, [state]);
  return (
    <form
      key={key}
      ref={ref}
      action={action}
      className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-4"
    >
      <p className="col-span-2 text-xs text-faint sm:col-span-4">
        <b>Hora Extra</b>: a class another teacher or the academy asked you to cover (never your own initiative). <b>Colaboración</b>: another teacher sent you
        their students at your time. <b>Recuperación</b>: makes up a lost hour. Extra and recovered hours are void without the full recording.
      </p>
      <ClassFields d={{ class_date: today }} s={suggestions} idp="new" />
      <button disabled={pending} className={`${PRIMARY} col-span-2 sm:col-span-4`}>
        {pending ? "Saving..." : "Add class"}
      </button>
      {state.error && <p className="col-span-2 text-sm text-danger sm:col-span-4">{state.error}</p>}
      {state.ok && !state.error && <p className="col-span-2 text-sm text-success sm:col-span-4">Saved ✓</p>}
    </form>
  );
}

export function SettingsForm({
  teacher,
  subRate,
  headRate,
  folder,
}: {
  teacher: string;
  subRate: number;
  headRate: number;
  folder: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveWorkSettings, {});
  return (
    <form action={action} className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-4">
      <label className="col-span-2 space-y-1 text-xs text-muted">
        Your name in the Sheet (Docente)
        <input name="teacher_name" defaultValue={teacher} placeholder="Your full name" className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        Substitute $ / hour
        <input name="substitute_rate" inputMode="decimal" defaultValue={subRate} className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        Head teacher $ / hour
        <input name="head_rate" inputMode="decimal" defaultValue={headRate} className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="col-span-2 space-y-1 text-xs text-muted sm:col-span-4">
        Google Drive folder for the videos (link)
        <input name="video_folder_url" defaultValue={folder} placeholder="https://drive.google.com/drive/folders/…" className={`${INPUT} w-full text-fg`} />
      </label>
      <button disabled={pending} className={`${PRIMARY} col-span-2 sm:col-span-4`}>
        {pending ? "Saving..." : "Save settings"}
      </button>
      {state.error && <p className="col-span-2 text-sm text-danger sm:col-span-4">{state.error}</p>}
      {state.ok && !state.error && <p className="col-span-2 text-sm text-success sm:col-span-4">Saved ✓</p>}
    </form>
  );
}

/** Copy-and-paste export in the company Sheet's columns (one tab = one button). */
export function ExportPanel({
  monthLabel,
  detail,
  detailHeaders,
  summaryHeaders,
  teacher,
  monthEs,
  recoveryHours,
  extraHours,
  collaborationCount,
  blocked,
}: {
  monthLabel: string;
  detail: string[][];
  detailHeaders: string[];
  summaryHeaders: string[];
  teacher: string;
  monthEs: string;
  recoveryHours: string;
  extraHours: string;
  collaborationCount: number;
  blocked: { id: string; label: string; hours: string }[];
}) {
  const [lost, setLost] = useState("0");
  const [copied, setCopied] = useState<"" | "detail" | "summary" | "failed">("");
  const lostN = Number(lost.replace(",", "."));
  const summary = [teacher || "(your name)", monthEs, String(Number.isFinite(lostN) ? lostN : 0), recoveryHours, extraHours, String(collaborationCount)];

  async function copy(which: "detail" | "summary") {
    const text = which === "detail" ? toTsv(detail) : toTsv([summary]);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(""), 2500);
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">
        Copy a tab’s rows and paste them into the first empty row of the company Sheet (click the first cell, then Ctrl+V). Only classes with a
        type are included. {monthLabel}: {detail.length} {detail.length === 1 ? "row" : "rows"} for “Reporte detallado”.
      </p>

      {blocked.length > 0 && (
        <div className="space-y-1 rounded-md border border-warning p-3 text-sm">
          <p className="font-medium text-warning">
            {blocked.length} {blocked.length === 1 ? "class has" : "classes have"} no evidence yet — left out of both tabs
          </p>
          <p className="text-xs text-muted">
            The company voids Hora Extra and Hora Recuperada without the full recording. Post the video and add its Drive link in the class card and they
            will appear here.
          </p>
          <ul className="text-xs">
            {blocked.map((b) => (
              <li key={b.id}>
                {b.label} · {b.hours} h
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Tab “Reporte detallado”</h3>
        {detail.length === 0 ? (
          <p className="text-sm text-faint">No classes with a Sheet type this month.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-subtle text-muted">
                <tr>
                  {detailHeaders.map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.map((c, j) => (
                      <td key={j} className="max-w-[16rem] truncate px-2 py-1.5">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" disabled={detail.length === 0} onClick={() => copy("detail")} className={GHOST}>
          {copied === "detail" ? "Copied ✓" : "Copy rows (no headers)"}
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Tab “Resumen”</h3>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-subtle text-muted">
              <tr>
                {summaryHeaders.map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                {summary.map((c, j) => (
                  <td key={j} className="px-2 py-1.5">
                    {c}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Hours lost this month (Horas Perdidas — I can’t know these)
          <input value={lost} onChange={(e) => setLost(e.target.value)} inputMode="decimal" className={`${INPUT} w-20 text-fg`} />
        </label>
        <button type="button" onClick={() => copy("summary")} className={GHOST}>
          {copied === "summary" ? "Copied ✓" : "Copy the row"}
        </button>
      </div>
      {copied === "failed" && <p className="text-sm text-danger">The browser blocked copying. Select the text in the table and copy it by hand.</p>}
    </div>
  );
}
