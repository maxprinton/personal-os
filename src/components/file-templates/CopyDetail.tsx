"use client";
// Template Manager add-on, phase 2 — one working copy: versions, upload a new version, edit text/CSV/Mermaid here.
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { MermaidPreview } from "@/components/editor/CodeBlockView";
import { addVersionAction, deleteCopyAction, deleteVersionAction, updateCopyAction } from "@/app/file-template-copy-actions";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/files";
import { BASE, BUCKET, MAX_FILE } from "@/lib/file-templates/constants";
import { copyPath, editableKind, extOf, fileUrl, mermaidBlock, prettySize, rowsToCsv, sortVersions, squareRows } from "@/lib/file-templates/query";
import type { TmCopy } from "@/lib/file-templates/types";
import { fingerprint, myUserId } from "./client";
import { BOX, BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, BTN_SMALL, INPUT, LABEL, SELECT } from "./ui";

type Msg = { text: string; bad?: boolean } | null;

async function uploadVersion(copy: TmCopy, file: Blob, fileName: string, note: string): Promise<{ ok: boolean; error?: string; version?: number }> {
  if (file.size > MAX_FILE) return { ok: false, error: "The file is larger than 50 MB." };
  const uid = await myUserId();
  if (!uid) return { ok: false, error: "You are signed out." };
  const path = copyPath(uid, copy.template_id, copy.id, fileName);
  const { error } = await createClient().storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) return { ok: false, error: error.message };
  const sha = file instanceof File ? await fingerprint(file) : null;
  const r = await addVersionAction({ copyId: copy.id, storage_path: path, file_name: fileName, mime: file.type || null, size: file.size, sha256: sha, note });
  return r.ok ? { ok: true, version: r.version } : { ok: false, error: r.error };
}

export default function CopyDetail({ copy }: { copy: TmCopy }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState({ title: copy.title, project: copy.project ?? "", status: copy.status as string, notes: copy.notes ?? "" });
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const versions = sortVersions(copy.tm_files ?? []);
  const latest = versions[0];
  const kind = latest ? editableKind(latest.file_name) : null;
  const dirty = form.title !== copy.title || form.project !== (copy.project ?? "") || form.status !== copy.status || form.notes !== (copy.notes ?? "");

  useEffect(() => setForm({ title: copy.title, project: copy.project ?? "", status: copy.status, notes: copy.notes ?? "" }), [copy]);

  const upload = (list: FileList | File[] | null) => {
    const file = list ? Array.from(list)[0] : null;
    if (!file) return;
    if (latest && extOf(file.name) !== extOf(latest.file_name)) {
      const ok = window.confirm(`The copy is a .${extOf(latest.file_name)} file and you picked a .${extOf(file.name)} file. Save it as the new version anyway?`);
      if (!ok) return;
    }
    start(async () => {
      setMsg({ text: `Uploading ${file.name}…` });
      const r = await uploadVersion(copy, file, file.name, note);
      setMsg(r.ok ? { text: `Saved as version ${r.version}.` } : { text: r.error ?? "Upload failed.", bad: true });
      if (r.ok) {
        setNote("");
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link href={`${BASE}/copies`} className="text-sm text-muted hover:text-fg">← Working copies</Link>
        <h2 className="text-xl font-semibold tracking-tight">{copy.title}</h2>
        <p className="text-sm text-muted">
          {copy.project ? `${copy.project} · ` : ""}from{" "}
          {copy.tm_templates ? <Link href={`${BASE}/${copy.tm_templates.id}`} className="text-accent hover:underline">{copy.tm_templates.code ? `${copy.tm_templates.code} ` : ""}{copy.tm_templates.name}</Link> : "a deleted template"}
          {" "}· {versions.length} version{versions.length === 1 ? "" : "s"}
        </p>
      </div>
      {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-subtle"}`}>{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className={`${BOX} space-y-3`} aria-label="Versions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Versions</h3>
            {latest && <a href={fileUrl(latest.storage_path, true)} className={BTN_PRIMARY}><Icon name="import" size={15} /> Download latest (v{latest.version})</a>}
          </div>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (!pending) upload(Array.from(e.dataTransfer.files)); }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-sm ${drag ? "border-accent bg-accent-soft" : "border-line"}`}
          >
            <span className="font-medium">Upload the edited file as a new version</span>
            <span className="text-xs text-muted">Drop it here or click. Earlier versions are kept.</span>
            <input type="file" className="sr-only" disabled={pending} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
          <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this version? (optional)" aria-label="Version note" />
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {versions.map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 p-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${i === 0 ? "bg-accent text-accent-fg" : "bg-subtle text-muted"}`}>v{v.version}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{v.file_name}</p>
                  <p className="text-xs text-muted">{v.created_at.slice(0, 16).replace("T", " ")} · {prettySize(v.size)}{v.note ? ` · ${v.note}` : ""}</p>
                </div>
                <a href={fileUrl(v.storage_path, true)} className={BTN_SMALL}>Download</a>
                {versions.length > 1 && (confirm === v.id ? (
                  <>
                    <button className={`${BTN_SMALL} border-danger text-danger`} disabled={pending} onClick={() => start(async () => { const r = await deleteVersionAction(v.id); setMsg(r.ok ? { text: `Version ${v.version} deleted.` } : { text: r.error, bad: true }); setConfirm(null); if (r.ok) router.refresh(); })}>Delete v{v.version}</button>
                    <button className={BTN_SMALL} onClick={() => setConfirm(null)}>Keep</button>
                  </>
                ) : (
                  <button className={`${BTN_SMALL} text-muted`} onClick={() => setConfirm(v.id)}>Delete</button>
                ))}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${BOX} space-y-3`} aria-label="Details">
          <h3 className="text-sm font-semibold">Details</h3>
          <label className={LABEL}>Title<input className={INPUT} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className={LABEL}>Project<input className={INPUT} value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} /></label>
          <label className={LABEL}>Status
            <select className={`${SELECT} w-full`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">In progress</option><option value="done">Done</option><option value="archived">Archived</option>
            </select>
          </label>
          <label className={LABEL}>Notes<textarea className={`${INPUT} min-h-20`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className={BTN_PRIMARY} disabled={pending || !dirty || !form.title.trim()} onClick={() => start(async () => { const r = await updateCopyAction(copy.id, form); setMsg(r.ok ? { text: "Saved." } : { text: r.error, bad: true }); if (r.ok) router.refresh(); })}>Save details</button>
          <div className="border-t border-line pt-3">
            {confirm === "copy" ? (
              <div className="flex flex-wrap gap-2">
                <button className={BTN_DANGER} disabled={pending} onClick={() => start(async () => { const r = await deleteCopyAction(copy.id); if (r.ok) router.push(`${BASE}/copies`); else setMsg({ text: r.error, bad: true }); })}>Delete copy and all versions</button>
                <button className={BTN_PLAIN} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            ) : (
              <button className={BTN_DANGER} onClick={() => setConfirm("copy")}>Delete this working copy…</button>
            )}
            <p className="mt-1 text-xs text-muted">The template and its original files are not affected.</p>
          </div>
        </section>
      </div>

      {latest && kind && <InAppEditor key={latest.id} copy={copy} path={latest.storage_path} fileName={latest.file_name} kind={kind} onSaved={(v) => { setMsg({ text: `Saved as version ${v}.` }); router.refresh(); }} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ in-app editor

function InAppEditor({ copy, path, fileName, kind, onSaved }: { copy: TmCopy; path: string; fileName: string; kind: "csv" | "mermaid" | "text"; onSaved: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const tsv = extOf(fileName) === "tsv";

  useEffect(() => {
    let alive = true;
    void createClient().storage.from(BUCKET).download(path).then(async ({ data, error }) => {
      if (!alive) return;
      if (error || !data) return setErr("Could not open the file.");
      const t = (await data.text()).replace(/^﻿/, "");
      setText(t);
      setOrig(t);
      if (kind === "csv") setGrid(squareRows(tsv ? t.split(/\r?\n/).filter((l) => l.length).map((l) => l.split("\t")) : parseCsv(t), 2));
    });
    return () => { alive = false; };
  }, [path, kind, tsv]);

  const current = kind === "csv" ? (tsv ? grid.map((r) => r.join("\t")).join("\r\n") + "\r\n" : rowsToCsv(grid)) : (text ?? "");
  const changed = text !== null && (kind === "csv" ? current.replace(/\r\n/g, "\n").trim() !== orig.replace(/\r\n/g, "\n").trim() : text !== orig);
  const diagram = kind === "mermaid" ? text : kind === "text" && text ? mermaidBlock(text) : null;

  const save = async () => {
    setSaving(true);
    const mime = kind === "csv" ? (tsv ? "text/tab-separated-values" : "text/csv") : "text/plain";
    const body = new Blob([kind === "csv" && !tsv ? "﻿" + current : current], { type: `${mime}; charset=utf-8` });
    const r = await uploadVersion(copy, body, fileName, note || "Edited in Personal OS");
    setSaving(false);
    if (!r.ok) return setErr(r.error ?? "Could not save.");
    setNote("");
    onSaved(r.version!);
  };

  const setCell = (ri: number, ci: number, v: string) => setGrid((g) => g.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)));
  const width = grid[0]?.length ?? 0;

  return (
    <section className={`${BOX} space-y-3`} aria-label="Edit here">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Edit here</h3>
          <p className="text-xs text-muted">Changes are saved as a new version; the current one stays in the history.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className={`${INPUT} w-56`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for this version" aria-label="Note for this version" />
          <button className={BTN_PRIMARY} disabled={!changed || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save as new version"}</button>
        </div>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      {text === null && !err && <p className="text-sm text-muted">Opening…</p>}

      {text !== null && kind === "csv" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button className={BTN_SMALL} onClick={() => setGrid((g) => [...g, Array(width).fill("")])}>+ Row</button>
            <button className={BTN_SMALL} onClick={() => setGrid((g) => g.map((r) => [...r, ""]))}>+ Column</button>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-line">
            <table className="border-collapse text-sm">
              <tbody>
                {grid.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? "bg-subtle font-medium" : ""}>
                    <td className="sticky left-0 border border-line bg-subtle px-1 text-center text-xs text-muted">
                      <button className="hover:text-danger" title="Delete row" aria-label={`Delete row ${ri + 1}`} onClick={() => setGrid((g) => g.filter((_, i) => i !== ri))}>{ri + 1}</button>
                    </td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-line p-0">
                        <input value={cell} onChange={(e) => setCell(ri, ci, e.target.value)} className="w-40 bg-transparent px-1.5 py-1 outline-none focus:bg-accent-soft" aria-label={`Row ${ri + 1}, column ${ci + 1}`} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td />
                  {Array.from({ length: width }, (_, ci) => (
                    <td key={ci} className="text-center">
                      <button className="text-xs text-muted hover:text-danger" title="Delete column" onClick={() => setGrid((g) => g.map((r) => r.filter((_, j) => j !== ci)))}>delete col</button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {text !== null && kind !== "csv" && (
        <div className={`grid gap-3 ${diagram ? "lg:grid-cols-2" : ""}`}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={kind === "text"} className={`${INPUT} min-h-[50vh] font-mono text-xs leading-relaxed`} aria-label="File text" />
          {diagram && (
            <div className="min-h-40 overflow-auto rounded-md border border-line bg-surface p-3">
              <p className="mb-2 text-xs text-muted">Diagram preview</p>
              <MermaidPreview code={diagram} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
