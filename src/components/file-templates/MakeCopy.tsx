"use client";
// Template Manager add-on — "Make a working copy" on a template page. Phase 3: pick (or type) a project and the copy
// comes out filled from its profile; anything the file needs that the profile lacks is asked here first.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makeCopyAction } from "@/app/file-template-copy-actions";
import { draftBlanksAction, prepareFillAction } from "@/app/file-template-project-actions";
import { BASE } from "@/lib/file-templates/constants";
import { FIELD, labelOf } from "@/lib/file-templates/fields";
import { displayName, editableKind, fileUrl } from "@/lib/file-templates/query";
import type { FileTemplate, Lang, TmCopy } from "@/lib/file-templates/types";
import { BOX, BTN_PRIMARY, BTN_SMALL, INPUT, LABEL, SELECT } from "./ui";

const FILLABLE = /\.(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pdf|md|markdown|txt|csv|mmd|mermaid)$/i;

type Plan = { projectId: string | null; created: boolean; lang: Lang; missing: string[]; asks: { key: string; label: string }[]; confirmed: boolean; blanks: number };
type Msg = { text: string; bad?: boolean; copyId?: string; projectId?: string; skipped?: string[] } | null;

export default function MakeCopy({ t, copies, lang, projects, profiles = [], profilesReady = false }: { t: FileTemplate; copies: TmCopy[]; lang: Lang; projects: string[]; profiles?: { id: string; name: string }[]; profilesReady?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const originals = (t.tm_files ?? []).filter((f) => f.role === "original").sort((a, b) => (a.lang === lang ? -1 : b.lang === lang ? 1 : 0));
  const [open, setOpen] = useState(false);
  const [fileId, setFileId] = useState(originals[0]?.id ?? "");
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saveAnswers, setSaveAnswers] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const name = displayName(t, lang);
  const autoTitle = project.trim() ? `${name} · ${project.trim()}` : name;
  const chosen = originals.find((f) => f.id === fileId);
  const fillable = !!chosen && FILLABLE.test(chosen.file_name);
  const names = [...new Set([...profiles.map((p) => p.name), ...projects])].sort((a, b) => a.localeCompare(b));
  const isNew = !!project.trim() && !profiles.some((p) => p.name.toLowerCase() === project.trim().toLowerCase());

  const reset = () => {
    setOpen(false);
    setPlan(null);
    setAnswers({});
    setProject("");
    setTitle("");
  };

  const create = (p: Plan | null) =>
    start(async () => {
      const r = await makeCopyAction({
        templateId: t.id,
        fileId,
        title: title.trim() || autoTitle,
        project,
        projectId: p?.projectId ?? null,
        answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim())),
        saveAnswers,
      });
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      const filled = p?.projectId ? ` Filled ${r.filled} blank${r.filled === 1 ? "" : "s"} from the profile.` : "";
      setMsg({ text: `Working copy created.${filled} Your download starts now.`, copyId: r.copyId, projectId: p?.created ? p.projectId ?? undefined : undefined, skipped: r.skipped });
      reset();
      window.location.href = fileUrl(r.path, true);
      router.refresh();
    });

  const next = () =>
    start(async () => {
      setMsg(null);
      if (!profilesReady || !project.trim() || !fillable) return create(null);
      const r = await prepareFillAction({ fileId, project });
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      if (!r.missing.length && !r.asks.length) {
        setPlan(r);
        return create(r);
      }
      setPlan(r);
    });

  const draftAll = () =>
    startDraft(async () => {
      if (!plan) return;
      const r = await draftBlanksAction({ project, lang: plan.lang, template: name, labels: plan.asks.map((a) => a.label) });
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      setAnswers((a) => {
        const out = { ...a };
        for (const ask of plan.asks) if (r.drafts[ask.label] && !out[ask.key]?.trim()) out[ask.key] = r.drafts[ask.label];
        return out;
      });
    });

  if (t.format === "link") return null;

  return (
    <section className={`${BOX} space-y-3`} aria-label="Working copies">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Working copies {copies.length > 0 && <span className="text-muted">· {copies.length}</span>}</h3>
          <p className="text-xs text-muted">
            Use the template for a project without touching the original.{profilesReady ? " Pick a project and the copy comes out filled from its profile." : ""} Edit the copy in your own app, then upload it back as a new version.
          </p>
        </div>
        {originals.length > 0 && !open && <button type="button" className={BTN_PRIMARY} onClick={() => setOpen(true)}>Make a working copy</button>}
      </div>

      {open && !plan && (
        <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
          <label className={LABEL}>Project
            <input className={INPUT} list="tm-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Booking app, course module 3…" autoFocus />
            <datalist id="tm-projects">{names.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className={LABEL}>File to copy
            <select className={`${SELECT} w-full`} value={fileId} onChange={(e) => setFileId(e.target.value)}>
              {originals.map((f) => <option key={f.id} value={f.id}>{f.lang ? `${f.lang.toUpperCase()} · ` : ""}{f.file_name}</option>)}
            </select>
          </label>
          <label className={`${LABEL} sm:col-span-2`}>Title
            <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} />
          </label>
          {profilesReady && project.trim() && fillable && (
            <p className="text-xs text-muted sm:col-span-2">
              {isNew ? <>A new profile <b>{project.trim()}</b> will be created (it starts with My details). </> : <>Filled from the profile <b>{project.trim()}</b>. </>}
              {chosen?.lang ? `The ${chosen.lang === "es" ? "Spanish" : "English"} text of the profile is used.` : ""}
            </p>
          )}
          {(!profilesReady || !fillable) && chosen && editableKind(chosen.file_name) && project.trim() && (
            <p className="text-xs text-muted sm:col-span-2">This is a text file: <code>{"{{project_name}}"}</code> and <code>{"{{date}}"}</code> will be filled in the copy.</p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={BTN_PRIMARY} disabled={pending || !fileId} onClick={next}>{pending ? "Working…" : "Create and download"}</button>
            <button type="button" className={BTN_SMALL} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {open && plan && (
        <div className="space-y-3 rounded-md border border-line p-3">
          <div>
            <p className="text-sm font-medium">A few things before the copy</p>
            <p className="text-xs text-muted">
              {plan.created ? <>A new profile was created for <b>{project.trim()}</b>. </> : null}
              This file uses {plan.missing.length ? "details the profile doesn't have yet" : ""}{plan.missing.length && plan.asks.length ? " and " : ""}{plan.asks.length ? "blanks you answer for each copy" : ""}. Leave anything empty to keep its blank in the file.
            </p>
          </div>
          {plan.missing.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {plan.missing.map((k) => {
                const f = FIELD[k];
                if (!f) return null;
                if (f.kind === "table") {
                  return <p key={k} className="text-xs text-muted sm:col-span-2">{labelOf(k, plan.lang)}: add the rows in the <Link href={`${BASE}/projects/${plan.projectId}`} className="text-accent hover:underline" target="_blank">project profile</Link> (they fill the table), or leave it empty.</p>;
                }
                const long = f.kind === "long" || f.kind === "list";
                return (
                  <label key={k} className={`${LABEL} ${long ? "sm:col-span-2" : ""}`}>
                    {labelOf(k, plan.lang)}{f.kind === "list" ? " · one per line" : ""}
                    {long ? (
                      <textarea className={`${INPUT} min-h-16`} value={answers[k] ?? ""} onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })} placeholder={f.hint?.[plan.lang] ?? ""} />
                    ) : (
                      <input className={INPUT} type={f.kind === "date" ? "date" : "text"} value={answers[k] ?? ""} onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })} placeholder={f.hint?.[plan.lang] ?? ""} />
                    )}
                  </label>
                );
              })}
              <label className="flex items-center gap-2 text-xs text-muted sm:col-span-2">
                <input type="checkbox" checked={saveAnswers} onChange={(e) => setSaveAnswers(e.target.checked)} /> Save these in the project profile (next templates get them too)
              </label>
            </div>
          )}
          {plan.asks.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">Blanks of this template (asked every time)</p>
                <button type="button" className={BTN_SMALL} disabled={drafting} onClick={draftAll} title="The AI writes a first version of each from the project's profile. Read and edit before creating the copy.">
                  {drafting ? "Drafting…" : "✨ Draft them with AI"}
                </button>
              </div>
              {plan.asks.map((a) => (
                <label key={a.key} className={LABEL}>
                  {a.label}
                  <textarea className={`${INPUT} min-h-14`} value={answers[a.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [a.key]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={() => create(plan)}>{pending ? "Filling…" : "Create and download"}</button>
            <button type="button" className={BTN_SMALL} onClick={() => setPlan(null)}>Back</button>
          </div>
        </div>
      )}

      {msg && (
        <div role="status" className={`space-y-1 rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-subtle"}`}>
          <p>
            {msg.text}{" "}
            {msg.copyId && <Link href={`${BASE}/copies/${msg.copyId}`} className="text-accent hover:underline">Open the copy →</Link>}
          </p>
          {msg.skipped && msg.skipped.length > 0 && <p className="text-xs text-muted">Left blank (no value yet): {msg.skipped.join(", ")}.</p>}
          {msg.projectId && <p className="text-xs"><Link href={`${BASE}/projects/${msg.projectId}`} className="text-accent hover:underline">Complete the new project profile →</Link></p>}
        </div>
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
