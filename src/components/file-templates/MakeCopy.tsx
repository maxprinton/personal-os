"use client";
// Template Manager add-on, phase 2 — "Make a working copy" on a template page.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makeCopyAction } from "@/app/file-template-copy-actions";
import { BASE } from "@/lib/file-templates/constants";
import { displayName, editableKind, fileUrl } from "@/lib/file-templates/query";
import type { FileTemplate, Lang, TmCopy } from "@/lib/file-templates/types";
import { BOX, BTN_PRIMARY, BTN_SMALL, INPUT, LABEL, SELECT } from "./ui";

export default function MakeCopy({ t, copies, lang, projects }: { t: FileTemplate; copies: TmCopy[]; lang: Lang; projects: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const originals = (t.tm_files ?? []).filter((f) => f.role === "original").sort((a, b) => (a.lang === lang ? -1 : b.lang === lang ? 1 : 0));
  const [open, setOpen] = useState(false);
  const [fileId, setFileId] = useState(originals[0]?.id ?? "");
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; copyId?: string; path?: string } | null>(null);
  const name = displayName(t, lang);
  const autoTitle = project.trim() ? `${name} · ${project.trim()}` : name;
  const chosen = originals.find((f) => f.id === fileId);

  const make = () =>
    start(async () => {
      const r = await makeCopyAction({ templateId: t.id, fileId, title: title.trim() || autoTitle, project });
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      setMsg({ text: "Working copy created. Your download starts now.", copyId: r.copyId, path: r.path });
      setOpen(false);
      setProject("");
      setTitle("");
      window.location.href = fileUrl(r.path, true);
      router.refresh();
    });

  if (t.format === "link") return null;

  return (
    <section className={`${BOX} space-y-3`} aria-label="Working copies">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Working copies {copies.length > 0 && <span className="text-muted">· {copies.length}</span>}</h3>
          <p className="text-xs text-muted">Use the template for a project without touching the original. Edit the copy in your own app, then upload it back as a new version.</p>
        </div>
        {originals.length > 0 && !open && <button type="button" className={BTN_PRIMARY} onClick={() => setOpen(true)}>Make a working copy</button>}
      </div>

      {open && (
        <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
          <label className={LABEL}>Project
            <input className={INPUT} list="tm-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Booking app, course module 3…" autoFocus />
            <datalist id="tm-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className={LABEL}>File to copy
            <select className={`${SELECT} w-full`} value={fileId} onChange={(e) => setFileId(e.target.value)}>
              {originals.map((f) => <option key={f.id} value={f.id}>{f.lang ? `${f.lang.toUpperCase()} · ` : ""}{f.file_name}</option>)}
            </select>
          </label>
          <label className={`${LABEL} sm:col-span-2`}>Title
            <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} />
          </label>
          {chosen && editableKind(chosen.file_name) && project.trim() && (
            <p className="text-xs text-muted sm:col-span-2">This is a text file: <code>{"{{project_name}}"}</code> and <code>{"{{date}}"}</code> will be filled in the copy.</p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={BTN_PRIMARY} disabled={pending || !fileId} onClick={make}>{pending ? "Copying…" : "Create and download"}</button>
            <button type="button" className={BTN_SMALL} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {msg && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-subtle"}`}>
          {msg.text}{" "}
          {msg.copyId && <Link href={`${BASE}/copies/${msg.copyId}`} className="text-accent hover:underline">Open the copy →</Link>}
        </p>
      )}

      {copies.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {copies.map((c) => {
            const v = (c.tm_files ?? []).reduce((m, f) => Math.max(m, f.version ?? 0), 0);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <Link href={`${BASE}/copies/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
                <span className="text-xs text-muted">{c.project ? `${c.project} · ` : ""}v{v} · {c.updated_at.slice(0, 10)} · {c.status}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
