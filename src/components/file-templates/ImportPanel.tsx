"use client";
// Template Manager add-on — "Add templates": load the whole Template Library folder, upload your own files
// (they land in the Inbox, duplicates are skipped by fingerprint) or save a link (Google Docs, Notion...).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addLinkTemplateAction, importCatalogAction, newInboxTemplatesAction, registerFilesAction, type FileRow } from "@/app/file-template-actions";
import { BASE, MAX_FILE } from "@/lib/file-templates/constants";
import { catalogRows, planImport } from "@/lib/file-templates/query";
import { fingerprint, runPool, uploadTemplateFile } from "./client";
import { BOX, BTN_PLAIN, BTN_PRIMARY, INPUT, LABEL } from "./ui";

type Progress = { label: string; done: number; total: number } | null;

export default function ImportPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [log, setLog] = useState<{ text: string; bad?: boolean }[]>([]);
  const [drag, setDrag] = useState(false);
  const [link, setLink] = useState({ name: "", url: "" });
  const folderInput = useRef<HTMLInputElement>(null);
  const add = (text: string, bad = false) => setLog((l) => [...l, { text, bad }]);

  // Non-standard attributes that let the file picker choose a whole folder (Chrome, Edge, Firefox, Safari).
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);

  // ---------------------------------------------------------------- whole library folder
  async function importFolder(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    setLog([]);
    const paths = files.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    const catIdx = paths.findIndex((p) => /(^|\/)catalog\.json$/.test(p) && !p.includes("/_generator/"));
    if (catIdx < 0) return add("That folder has no catalog.json. Pick the Template Library folder itself (the one with EN, ES and catalog.json).", true);
    setBusy(true);
    try {
      let json: unknown;
      try {
        json = JSON.parse(await files[catIdx].text());
      } catch {
        return add("catalog.json could not be read.", true);
      }
      const { rows, error } = catalogRows(json);
      if (error) return add(error, true);
      setProgress({ label: "Creating templates", done: 0, total: rows.length });
      const r = await importCatalogAction(json);
      if (!r.ok) return add(r.error, true);
      add(`${r.created} new templates, ${r.updated} already there (names and descriptions refreshed, your status, tags and notes kept).`);
      const plan = planImport(Object.keys(r.ids), paths);
      const known = new Set(r.known);
      const rows2: FileRow[] = [];
      let skipped = 0;
      let failed = 0;
      setProgress({ label: "Uploading files", done: 0, total: plan.files.length });
      await runPool(
        plan.files,
        4,
        async (p) => {
          const file = files[p.index];
          const sha = await fingerprint(file);
          if (sha && known.has(sha)) {
            skipped++;
            return;
          }
          const up = await uploadTemplateFile(file, r.ids[p.code], p.lang, sha);
          if ("error" in up) {
            failed++;
            add(up.error, true);
          } else rows2.push(up.row);
        },
        (done) => setProgress({ label: "Uploading files", done, total: plan.files.length }),
      );
      for (let i = 0; i < rows2.length; i += 40) {
        const s = await registerFilesAction(rows2.slice(i, i + 40));
        if (!s.ok) add(s.error, true);
      }
      add(`Files: ${rows2.length} uploaded, ${skipped} unchanged (already there)${failed ? `, ${failed} failed` : ""}.`, failed > 0);
      if (plan.skipped.length) add(`${plan.skipped.length} other files in the folder were ignored (not part of the catalog).`);
      add("Done. Open the Library to browse them.");
      router.refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // ---------------------------------------------------------------- your own files -> Inbox
  async function uploadOwn(list: FileList | File[] | null) {
    const files = list ? Array.from(list).filter((f) => f.size > 0) : [];
    if (!files.length) return;
    setLog([]);
    const big = files.filter((f) => f.size > MAX_FILE);
    big.forEach((f) => add(`${f.name} is larger than 50 MB and was skipped.`, true));
    const ok = files.filter((f) => f.size <= MAX_FILE).slice(0, 200);
    if (!ok.length) return;
    setBusy(true);
    try {
      setProgress({ label: "Checking for duplicates", done: 0, total: ok.length });
      const shas: (string | null)[] = [];
      for (let i = 0; i < ok.length; i++) {
        shas.push(await fingerprint(ok[i]));
        setProgress({ label: "Checking for duplicates", done: i + 1, total: ok.length });
      }
      const r = await newInboxTemplatesAction(ok.map((f, i) => ({ name: f.name, sha256: shas[i] })));
      if (!r.ok) return add(r.error, true);
      const rows: FileRow[] = [];
      const jobs = ok.map((f, i) => ({ f, i })).filter(({ i }) => r.results[i]?.id);
      r.results.forEach((x, i) => { if (x.duplicateOf) add(`${ok[i].name} is already in your library as “${x.duplicateOf.name}”, skipped.`); });
      setProgress({ label: "Uploading", done: 0, total: jobs.length });
      await runPool(
        jobs,
        3,
        async ({ f, i }) => {
          const up = await uploadTemplateFile(f, r.results[i].id!, null, shas[i]);
          if ("error" in up) add(up.error, true);
          else rows.push(up.row);
        },
        (done) => setProgress({ label: "Uploading", done, total: jobs.length }),
      );
      if (rows.length) {
        const s = await registerFilesAction(rows);
        if (!s.ok) add(s.error, true);
      }
      add(`${rows.length} new template${rows.length === 1 ? "" : "s"} added to the Inbox.`);
      router.refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function saveLink() {
    setBusy(true);
    const r = await addLinkTemplateAction(link.name, link.url);
    setBusy(false);
    if (!r.ok) return add(r.error, true);
    setLink({ name: "", url: "" });
    router.push(`${BASE}/${r.id}`);
  }

  return (
    <div className="space-y-4">
      <section className={`${BOX} space-y-3`}>
        <div>
          <h2 className="font-semibold">Load the Template Library folder</h2>
          <p className="text-sm text-muted">
            Pick the <b>Template Library</b> folder inside PERSONAL OS. It loads all 127 professional templates in English and Spanish, with when to use each one. Running it again only uploads files that changed.
          </p>
        </div>
        <input
          ref={folderInput}
          type="file"
          className="sr-only"
          multiple
          onChange={(e) => { void importFolder(e.target.files); e.target.value = ""; }}
        />
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => folderInput.current?.click()}>Choose the Template Library folder…</button>
        <p className="text-xs text-muted">The browser asks you to confirm the upload of the folder: that is normal. Everything goes to your private storage.</p>
      </section>

      <section className={`${BOX} space-y-3`}>
        <div>
          <h2 className="font-semibold">Upload your own templates</h2>
          <p className="text-sm text-muted">Any format: Word, Excel, PowerPoint, PDF, CSV, Markdown, images. They go to the <Link href={`${BASE}/inbox`} className="text-accent hover:underline">Inbox</Link> to be classified. Files you already have are detected and skipped.</p>
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) void uploadOwn(Array.from(e.dataTransfer.files)); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center text-sm ${drag ? "border-accent bg-accent-soft" : "border-line"}`}
        >
          <span className="font-medium">Drop files here or click to choose</span>
          <span className="text-xs text-muted">Up to 200 files at once, 50 MB each</span>
          <input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => { void uploadOwn(e.target.files); e.target.value = ""; }} />
        </label>
      </section>

      <section className={`${BOX} space-y-3`}>
        <div>
          <h2 className="font-semibold">Save a link</h2>
          <p className="text-sm text-muted">For templates that live online (Google Docs or Sheets, Notion, a website).</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
          <label className={LABEL}>Name<input className={INPUT} value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} /></label>
          <label className={LABEL}>Link<input className={INPUT} value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://…" /></label>
          <button type="button" className={BTN_PLAIN} disabled={busy || !link.name.trim() || !link.url.trim()} onClick={() => void saveLink()}>Save link</button>
        </div>
      </section>

      {(progress || log.length > 0) && (
        <section className={`${BOX} space-y-2`} aria-live="polite">
          {progress && (
            <div className="space-y-1">
              <p className="text-sm">{progress.label}… {progress.done} / {progress.total}</p>
              <div className="h-2 overflow-hidden rounded-full bg-subtle">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
            </div>
          )}
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {log.map((l, i) => <li key={i} className={l.bad ? "text-danger" : ""}>{l.text}</li>)}
          </ul>
          {!busy && log.length > 0 && <Link href={BASE} className="text-sm text-accent hover:underline">Go to the Library →</Link>}
        </section>
      )}
    </div>
  );
}
