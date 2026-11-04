"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorkClass, saveWorkSettings } from "@/app/work-actions";
import type { ActionState } from "@/app/actions";
import { detailRows, fmtHours, groupKey, hasEvidence, type ClassSchedule, needsEvidence, reportClasses, SHEET_TYPE_LABEL, shortDay, summarize, toTsv, type WorkClass } from "@/lib/work-log";

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
  status?: "taught" | "cancelled_early" | "cancelled_late";
};

/** groupTeachers: class code (lower-case key) → the teacher it belongs to now. groupSchedules: class code → start / end of its latest class. */
export type Suggestions = { groups: string[]; people: string[]; groupTeachers?: Record<string, string>; groupSchedules?: Record<string, ClassSchedule>; teacher?: string };

/** The fields of a class, shared by "Add a class" and "Edit". */
export function ClassFields({ d, s, idp }: { d: ClassDefaults; s: Suggestions; idp: string }) {
  const [group, setGroup] = useState(d.group_name ?? "");
  const [who, setWho] = useState(d.requested_by ?? "");
  const [touched, setTouched] = useState(false);
  const [start, setStart] = useState(d.start_time?.slice(0, 5) ?? "");
  const [end, setEnd] = useState(d.end_time?.slice(0, 5) ?? "");
  const [timeTouched, setTimeTouched] = useState(false);
  const known = s.groupTeachers?.[groupKey(group)] ?? "";
  const usual = s.groupSchedules?.[groupKey(group)];
  function pickGroup(v: string) {
    setGroup(v);
    const t = s.groupTeachers?.[groupKey(v)];
    if (t && !d.id && !touched) setWho(t); // new class: its code remembers the teacher
    const sch = s.groupSchedules?.[groupKey(v)];
    if (sch && !d.id && !timeTouched) {
      // ...and the schedule of the last class given with that code (you can still change it)
      setStart(sch.start);
      setEnd(sch.end);
    }
  }
  return (
    <>
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <label className="space-y-1 text-xs text-muted">
        Date
        <input type="date" name="class_date" required defaultValue={d.class_date} className={`${INPUT} w-full text-fg`} />
      </label>
      <label className="space-y-1 text-xs text-muted">
        Start
        <input
          type="time"
          name="start_time"
          required
          value={start}
          onChange={(e) => {
            setTimeTouched(true);
            setStart(e.target.value);
          }}
          className={`${INPUT} w-full text-fg`}
        />
      </label>
      <label className="space-y-1 text-xs text-muted">
        End
        <input
          type="time"
          name="end_time"
          required
          value={end}
          onChange={(e) => {
            setTimeTouched(true);
            setEnd(e.target.value);
          }}
          className={`${INPUT} w-full text-fg`}
        />
      </label>
      <label className="space-y-1 text-xs text-muted">
        Class
        <input
          name="group_name"
          required
          list={`${idp}-groups`}
          value={group}
          onChange={(e) => pickGroup(e.target.value)}
          placeholder="B2-5"
          autoComplete="off"
          className={`${INPUT} w-full text-fg`}
        />
        <datalist id={`${idp}-groups`}>
          {s.groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        {usual && (usual.start !== start || usual.end !== end) && (
          <button
            type="button"
            onClick={() => {
              setStart(usual.start);
              setEnd(usual.end);
            }}
            className="block text-left text-accent underline"
          >
            Last {group.trim()} class: {usual.start}–{usual.end} — use it
          </button>
        )}
        {usual && usual.start === start && usual.end === end && <span className="block text-faint">{group.trim()} → {usual.start}–{usual.end} (last time)</span>}
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
        Teacher who asked (Solicitud)
        <input
          name="requested_by"
          list={`${idp}-people`}
          value={who}
          onChange={(e) => {
            setTouched(true);
            setWho(e.target.value);
          }}
          placeholder="Teacher who asked"
          autoComplete="off"
          className={`${INPUT} w-full text-fg`}
        />
        <datalist id={`${idp}-people`}>
          {s.people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {known && known !== who && (
          <button
            type="button"
            onClick={() => {
              setWho(known);
              setTouched(true);
            }}
            className="block text-left text-accent underline"
          >
            {group.trim()} belongs to {known} — use {known}
          </button>
        )}
        {known && known === who && <span className="block text-faint">{group.trim()} → {known} (remembered)</span>}
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
      <label className="col-span-2 space-y-1 text-xs text-muted sm:col-span-2">
        Status
        <select name="status" defaultValue={d.status ?? "taught"} className={`${INPUT} w-full text-fg`}>
          <option value="taught">Taught</option>
          <option value="cancelled_early">Student cancelled BEFORE it started</option>
          <option value="cancelled_late">Student cancelled AFTER it started</option>
        </select>
      </label>
      {d.id && <input type="hidden" name="was_status" value={d.status ?? "taught"} />}
      <label className="col-span-2 space-y-1 text-xs text-muted sm:col-span-2">
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

/** The month's report: one button gives the Excel in the company's format; the copy-and-paste rows stay below as a backup. */
export function ExportPanel({
  month,
  months,
  monthLabel,
  classes,
  map,
  detailHeaders,
  summaryHeaders,
  teacher,
  monthEs,
}: {
  month: string;
  /** Every month that has classes (plus the one on screen), newest first. */
  months: { key: string; label: string }[];
  monthLabel: string;
  /** All the classes of the month and the teacher each class code belongs to: the report is worked out here, as the Excel will be. */
  classes: WorkClass[];
  map: Record<string, string>;
  detailHeaders: string[];
  summaryHeaders: string[];
  teacher: string;
  monthEs: string;
}) {
  const router = useRouter();
  const [include, setInclude] = useState(true); // also Hora Extra / Recuperación without a video link yet
  const [incUnrep, setIncUnrep] = useState(true); // classes "Not reported in the Sheet" go in as Hora Extra
  const rc = reportClasses(classes, map, { includeNoLink: include, includeUnreported: incUnrep });
  const detail = detailRows(rc, include);
  const sum = summarize(rc, undefined, { includeNoLink: include });
  const recoveryHours = fmtHours(sum.recoveryHours);
  const extraHours = fmtHours(sum.extraHours);
  const collaborationCount = sum.collaborationCount;
  const taughtN = classes.filter((c) => c.status === "taught").length;
  const unreportedN = classes.filter((c) => c.status === "taught" && !c.sheet_type).length;
  const noLink = rc.filter((c) => needsEvidence(c.sheet_type) && !hasEvidence(c));
  const noTeacher = rc.filter((c) => !(c.requested_by ?? "").trim());
  const label = (c: WorkClass) => `${c.group_name} · ${shortDay(c.class_date)}`;
  const [lost, setLost] = useState("0");
  const [copied, setCopied] = useState<"" | "detail" | "summary" | "failed">("");
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState("");
  const [dlInfo, setDlInfo] = useState("");
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

  async function download() {
    setBusy(true);
    setDlError("");
    setDlInfo("");
    try {
      const res = await fetch(`/api/work/xlsx?month=${encodeURIComponent(month)}&lost=${encodeURIComponent(lost)}&all=${include ? 1 : 0}&unrep=${incUnrep ? 1 : 0}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDlError(j.error ?? "I couldn't build the Excel. Try again.");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const t = new Date();
      const stamp = `${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}${String(t.getSeconds()).padStart(2, "0")}`;
      const name = `Reporte-de-horas-${month}-${stamp}.xlsx`; // a new name each time, so you never open an old download by mistake
      a.download = name;
      setDlInfo(`Downloaded “${name}” with ${res.headers.get("x-report-rows") ?? "?"} classes. Open that newest file.`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      setDlError("I couldn't download it. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">
        {monthLabel}: {detail.length} of {taughtN} {taughtN === 1 ? "class goes" : "classes go"} in “Reporte detallado”. The “Solicitud” column is always the teacher who
        asked (set it, and the videos, in the table above). Press the button, open the Excel to check it, then upload it to the company’s Drive yourself.
      </p>

      {unreportedN > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={incUnrep} onChange={(e) => setIncUnrep(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          <span>
            Include the {unreportedN} {unreportedN === 1 ? "class" : "classes"} marked “Not reported in the Sheet”, as Hora Extra
            <span className="block text-xs text-muted">Untick it for a month you already reported.</span>
          </span>
        </label>
      )}

      {noLink.length > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          <span>
            Include the {noLink.length} Hora Extra / Recuperación that don’t have a video link yet
            <span className="block text-xs text-muted">Their Evidencia cell stays empty — add the link in the table above, or in the Excel before uploading: the company voids them without the recording.</span>
          </span>
        </label>
      )}

      {noTeacher.length > 0 && (
        <div className="space-y-1 rounded-md border border-warning p-3 text-sm">
          <p className="font-medium text-warning">
            {noTeacher.length} {noTeacher.length === 1 ? "class has" : "classes have"} no teacher — their Solicitud cell will be empty
          </p>
          <p className="text-xs text-muted">Write the teacher in the table above (or set it for the class code in “Class codes and teachers”).</p>
          <ul className="text-xs">
            {noTeacher.map((c) => (
              <li key={c.id}>{label(c)}</li>
            ))}
          </ul>
        </div>
      )}
      {!teacher && <p className="text-xs text-warning">Your name is empty, so “Docente” will be blank. Add it in Settings below.</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted">
          Month
          <select
            value={month}
            onChange={(e) => router.replace(`/teaching?month=${e.target.value}`, { scroll: false })}
            className={`${INPUT} block min-w-44 text-fg`}
          >
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted">
          Hours lost (Horas Perdidas)
          <input value={lost} onChange={(e) => setLost(e.target.value)} inputMode="decimal" className={`${INPUT} block w-24 text-fg`} />
        </label>
        <button type="button" onClick={download} disabled={busy} className={PRIMARY}>
          {busy ? "Building…" : `Download ${monthLabel}`}
        </button>
      </div>
      {dlError && <p className="text-sm text-danger">{dlError}</p>}
      {dlInfo && !dlError && <p className="text-sm text-success">{dlInfo}</p>}

      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">Or copy the rows to paste into the company’s own file</summary>
        <div className="mt-3 space-y-4">
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
            <button type="button" onClick={() => copy("summary")} className={GHOST}>
              {copied === "summary" ? "Copied ✓" : "Copy the row"}
            </button>
          </div>
          {copied === "failed" && <p className="text-sm text-danger">The browser blocked copying. Select the text in the table and copy it by hand.</p>}
        </div>
      </details>
    </div>
  );
}
