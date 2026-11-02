"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { bulkAssign, createWorkClass, saveWorkSettings } from "@/app/work-actions";
import type { ActionState } from "@/app/actions";
import { groupKey, SHEET_TYPE_LABEL, toTsv } from "@/lib/work-log";

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

/** groupTeachers: class code (lower-case key) → the teacher it belongs to now. */
export type Suggestions = { groups: string[]; people: string[]; groupTeachers?: Record<string, string> };

/** The fields of a class, shared by "Add a class" and "Edit". */
export function ClassFields({ d, s, idp }: { d: ClassDefaults; s: Suggestions; idp: string }) {
  const [group, setGroup] = useState(d.group_name ?? "");
  const [who, setWho] = useState(d.requested_by ?? "");
  const [touched, setTouched] = useState(false);
  const known = s.groupTeachers?.[groupKey(group)] ?? "";
  function pickGroup(v: string) {
    setGroup(v);
    const t = s.groupTeachers?.[groupKey(v)];
    if (t && !d.id && !touched) setWho(t); // new class: its code remembers the teacher
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
          value={who}
          onChange={(e) => {
            setTouched(true);
            setWho(e.target.value);
          }}
          placeholder="Propia, Academia or a teacher"
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
  detail: detailStrict,
  detailAll,
  detailHeaders,
  summaryHeaders,
  teacher,
  monthEs,
  recoveryHours: recStrict,
  extraHours: extraStrict,
  recoveryHoursAll,
  extraHoursAll,
  unreported,
  people,
  collaborationCount,
  blocked,
}: {
  month: string;
  /** Every month that has classes (plus the one on screen), newest first. */
  months: { key: string; label: string }[];
  monthLabel: string;
  detail: string[][];
  /** Same rows but also the Extra/Recuperación that have no video link yet. */
  detailAll: string[][];
  detailHeaders: string[];
  summaryHeaders: string[];
  teacher: string;
  monthEs: string;
  recoveryHours: string;
  extraHours: string;
  recoveryHoursAll: string;
  extraHoursAll: string;
  /** Taught classes of this month that are “Not reported in the Sheet” (they would not be in the Excel). */
  unreported: { id: string; label: string }[];
  people: string[];
  collaborationCount: number;
  blocked: { id: string; label: string; hours: string }[];
}) {
  const router = useRouter();
  const [include, setInclude] = useState(true);
  const detail = include ? detailAll : detailStrict;
  const recoveryHours = include ? recoveryHoursAll : recStrict;
  const extraHours = include ? extraHoursAll : extraStrict;
  const [fixType, setFixType] = useState("extra");
  const [fixTeacher, setFixTeacher] = useState("");
  const [fixBusy, setFixBusy] = useState(false);
  const [fixMsg, setFixMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [lost, setLost] = useState("0");
  const [copied, setCopied] = useState<"" | "detail" | "summary" | "failed">("");
  const [busy, setBusy] = useState(false);
  const [dlError, setDlError] = useState("");
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

  async function includeUnreported() {
    setFixBusy(true);
    setFixMsg(null);
    const r = await bulkAssign(unreported.map((u) => u.id), { teacher: fixTeacher, useGroup: !fixTeacher.trim(), sheet_type: fixType });
    setFixMsg({ text: r.error ?? r.info ?? "Done.", error: !!r.error });
    setFixBusy(false);
    if (!r.error) router.refresh();
  }

  async function download() {
    setBusy(true);
    setDlError("");
    try {
      const res = await fetch(`/api/work/xlsx?month=${encodeURIComponent(month)}&lost=${encodeURIComponent(lost)}&all=${include ? 1 : 0}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDlError(j.error ?? "I couldn't build the Excel. Try again.");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Reporte-de-horas-${month}.xlsx`;
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
        {monthLabel}: {detail.length} {detail.length === 1 ? "class goes" : "classes go"} in “Reporte detallado”. Press the button, open the Excel to check it,
        then upload it to the company’s Drive yourself.
      </p>

      {unreported.length > 0 && (
        <div className="space-y-2 rounded-md border border-warning p-3 text-sm">
          <p className="font-medium text-warning">
            {unreported.length} {unreported.length === 1 ? "class is" : "classes are"} “Not reported in the Sheet” — that is why the Excel comes out empty
          </p>
          <p className="text-xs text-muted">
            Only classes with a type (Hora Extra, Recuperación or Colaboración) and a requesting teacher go in the report. Choose them here and they are added:
            leave the teacher empty to use the teacher of each class code (set them in “Class codes and teachers”).
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-muted">
              Type
              <select value={fixType} onChange={(e) => setFixType(e.target.value)} className={`${INPUT} block text-fg`}>
                {(["extra", "collaboration", "recovery"] as const).map((k) => (
                  <option key={k} value={k}>
                    {SHEET_TYPE_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">
              Teacher (optional)
              <input
                value={fixTeacher}
                onChange={(e) => setFixTeacher(e.target.value)}
                list="export-people"
                placeholder="Each code’s teacher"
                autoComplete="off"
                className={`${INPUT} block w-48 text-fg`}
              />
              <datalist id="export-people">
                {people.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
            <button type="button" onClick={includeUnreported} disabled={fixBusy} className={PRIMARY}>
              {fixBusy ? "…" : `Add these ${unreported.length} to the Excel`}
            </button>
          </div>
          {fixMsg && <p className={`text-xs ${fixMsg.error ? "text-danger" : "text-success"}`}>{fixMsg.text}</p>}
        </div>
      )}

      {blocked.length > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          <span>
            Include the {blocked.length} Hora Extra / Recuperación that don’t have a video link yet
            <span className="block text-xs text-muted">Their Evidencia cell stays empty — add the link in the Excel before uploading, because the company voids them without it.</span>
          </span>
        </label>
      )}

      {blocked.length > 0 && (
        <div className="space-y-1 rounded-md border border-warning p-3 text-sm">
          <p className="font-medium text-warning">
            {blocked.length} {blocked.length === 1 ? "class has" : "classes have"} no video link yet — {include ? "included with Evidencia empty" : "left out of the Excel"}
          </p>
          <p className="text-xs text-muted">
            The company voids Hora Extra and Hora Recuperada without the full recording. Post the video and add its Drive link in the class card and they
            will be included.
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
      {!teacher && <p className="text-xs text-warning">Your name is empty, so “Docente” will be blank. Add it in Settings below.</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted">
          Month
          <select
            value={month}
            onChange={(e) => router.replace(`/work?month=${e.target.value}`, { scroll: false })}
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
          Hours lost (Horas Perdidas) (Horas Perdidas)
          <input value={lost} onChange={(e) => setLost(e.target.value)} inputMode="decimal" className={`${INPUT} block w-24 text-fg`} />
        </label>
        <button type="button" onClick={download} disabled={busy} className={PRIMARY}>
          {busy ? "Building…" : `Download ${monthLabel}`}
        </button>
      </div>
      {dlError && <p className="text-sm text-danger">{dlError}</p>}

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
