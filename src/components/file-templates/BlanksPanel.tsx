"use client";
// Template Manager add-on, phase 3 — "Blanks" on a template page: what each original file has to fill in and which
// profile field goes where. Found automatically; you confirm (or change) it once per file. Flat PDFs: mark spots.
import { useEffect, useState, useTransition } from "react";
import { resetMapAction, saveMapAction, scanFileAction, type ScanResult } from "@/app/file-template-project-actions";
import { FIELD_DEFS, labelOf } from "@/lib/file-templates/fields";
import type { MapItem } from "@/lib/file-templates/fill/common";
import type { TemplateFile } from "@/lib/file-templates/types";
import { BOX, BTN_PLAIN, BTN_PRIMARY, BTN_SMALL, INPUT, SELECT } from "./ui";

const FILLABLE = /\.(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pdf|md|markdown|txt|csv|mmd|mermaid)$/i;
const GROUP_NAME = { core: "Core", people: "People", plan: "Plan", auto: "Automatic" } as const;

type Spot = Extract<MapItem, { kind: "pdf_spot" }>;

export default function BlanksPanel({ files, maps }: { files: TemplateFile[]; maps: Record<string, { confirmed: boolean; count: number }> }) {
  const fillable = files.filter((f) => f.role === "original" && FILLABLE.test(f.file_name));
  const [openId, setOpenId] = useState<string | null>(null);
  if (!fillable.length) return null;
  return (
    <section className={`${BOX} space-y-3`} aria-label="Blanks">
      <div>
        <h3 className="text-sm font-semibold">Blanks</h3>
        <p className="text-xs text-muted">
          What gets filled from a project profile when you make a working copy. Blanks like <code>{"{{project_name}}"}</code>, “[Project name]”, “Sponsor: ____”, label cells and tables are found for you; check each file once and every copy uses your choices.
        </p>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line text-sm">
        {fillable.map((f) => (
          <li key={f.id} className="p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{f.lang ? `${f.lang.toUpperCase()} · ` : ""}{f.file_name}</span>
              {maps[f.id]?.confirmed ? <span className="text-xs text-success">Checked · {maps[f.id].count} blanks</span> : <span className="text-xs text-muted">Automatic</span>}
              <button type="button" className={BTN_SMALL} onClick={() => setOpenId(openId === f.id ? null : f.id)}>{openId === f.id ? "Close" : "Check blanks"}</button>
            </div>
            {openId === f.id && <FileBlanks file={f} onClose={() => setOpenId(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function itemKey(it: MapItem, i: number) {
  return `${it.kind}-${i}`;
}

function describe(it: MapItem): string {
  if (it.kind === "token") return it.token;
  if (it.kind === "cell") return `Cell next to “${it.label}”`;
  if (it.kind === "table") return `Table: ${it.label}`;
  if (it.kind === "section") return `Section “${it.heading}”`;
  if (it.kind === "pdf_field") return `Form field “${it.name}”`;
  return `Spot on page ${it.page} (${Math.round(it.x)}%, ${Math.round(it.y)}%)`;
}

function FieldSelect({ it, onChange }: { it: MapItem; onChange: (field: string | null) => void }) {
  const value = it.field ?? "";
  if (it.kind === "table") {
    return (
      <select className={SELECT} value={value ? "on" : ""} onChange={(e) => onChange(e.target.value ? it.cols[0]?.field ?? null : null)} aria-label="Fill this table">
        <option value="on">Fill with {labelOf(it.cols[0]?.field ?? "")}</option>
        <option value="">Leave as is</option>
      </select>
    );
  }
  const ask = `ask:${it.label}`;
  const scalarOnly = it.kind === "pdf_field" || it.kind === "cell";
  const groups = (["core", "auto", "people", "plan"] as const).map((g) => ({ g, fields: FIELD_DEFS.filter((f) => f.group === g && (!scalarOnly || (f.kind !== "table" && f.kind !== "list")) && (it.kind !== "section" || g !== "auto")) })).filter((x) => x.fields.length);
  return (
    <select className={`${SELECT} max-w-[16rem]`} value={value} onChange={(e) => onChange(e.target.value || null)} aria-label={`Field for ${describe(it)}`}>
      <option value="">Leave as is</option>
      <option value={value.startsWith("ask:") ? value : ask}>Ask me each time</option>
      {groups.map(({ g, fields }) => (
        <optgroup key={g} label={GROUP_NAME[g]}>
          {fields.map((f) => <option key={f.key} value={f.key}>{f.label.en}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function FileBlanks({ file, onClose }: { file: TemplateFile; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [items, setItems] = useState<MapItem[]>([]);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [preview, setPreview] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    start(async () => {
      const r = await scanFileAction(file.id);
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      setScan(r);
      setItems(r.items);
    });
  }, [file.id, reload]);

  const set = (i: number, patch: Partial<MapItem>) => setItems((all) => all.map((it, k) => (k === i ? ({ ...it, ...patch, sure: true } as MapItem) : it)));
  const setSection = (i: number, field: string | null) =>
    setItems((all) => all.map((it, k) => (k === i && it.kind === "section" ? { ...it, field, fields: field && !field.startsWith("ask:") ? (it.fields.includes(field) ? [field, ...it.fields.filter((x) => x !== field)] : [field]) : it.fields, sure: true } : it)));
  const save = () =>
    start(async () => {
      const r = await saveMapAction(file.id, items);
      setMsg(r.ok ? { text: "Saved. Every new working copy of this file uses these choices." } : { text: r.error, bad: true });
    });
  const reset = () =>
    start(async () => {
      const r = await resetMapAction(file.id);
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      setReload((n) => n + 1);
      setMsg({ text: "Back to the automatic choices." });
    });

  const main = items.map((it, i) => ({ it, i })).filter(({ it }) => it.field || it.kind === "pdf_field" || it.kind === "pdf_spot" || it.sure);
  const other = items.map((it, i) => ({ it, i })).filter(({ it }) => !(it.field || it.kind === "pdf_field" || it.kind === "pdf_spot" || it.sure));
  const spots = items.filter((it): it is Spot => it.kind === "pdf_spot");
  const spotsParam = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(spots)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const row = ({ it, i }: { it: MapItem; i: number }) => (
    <li key={itemKey(it, i)} className="flex flex-wrap items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{describe(it)}</p>
        {it.kind === "table" && <p className="text-xs text-muted">{it.cols.map((c) => `${c.header} → ${c.sub ?? labelOf(c.field)}`).join(" · ")}</p>}
        {it.kind === "section" && it.fields.length > 1 && it.field && !it.field.startsWith("ask:") && <p className="text-xs text-muted">Gets: {it.fields.map((k) => labelOf(k)).join(" + ")}</p>}
      </div>
      {it.kind === "section" ? <FieldSelect it={it} onChange={(f) => setSection(i, f)} /> : <FieldSelect it={it} onChange={(f) => set(i, { field: f } as Partial<MapItem>)} />}
      {it.kind === "pdf_spot" && <SpotEditor spot={it} pages={scan?.pdf?.pages.length ?? 1} onChange={(p) => set(i, p)} onRemove={() => setItems((all) => all.filter((_, k) => k !== i))} />}
    </li>
  );

  return (
    <div className="mt-2 space-y-3 rounded-md border border-line bg-subtle/40 p-3">
      {pending && !scan && <p className="text-sm text-muted">Reading the file…</p>}
      {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-surface"}`}>{msg.text}</p>}
      {scan && (
        <>
          {scan.kind === "pdf" && (
            <p className="text-xs text-muted">
              {scan.pdf?.fields ? `This PDF is a form with ${scan.pdf.fields} fields: they are matched by name below.` : "This PDF has no form fields. Add spots where each value should be written (position in % of the page, from the top-left corner)."}
            </p>
          )}
          {main.length === 0 && scan.kind !== "pdf" && <p className="text-sm text-muted">No blanks found in this file. It will be copied as it is.</p>}
          {main.length > 0 && <ul className="divide-y divide-line">{main.map(row)}</ul>}
          {other.length > 0 && (
            <div>
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowOther(!showOther)}>
                {showOther ? "Hide" : "Show"} {other.length} other place{other.length === 1 ? "" : "s"} that could be filled (sections with a hint, unknown labels)
              </button>
              {showOther && <ul className="mt-1 divide-y divide-line">{other.map(row)}</ul>}
            </div>
          )}
          {scan.kind === "pdf" && (
            <div className="space-y-2">
              <button type="button" className={BTN_SMALL} onClick={() => setItems((all) => [...all, { kind: "pdf_spot", page: 1, x: 20, y: 20, size: 10, field: "project_name", label: "Project name", sure: true }])}>+ Add a spot</button>
              {spots.length > 0 && (
                <div className="space-y-1">
                  <button type="button" className={BTN_SMALL} onClick={() => setPreview((n) => n + 1)}>Show preview with grid</button>
                  {preview > 0 && <iframe key={preview} title="PDF preview with grid" className="h-[32rem] w-full rounded border border-line bg-surface" src={`/api/templates/pdf-preview?file=${file.id}&spots=${spotsParam}`} />}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={save}>{pending ? "Saving…" : "Save these choices"}</button>
            {scan.confirmed && <button type="button" className={BTN_PLAIN} disabled={pending} onClick={reset}>Back to automatic</button>}
            <button type="button" className={BTN_SMALL} onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}

function SpotEditor({ spot, pages, onChange, onRemove }: { spot: Spot; pages: number; onChange: (p: Partial<Spot>) => void; onRemove: () => void }) {
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || lo));
  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-xs text-muted">
      <label className="flex items-center gap-1">Page <input className={`${INPUT} w-14`} type="number" min={1} max={pages} value={spot.page} onChange={(e) => onChange({ page: num(e.target.value, 1, pages) })} /></label>
      <label className="flex items-center gap-1">Across % <input className="w-28" type="range" min={0} max={100} step={0.5} value={spot.x} onChange={(e) => onChange({ x: Number(e.target.value) })} /><span className="w-10">{spot.x}</span></label>
      <label className="flex items-center gap-1">Down % <input className="w-28" type="range" min={0} max={100} step={0.5} value={spot.y} onChange={(e) => onChange({ y: Number(e.target.value) })} /><span className="w-10">{spot.y}</span></label>
      <label className="flex items-center gap-1">Size <input className={`${INPUT} w-14`} type="number" min={6} max={36} value={spot.size} onChange={(e) => onChange({ size: num(e.target.value, 6, 36) })} /></label>
      <label className="flex items-center gap-1">Label <input className={`${INPUT} w-32`} value={spot.label} onChange={(e) => onChange({ label: e.target.value })} /></label>
      <button type="button" className="text-muted hover:text-danger" onClick={onRemove}>Remove</button>
    </div>
  );
}
