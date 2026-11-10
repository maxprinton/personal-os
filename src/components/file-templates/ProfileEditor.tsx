"use client";
// Template Manager add-on, phase 3 — edit a project profile (or "My details"): core details, people and the plan,
// in English and Spanish. Working copies are filled from it; copies made before a change can be refreshed.
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProjectAction, draftFieldAction, saveDefaultsAction, saveProjectAction, type Draft } from "@/app/file-template-project-actions";
import { refreshCopyAction, refreshProjectCopiesAction } from "@/app/file-template-copy-actions";
import { BASE } from "@/lib/file-templates/constants";
import { DEFAULT_KEYS, FIELD_DEFS, cleanProfile, isBilingual, labelOf, missingLang, slotOf, type Bi, type FieldDef, type ProfileData } from "@/lib/file-templates/fields";
import type { Lang, TmProject } from "@/lib/file-templates/types";
import { readPref, writePref } from "./client";
import { BOX, BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, BTN_SMALL, INPUT, LABEL } from "./ui";

export type ProjectCopy = { id: string; title: string; template: string; version: number; outdated: string[]; editedAfterFill: boolean; updated_at: string };

type Tab = "core" | "people" | "plan";
const TABS: { key: Tab; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "people", label: "People" },
  { key: "plan", label: "Plan" },
];

const other = (l: Lang): Lang => (l === "en" ? "es" : "en");

export default function ProfileEditor({ project, defaults = false, copies = [] }: { project: TmProject | null; defaults?: boolean; copies?: ProjectCopy[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = useMemo(() => ({ name: project?.name ?? "", code: project?.code ?? "", notes: project?.notes ?? "", data: project?.data ?? cleanProfile(null) }), [project]);
  const [form, setForm] = useState(initial);
  const [lang, setLang] = useState<Lang>("en");
  const [tab, setTab] = useState<Tab>("core");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [spread, setSpread] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => setForm(initial), [initial]);
  useEffect(() => setLang(readPref("tm.profileLang", ["en", "es"] as const, "en")), []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const pickLang = (l: Lang) => {
    setLang(l);
    writePref("tm.profileLang", l);
  };
  const setData = (fn: (d: ProfileData) => ProfileData) => setForm((f) => ({ ...f, data: fn(JSON.parse(JSON.stringify(f.data))) }));

  const save = () =>
    start(async () => {
      const r = defaults
        ? await saveDefaultsAction(form.data, { spread })
        : await saveProjectAction(project!.id, { name: form.name, code: form.code, notes: form.notes, data: form.data });
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      const n = "updated" in r ? r.updated : 0;
      setMsg({ text: defaults && spread ? `Saved. Added to ${n} profile${n === 1 ? "" : "s"} where it was empty.` : "Saved." });
      router.refresh();
    });

  const fields = (group: FieldDef["group"]) => FIELD_DEFS.filter((f) => f.group === group && (!defaults || DEFAULT_KEYS.includes(f.key)));
  const notIn = missingLang(form.data, lang);
  const outdated = copies.filter((c) => c.outdated.length);

  return (
    <div className="space-y-5 pb-20">
      <div className="space-y-1">
        <Link href={`${BASE}/projects`} className="text-sm text-muted hover:text-fg">← Projects</Link>
        <h2 className="text-xl font-semibold tracking-tight">{defaults ? "My details" : form.name || "Project"}</h2>
        <p className="text-sm text-muted">
          {defaults
            ? "What repeats in every project: your organization, you as project manager or author. Every new project profile starts with these."
            : "Everything here fills your working copies of this project: write it once, every template gets it."}
        </p>
      </div>

      {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-subtle"}`}>{msg.text}</p>}

      {outdated.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning bg-warning-soft p-3 text-sm">
          <span>
            <b>{outdated.length} working cop{outdated.length === 1 ? "y is" : "ies are"} out of date</b> with this profile. Refreshing fills them again from the template as a new version.
          </span>
          <button
            type="button"
            className={BTN_PLAIN}
            disabled={pending || dirty}
            title={dirty ? "Save your changes first" : undefined}
            onClick={() =>
              start(async () => {
                const r = await refreshProjectCopiesAction(project!.id, outdated.map((c) => c.id));
                if (!r.ok) return setMsg({ text: r.error, bad: true });
                setMsg(r.failed.length ? { text: `Refreshed ${r.done}. Not refreshed: ${r.failed.join(" · ")}`, bad: true } : { text: `Refreshed ${r.done} cop${r.done === 1 ? "y" : "ies"}.` });
                router.refresh();
              })
            }
          >
            Refresh all
          </button>
        </div>
      )}

      <section className={`${BOX} space-y-4`}>
        {!defaults && (
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <label className={LABEL}>Project name (as you call it here)
              <input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className={LABEL}>Short code (optional)
              <input className={INPUT} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="WIFI-26" />
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Writing in</span>
          <div role="radiogroup" aria-label="Language" className="inline-flex rounded-md border border-line p-0.5">
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => pickLang(l)} className={`rounded px-2.5 py-1 text-xs font-medium ${lang === l ? "bg-accent text-accent-fg" : "text-muted hover:bg-subtle"}`}>
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">Names, emails, dates and amounts are shared. Text has one version per language; an empty one uses the other language.</span>
        </div>
        {notIn.length > 0 && (
          <p className="text-xs text-muted">Only in {lang === "en" ? "Spanish" : "English"} so far: {notIn.map((k) => labelOf(k, "en")).join(", ")}.</p>
        )}

        {!defaults && (
          <div role="tablist" aria-label="Profile sections" className="flex gap-1 border-b border-line">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t.key ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {(defaults || tab === "core") && (
          <div className="grid gap-3 sm:grid-cols-2">
            {fields("core").map((f) => (
              <ScalarField key={f.key} f={f} lang={lang} value={form.data.scalars[f.key]} data={form.data} onChange={(v) => setData((d) => { setBi(d.scalars, f.key, slotOf(f.key, lang), v); return d; })} />
            ))}
          </div>
        )}
        {!defaults && tab === "people" && (
          <div className="space-y-5">
            {fields("people").map((f) => <TableField key={f.key} f={f} lang={lang} data={form.data} onChange={(rows) => setData((d) => { d.tables[f.key] = rows; return d; })} />)}
          </div>
        )}
        {!defaults && tab === "plan" && (
          <div className="space-y-5">
            {fields("plan").map((f) =>
              f.kind === "table" ? (
                <TableField key={f.key} f={f} lang={lang} data={form.data} onChange={(rows) => setData((d) => { d.tables[f.key] = rows; return d; })} />
              ) : (
                <ListField key={f.key} f={f} lang={lang} data={form.data} onChange={(items) => setData((d) => { d.lists[f.key] = items; return d; })} />
              )
            )}
          </div>
        )}

        {!defaults && tab === "core" && (
          <label className={LABEL}>Notes (only for you, never filled into templates)
            <textarea className={`${INPUT} min-h-16`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        )}
      </section>

      {!defaults && (
        <section className={`${BOX} space-y-3`} aria-label="Working copies of this project">
          <h3 className="text-sm font-semibold">Working copies {copies.length > 0 && <span className="text-muted">· {copies.length}</span>}</h3>
          {copies.length === 0 ? (
            <p className="text-sm text-muted">None yet. Open a template in the <Link href={BASE} className="text-accent hover:underline">Library</Link> and make a working copy for this project: it comes out filled.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line text-sm">
              {copies.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`${BASE}/copies/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
                    <p className="text-xs text-muted">{c.template} · v{c.version} · {c.updated_at.slice(0, 10)}</p>
                    {c.outdated.length > 0 && (
                      <p className="text-xs text-warning">
                        Out of date: {c.outdated.map((k) => labelOf(k)).join(", ")}
                        {c.editedAfterFill ? " · you uploaded an edited version after the fill: refreshing starts again from the template (your version stays in the history)" : ""}
                      </p>
                    )}
                  </div>
                  {c.outdated.length > 0 && (
                    <button type="button" className={BTN_SMALL} disabled={pending || dirty} title={dirty ? "Save your changes first" : undefined} onClick={() => start(async () => {
                      const r = await refreshCopyAction(c.id);
                      setMsg(r.ok ? { text: `“${c.title}” refreshed as version ${r.version}.` } : { text: r.error, bad: true });
                      if (r.ok) router.refresh();
                    })}>Refresh</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!defaults && (
        <section className="flex flex-wrap items-center gap-2 text-sm">
          {confirmDelete ? (
            <>
              <span>Delete this profile? Its working copies stay, but they will no longer refresh.</span>
              <button type="button" className={BTN_DANGER} disabled={pending} onClick={() => start(async () => {
                const r = await deleteProjectAction(project!.id);
                if (!r.ok) return setMsg({ text: r.error, bad: true });
                router.push(`${BASE}/projects`);
              })}>Delete profile</button>
              <button type="button" className={BTN_SMALL} onClick={() => setConfirmDelete(false)}>Keep it</button>
            </>
          ) : (
            <button type="button" className={`${BTN_SMALL} text-muted`} onClick={() => setConfirmDelete(true)}>Delete profile…</button>
          )}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3">
          {defaults && (
            <label className="mr-auto flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} />
              Also add them to existing profiles where they are empty
            </label>
          )}
          <span className="text-xs text-muted">{dirty ? "Unsaved changes" : "All saved"}</span>
          <button type="button" className={BTN_PRIMARY} disabled={pending || (!dirty && !(defaults && spread))} onClick={save}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function setBi(target: Record<string, Bi>, key: string, slot: Lang, value: string) {
  const next = { ...(target[key] ?? {}), [slot]: value };
  if (!next.en?.trim() && !next.es?.trim()) delete target[key];
  else target[key] = next;
}

// ------------------------------------------------------------------------------------------ AI draft box

function useDraft(data: ProfileData, field: string, lang: Lang) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = () =>
    start(async () => {
      setError(null);
      const r = await draftFieldAction({ data, field, lang });
      if (!r.ok) return setError(r.error);
      setDraft(r.draft);
    });
  return { pending, draft, error, ask, clear: () => setDraft(null) };
}

function DraftButton({ d }: { d: ReturnType<typeof useDraft> }) {
  return (
    <button type="button" className={BTN_SMALL} disabled={d.pending} onClick={d.ask} title="The AI suggests a draft from the rest of the profile. Nothing changes until you press Use.">
      {d.pending ? "Drafting…" : "✨ Draft with AI"}
    </button>
  );
}

function DraftBox({ d, onUse, children }: { d: ReturnType<typeof useDraft>; onUse: (mode: "replace" | "add") => void; children: React.ReactNode }) {
  if (d.error) return <p className="text-xs text-danger">{d.error}</p>;
  if (!d.draft) return null;
  return (
    <div className="space-y-2 rounded-md border border-accent bg-accent-soft p-2 text-sm">
      <p className="text-xs font-medium text-accent">AI draft: check it before using it</p>
      {children}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_SMALL} onClick={() => { onUse("replace"); d.clear(); }}>Use</button>
        {(d.draft.items || d.draft.rows) && <button type="button" className={BTN_SMALL} onClick={() => { onUse("add"); d.clear(); }}>Add to what's there</button>}
        <button type="button" className={`${BTN_SMALL} text-muted`} onClick={d.clear}>Discard</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ fields

function ScalarField({ f, lang, value, data, onChange }: { f: FieldDef; lang: Lang; value: Bi | undefined; data: ProfileData; onChange: (v: string) => void }) {
  const slot = slotOf(f.key, lang);
  const v = value?.[slot] ?? "";
  const fallback = isBilingual(f.key) ? value?.[other(lang)] ?? "" : "";
  const d = useDraft(data, f.key, lang);
  const common = { className: INPUT, value: v, placeholder: fallback || f.hint?.[lang] || "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value) };
  return (
    <div className={`${LABEL} ${f.kind === "long" ? "sm:col-span-2" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`pf-${f.key}`}>{f.label[lang]}{isBilingual(f.key) && <span className="ml-1 text-[10px] uppercase">{lang}</span>}</label>
        {f.draftable && <DraftButton d={d} />}
      </div>
      {f.kind === "long" ? (
        <textarea id={`pf-${f.key}`} rows={2} {...common} />
      ) : (
        <input id={`pf-${f.key}`} type={f.kind === "date" ? "date" : "text"} {...common} />
      )}
      <DraftBox d={d} onUse={() => d.draft?.text && onChange(d.draft.text)}>
        <p>{d.draft?.text}</p>
      </DraftBox>
    </div>
  );
}

function ListField({ f, lang, data, onChange }: { f: FieldDef; lang: Lang; data: ProfileData; onChange: (items: Bi[]) => void }) {
  const items = data.lists[f.key] ?? [];
  const slot = slotOf(f.key, lang);
  const text = items.map((x) => x[slot] ?? "").join("\n");
  const placeholder = items.map((x) => x[other(lang)] ?? "").join("\n");
  const [local, setLocal] = useState(text);
  useEffect(() => setLocal(text), [text, lang]);
  const d = useDraft(data, f.key, lang);
  const commit = (value: string) => {
    const lines = value.split("\n");
    const n = Math.max(lines.length, items.length);
    const next: Bi[] = [];
    for (let i = 0; i < n; i++) {
      const item = { ...(items[i] ?? {}), [slot]: (lines[i] ?? "").replace(/^\s*(?:[-*•])\s*/, "").trim() } as Bi;
      if (item.en || item.es) next.push(item);
    }
    onChange(next);
  };
  return (
    <div className={LABEL}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`pf-${f.key}`}>{f.label[lang]} <span className="text-[10px]">· one per line</span></label>
        {f.draftable && <DraftButton d={d} />}
      </div>
      <textarea id={`pf-${f.key}`} className={`${INPUT} min-h-20`} value={local} placeholder={placeholder} onChange={(e) => setLocal(e.target.value)} onBlur={() => commit(local)} />
      <DraftBox d={d} onUse={(mode) => {
        const add = (d.draft?.items ?? []).map((x) => ({ [slot]: x }) as Bi);
        onChange(mode === "add" ? [...items, ...add] : add);
      }}>
        <ul className="list-disc pl-5">{d.draft?.items?.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </DraftBox>
    </div>
  );
}

function TableField({ f, lang, data, onChange }: { f: FieldDef; lang: Lang; data: ProfileData; onChange: (rows: Record<string, Bi>[]) => void }) {
  const rows = data.tables[f.key] ?? [];
  const cols = f.columns ?? [];
  const d = useDraft(data, f.key, lang);
  const set = (i: number, col: string, value: string) => {
    const next = rows.map((r) => ({ ...r }));
    while (next.length <= i) next.push({});
    const slot = slotOf(f.key, lang, col);
    next[i][col] = { ...(next[i][col] ?? {}), [slot]: value };
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, k) => k !== i));
  const move = (i: number, by: number) => {
    const next = [...rows];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{f.label[lang]}</h4>
        {f.draftable && <DraftButton d={d} />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              {cols.map((c) => <th key={c.key} className="px-1 pb-1 font-normal">{c.label[lang]}{isBilingual(f.key, c.key) && <span className="ml-1 text-[10px] uppercase">{lang}</span>}</th>)}
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {[...rows, {} as Record<string, Bi>].map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const slot = slotOf(f.key, lang, c.key);
                  return (
                    <td key={c.key} className="px-1 py-0.5">
                      <input
                        aria-label={`${f.label.en} row ${i + 1} ${c.label.en}`}
                        className={INPUT}
                        type={c.kind === "date" ? "date" : "text"}
                        value={r[c.key]?.[slot] ?? ""}
                        placeholder={i === rows.length ? (cols[0].key === c.key ? "Add a row…" : "") : r[c.key]?.[other(lang)] ?? ""}
                        onChange={(e) => set(i, c.key, e.target.value)}
                      />
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-1 text-right">
                  {i < rows.length && (
                    <>
                      <button type="button" className="px-1 text-muted hover:text-fg" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="px-1 text-muted hover:text-fg" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                      <button type="button" className="px-1 text-muted hover:text-danger" aria-label="Remove row" onClick={() => remove(i)}>✕</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DraftBox d={d} onUse={(mode) => {
        const add = (d.draft?.rows ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v).map(([c, v]) => [c, { [slotOf(f.key, lang, c)]: v } as Bi])));
        onChange(mode === "add" ? [...rows, ...add] : add);
      }}>
        <table className="w-full text-xs">
          <tbody>{d.draft?.rows?.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className="pr-2 align-top">{r[c.key]}</td>)}</tr>)}</tbody>
        </table>
      </DraftBox>
    </div>
  );
}

