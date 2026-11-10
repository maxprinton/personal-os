"use client";
// Template Manager add-on — one template: when to use it, its files (download / add / remove) and its properties.
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { recordUseAction, registerFilesAction, removeFileAction, trashAction, updateTemplateAction } from "@/app/file-template-actions";
import { ABOUT_LABEL, BASE, FORMATS, FORMAT_LABEL, GROUPS, GROUP_LABEL, PHASES, PHASE_LABEL, STATUSES, STATUS_LABEL } from "@/lib/file-templates/constants";
import { aboutIn, displayName, fileUrl, prettySize } from "@/lib/file-templates/query";
import type { About, FileTemplate, Lang } from "@/lib/file-templates/types";
import { fingerprint, readPref, uploadTemplateFile, writePref } from "./client";
import { BOX, BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, BTN_SMALL, FormatBadge, GroupBadge, INPUT, LABEL, PhaseBadge, SELECT, StatusBadge } from "./ui";

const KEYS = ["best", "use", "skip", "value", "vars"] as const;

export default function TemplateDetail({ t }: { t: FileTemplate }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lang, setLang] = useState<Lang>("en");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [form, setForm] = useState(() => toForm(t));
  const [upLang, setUpLang] = useState<"en" | "es" | "none">("en");
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(t));

  useEffect(() => setLang(readPref("tm.lang", ["en", "es"] as const, "en")), []);
  useEffect(() => setForm(toForm(t)), [t]);

  const about = aboutIn(t, lang);
  const files = (t.tm_files ?? []).filter((f) => f.role === "original").sort((a, b) => (a.lang ?? "z").localeCompare(b.lang ?? "z"));

  const say = (r: { ok: boolean; error?: string }, ok: string) => setMsg(r.ok ? { text: ok } : { text: r.error ?? "Something went wrong.", bad: true });

  const save = () =>
    start(async () => {
      const r = await updateTemplateAction(t.id, {
        name: form.name, name_es: form.name_es, phase: form.phase || null, grp: form.grp, format: form.format, status: form.status,
        tags: form.tags, rating: form.rating ? Number(form.rating) : null, source: form.source, source_url: form.source_url,
        doc_type: form.doc_type, notes: form.notes, about: form.about,
      });
      say(r, "Saved.");
      if (r.ok) router.refresh();
    });

  const quick = (patch: Record<string, unknown>, ok: string) =>
    start(async () => {
      const r = await updateTemplateAction(t.id, patch);
      say(r, ok);
      if (r.ok) router.refresh();
    });

  const upload = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    start(async () => {
      setMsg({ text: `Uploading ${file.name}…` });
      const sha = await fingerprint(file);
      const up = await uploadTemplateFile(file, t.id, upLang === "none" ? null : upLang, sha);
      if ("error" in up) return setMsg({ text: up.error, bad: true });
      const r = await registerFilesAction([up.row]);
      say(r, `Added ${file.name}.`);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Link href={BASE} className="text-sm text-muted hover:text-fg">← Library</Link>
          <h2 className="text-xl font-semibold tracking-tight">
            {t.code && <span className="mr-2 font-mono text-base text-muted">{t.code}</span>}
            {displayName(t, lang)}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <PhaseBadge phase={t.phase} lang={lang} /><GroupBadge grp={t.grp} lang={lang} /><FormatBadge format={t.format} /><StatusBadge status={t.status} />
            {t.times_used > 0 && <span className="text-xs text-muted">Used {t.times_used}×{t.last_used_at ? `, last ${t.last_used_at.slice(0, 10)}` : ""}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Language" className="inline-flex rounded-md border border-line-strong p-0.5">
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => { setLang(l); writePref("tm.lang", l); }} className={`rounded px-2 py-1 text-xs font-medium ${lang === l ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"}`}>{l.toUpperCase()}</button>
            ))}
          </div>
          <button type="button" className={`${BTN_PLAIN} ${t.favorite ? "border-amber-500 text-amber-600" : ""}`} disabled={pending} onClick={() => quick({ favorite: !t.favorite }, t.favorite ? "Removed from favorites." : "Added to favorites.")} aria-pressed={t.favorite}>
            <Icon name="star" size={15} /> {t.favorite ? "Favorite" : "Add to favorites"}
          </button>
          {t.status !== "ready" && <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={() => quick({ status: "ready" }, "Marked ready to use.")}>Mark ready to use</button>}
        </div>
      </div>

      {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-subtle"}`}>{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className={`${BOX} space-y-3`} aria-label="When to use it">
          <h3 className="text-sm font-semibold">{lang === "es" ? "Cuándo usarla" : "When to use it"}</h3>
          {KEYS.some((k) => about[k]) ? (
            <dl className="space-y-2.5 text-sm">
              {about.best && <Row label={ABOUT_LABEL[lang].best} text={about.best} />}
              {about.use && <Row label={ABOUT_LABEL[lang].use} text={about.use} tone="text-success" />}
              {about.skip && <Row label={ABOUT_LABEL[lang].skip} text={about.skip} tone="text-danger" />}
              {about.value && <Row label={ABOUT_LABEL[lang].value} text={about.value} />}
              {about.vars && <Row label={ABOUT_LABEL[lang].vars} text={about.vars} />}
              {about.refs && <Row label={lang === "es" ? "Referencias" : "References"} text={about.refs} small />}
            </dl>
          ) : (
            <p className="text-sm text-muted">No description yet. Add &ldquo;best for&rdquo;, &ldquo;use it when&rdquo; and &ldquo;skip it when&rdquo; below, so future you knows when to pick it.</p>
          )}
        </section>

        <section className={`${BOX} space-y-3`} aria-label="Files">
          <h3 className="text-sm font-semibold">Files</h3>
          {t.format === "link" && t.source_url && (
            <a href={t.source_url} target="_blank" rel="noreferrer" onClick={() => void recordUseAction(t.id)} className={BTN_PRIMARY}>Open link ↗</a>
          )}
          {files.length ? (
            <ul className="space-y-2 text-sm">
              {files.map((f) => (
                <li key={f.id} className="space-y-1 rounded-md border border-line p-2">
                  <p className="break-words font-medium">{f.lang && <span className="mr-1 rounded bg-subtle px-1 text-xs">{f.lang.toUpperCase()}</span>}{f.file_name}</p>
                  <p className="text-xs text-muted">{prettySize(f.size)}</p>
                  <div className="flex flex-wrap gap-1">
                    <a href={fileUrl(f.storage_path, true)} onClick={() => void recordUseAction(t.id)} className={BTN_SMALL}><Icon name="import" size={13} /> Download</a>
                    <a href={fileUrl(f.storage_path)} target="_blank" rel="noreferrer" className={BTN_SMALL}>Open</a>
                    {confirmFile === f.id ? (
                      <>
                        <button type="button" className={`${BTN_SMALL} border-danger text-danger`} disabled={pending} onClick={() => start(async () => { const r = await removeFileAction(f.id); say(r, "File removed."); setConfirmFile(null); if (r.ok) router.refresh(); })}>Remove for good</button>
                        <button type="button" className={BTN_SMALL} onClick={() => setConfirmFile(null)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className={`${BTN_SMALL} text-muted`} onClick={() => setConfirmFile(f.id)}>Remove</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            t.format !== "link" && <p className="text-sm text-muted">No file yet.</p>
          )}
          <div className="space-y-1.5 border-t border-line pt-3">
            <p className="text-xs text-muted">Add or replace a file (same name replaces):</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={upLang} onChange={(e) => setUpLang(e.target.value as "en" | "es" | "none")} className={`${SELECT} py-1 text-xs`} aria-label="File language">
                <option value="en">English</option><option value="es">Spanish</option><option value="none">No language</option>
              </select>
              <label className={`${BTN_SMALL} cursor-pointer`}>
                Choose file…
                <input type="file" className="sr-only" disabled={pending} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          </div>
          <p className="border-t border-line pt-3 text-xs text-muted">
            Library templates use fields like <code>{"{{project_name}}"}</code>. Filling them automatically comes in the next phase; for now use Find and Replace in Word or Excel.
          </p>
        </section>
      </div>

      <details className={BOX} open={!t.code}>
        <summary className="cursor-pointer text-sm font-semibold">Edit properties and description</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>Name (English)<input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className={LABEL}>Name (Spanish)<input className={INPUT} value={form.name_es} onChange={(e) => setForm({ ...form, name_es: e.target.value })} /></label>
          <label className={LABEL}>Phase
            <select className={`${SELECT} w-full`} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>
              <option value="">No phase</option>
              {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p].en}</option>)}
            </select>
          </label>
          <label className={LABEL}>Approach
            <select className={`${SELECT} w-full`} value={form.grp} onChange={(e) => setForm({ ...form, grp: e.target.value })}>
              {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g].en}</option>)}
            </select>
          </label>
          <label className={LABEL}>Format
            <select className={`${SELECT} w-full`} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              {FORMATS.map((x) => <option key={x} value={x}>{FORMAT_LABEL[x]}</option>)}
            </select>
          </label>
          <label className={LABEL}>Status
            <select className={`${SELECT} w-full`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className={LABEL}>Tags (comma separated)<input className={INPUT} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="course, client, favorite format…" /></label>
          <label className={LABEL}>Rating
            <select className={`${SELECT} w-full`} value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
              <option value="">No rating</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
            </select>
          </label>
          <label className={LABEL}>Document type<input className={INPUT} value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} placeholder="Charter, risk register, report…" /></label>
          <label className={LABEL}>Source<input className={INPUT} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Course, website, person…" /></label>
          <label className={`${LABEL} sm:col-span-2`}>Link (template online, or where you found it)<input className={INPUT} value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://…" /></label>
          <label className={`${LABEL} sm:col-span-2`}>Your notes<textarea className={`${INPUT} min-h-20`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        </div>
        {(["en", "es"] as const).map((l) => (
          <fieldset key={l} className="mt-4 space-y-2 border-t border-line pt-3">
            <legend className="text-xs font-semibold text-muted">Description in {l === "en" ? "English" : "Spanish"}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {KEYS.map((k) => (
                <label key={k} className={LABEL}>{ABOUT_LABEL[l][k]}
                  <textarea className={`${INPUT} min-h-16`} value={form.about[l][k] ?? ""} onChange={(e) => setForm({ ...form, about: { ...form.about, [l]: { ...form.about[l], [k]: e.target.value } } })} />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <button type="button" className={BTN_DANGER} disabled={pending} onClick={() => start(async () => { const r = await trashAction([t.id]); if (r.ok) router.push(`${BASE}/trash`); else say(r, ""); })}>Move to trash</button>
          <div className="flex gap-2">
            {dirty && <button type="button" className={BTN_PLAIN} onClick={() => setForm(toForm(t))}>Undo changes</button>}
            <button type="button" className={BTN_PRIMARY} disabled={pending || !dirty || !form.name.trim()} onClick={save}>{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </details>
    </div>
  );
}

function Row({ label, text, tone, small }: { label: string; text: string; tone?: string; small?: boolean }) {
  return (
    <div>
      <dt className={`text-xs font-semibold ${tone ?? "text-muted"}`}>{label}</dt>
      <dd className={small ? "text-xs text-muted" : ""}>{text}</dd>
    </div>
  );
}

function toForm(t: FileTemplate) {
  const pick = (a: About | undefined) => Object.fromEntries(KEYS.map((k) => [k, a?.[k] ?? ""])) as Record<(typeof KEYS)[number], string> & { refs?: string };
  const en = { ...pick(t.about?.en), ...(t.about?.en?.refs ? { refs: t.about.en.refs } : {}) };
  const es = { ...pick(t.about?.es), ...(t.about?.es?.refs ? { refs: t.about.es.refs } : {}) };
  return {
    name: t.name, name_es: t.name_es ?? "", phase: t.phase ?? "", grp: t.grp as string, format: t.format as string, status: t.status as string,
    tags: (t.tags ?? []).join(", "), rating: t.rating ? String(t.rating) : "", source: t.source ?? "", source_url: t.source_url ?? "",
    doc_type: t.doc_type ?? "", notes: t.notes ?? "", about: { en, es },
  };
}
