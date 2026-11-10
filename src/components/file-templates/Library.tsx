"use client";
// Template Manager add-on — the library: search, filters, table (grouped by phase) or cards, bulk edits.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { recordUseAction, trashAction, updateManyAction, updateTemplateAction } from "@/app/file-template-actions";
import { ABOUT_LABEL, BASE, FORMATS, FORMAT_LABEL, GROUPS, GROUP_LABEL, PHASES, PHASE_LABEL, STATUSES, STATUS_LABEL } from "@/lib/file-templates/constants";
import { EMPTY_FILTERS, aboutIn, displayName, fileUrl, filterTemplates, groupByPhase, sortTemplates } from "@/lib/file-templates/query";
import type { FileTemplate, Filters, Lang, SortKey, TemplateFile } from "@/lib/file-templates/types";
import { readPref, writePref } from "./client";
import { BTN_PLAIN, BTN_SMALL, FormatBadge, GroupBadge, INPUT, PhaseBadge, SELECT, StatusBadge } from "./ui";

const VIEWS = ["table", "cards"] as const;
const LANGS = ["en", "es"] as const;
const SORTS = ["phase", "name", "recent", "used"] as const;
const SORT_LABEL: Record<SortKey, string> = { phase: "By phase", name: "Name A-Z", recent: "Newest first", used: "Most used" };

export default function Library({ templates, mode = "library" }: { templates: FileTemplate[]; mode?: "library" | "inbox" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [view, setView] = useState<(typeof VIEWS)[number]>("table");
  const [lang, setLang] = useState<Lang>("en");
  const [sort, setSort] = useState<SortKey>("phase");
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setView(readPref("tm.view", VIEWS, "table"));
    setLang(readPref("tm.lang", LANGS, "en"));
    setSort(readPref("tm.sort", SORTS, "phase"));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => sortTemplates(filterTemplates(templates, f), sort, lang), [templates, f, sort, lang]);
  const groups = useMemo(() => (sort === "phase" ? groupByPhase(shown) : [{ phase: null, items: shown }]), [shown, sort]);
  const filtered = f.q || f.phase !== "all" || f.grp !== "all" || f.format !== "all" || f.status !== "all" || f.favorites;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const choose = (k: string, v: string, apply: (v: string) => void) => {
    writePref(k, v);
    apply(v);
  };

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = shown.length > 0 && shown.every((t) => sel.has(t.id));
  const toggleAll = () => setSel(allShown ? new Set() : new Set(shown.map((t) => t.id)));

  const run = (p: Promise<{ ok: boolean; error?: string; count?: number }>, done?: string) =>
    start(async () => {
      const r = await p;
      setMsg(r.ok ? (done ?? null) : (r.error ?? "Something went wrong."));
      if (r.ok) {
        setSel(new Set());
        router.refresh();
      }
    });
  const bulk = (patch: Record<string, unknown>, label: string) => run(updateManyAction([...sel], patch), `${label}: ${sel.size} template${sel.size === 1 ? "" : "s"}.`);
  const star = (t: FileTemplate) => start(async () => { await updateTemplateAction(t.id, { favorite: !t.favorite }); router.refresh(); });

  if (!templates.length) {
    return (
      <div className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
        {mode === "inbox" ? (
          <p>The inbox is empty. Files you upload in <Link href={`${BASE}/import`} className="text-accent hover:underline">Add templates</Link> land here until you classify them.</p>
        ) : (
          <p>
            No templates yet. Go to <Link href={`${BASE}/import`} className="text-accent hover:underline">Add templates</Link> and pick your <b>Template Library</b> folder (in PERSONAL OS) to load all 127 professional templates at once, or upload your own files.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mode === "inbox" && (
        <p className="rounded-lg border border-line bg-subtle p-3 text-sm text-muted">
          New uploads wait here. Open each one to give it a phase, an approach and a short &ldquo;best for&rdquo;, then mark it <b>Reviewed</b> or <b>Ready to use</b> to move it into the library view.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={search} value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search name, code, tags or what it is for… (press /)" className={`${INPUT} pl-8`} aria-label="Search templates" />
        </div>
        <select value={f.phase} onChange={(e) => set("phase", e.target.value as Filters["phase"])} className={SELECT} aria-label="Phase">
          <option value="all">All phases</option>
          {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p][lang]}</option>)}
        </select>
        <select value={f.grp} onChange={(e) => set("grp", e.target.value as Filters["grp"])} className={SELECT} aria-label="Approach">
          <option value="all">All approaches</option>
          {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g][lang]}</option>)}
        </select>
        <select value={f.format} onChange={(e) => set("format", e.target.value as Filters["format"])} className={SELECT} aria-label="Format">
          <option value="all">All formats</option>
          {FORMATS.map((x) => <option key={x} value={x}>{FORMAT_LABEL[x]}</option>)}
        </select>
        {mode === "library" && (
          <select value={f.status} onChange={(e) => set("status", e.target.value as Filters["status"])} className={SELECT} aria-label="Status">
            <option value="all">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        )}
        <button type="button" onClick={() => set("favorites", !f.favorites)} className={`${BTN_PLAIN} ${f.favorites ? "border-accent text-accent" : ""}`} aria-pressed={f.favorites}>
          <Icon name="star" size={15} /> Favorites
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          {shown.length === templates.length ? `${templates.length} templates` : `${shown.length} of ${templates.length} templates`}
          {filtered && (
            <button type="button" onClick={() => setF(EMPTY_FILTERS)} className="ml-2 text-accent hover:underline">Clear filters</button>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={sort} onChange={(e) => choose("tm.sort", e.target.value, (v) => setSort(v as SortKey))} className={SELECT} aria-label="Sort">
            {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
          <Segmented value={lang} options={[["en", "EN"], ["es", "ES"]]} onChange={(v) => choose("tm.lang", v, (x) => setLang(x as Lang))} label="Language" />
          <Segmented value={view} options={[["table", "Table"], ["cards", "Cards"]]} onChange={(v) => choose("tm.view", v, (x) => setView(x as (typeof VIEWS)[number]))} label="View" />
        </div>
      </div>

      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft p-2 text-sm">
          <span className="font-medium text-accent">{sel.size} selected</span>
          <button className={BTN_SMALL} disabled={pending} onClick={() => bulk({ status: "ready" }, "Marked ready")}>Mark ready</button>
          <button className={BTN_SMALL} disabled={pending} onClick={() => bulk({ status: "reviewed" }, "Marked reviewed")}>Mark reviewed</button>
          <button className={BTN_SMALL} disabled={pending} onClick={() => bulk({ favorite: true }, "Added to favorites")}>★ Favorite</button>
          <select className={`${SELECT} py-1 text-xs`} defaultValue="" onChange={(e) => { if (e.target.value) bulk({ phase: e.target.value === "none" ? null : e.target.value }, "Phase set"); e.target.value = ""; }} aria-label="Set phase">
            <option value="">Set phase…</option>
            {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p].en}</option>)}
            <option value="none">No phase</option>
          </select>
          <select className={`${SELECT} py-1 text-xs`} defaultValue="" onChange={(e) => { if (e.target.value) bulk({ grp: e.target.value }, "Approach set"); e.target.value = ""; }} aria-label="Set approach">
            <option value="">Set approach…</option>
            {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g].en}</option>)}
          </select>
          <button className={`${BTN_SMALL} border-danger text-danger`} disabled={pending} onClick={() => run(trashAction([...sel]), `Moved to trash: ${sel.size}. Restore them from Trash within 30 days.`)}>Move to trash</button>
          <button className="ml-auto text-xs text-muted hover:text-fg" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}
      {msg && <p className="rounded-md border border-line bg-subtle px-3 py-2 text-sm" role="status">{msg}</p>}

      {!shown.length ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">Nothing matches. Try fewer words or clear the filters.</p>
      ) : view === "table" ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-subtle text-left text-xs text-muted">
              <tr>
                <th className="w-8 p-2"><input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Select all shown" /></th>
                <th className="w-8 p-2" aria-label="Favorite" />
                <th className="p-2">Template</th>
                <th className="p-2">Approach</th>
                <th className="p-2">Format</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Used</th>
                <th className="p-2">Files</th>
              </tr>
            </thead>
            {groups.map((g, gi) => (
              <tbody key={`${g.phase}-${gi}`} className="divide-y divide-line">
                {sort === "phase" && (
                  <tr className="bg-subtle/60">
                    <td colSpan={8} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                      {g.phase ? PHASE_LABEL[g.phase][lang] : lang === "es" ? "Sin fase" : "No phase"} · {g.items.length}
                    </td>
                  </tr>
                )}
                {g.items.map((t) => (
                  <tr key={t.id} className={`align-top hover:bg-subtle/50 ${sel.has(t.id) ? "bg-accent-soft/50" : ""}`}>
                    <td className="p-2"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.name}`} /></td>
                    <td className="p-2">
                      <button type="button" onClick={() => star(t)} className={t.favorite ? "text-amber-500" : "text-muted hover:text-fg"} aria-label={t.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={t.favorite}>
                        <Icon name="star" size={16} />
                      </button>
                    </td>
                    <td className="p-2">
                      <Link href={`${BASE}/${t.id}`} className="font-medium hover:underline">
                        {t.code && <span className="mr-1.5 font-mono text-xs text-muted">{t.code}</span>}
                        {displayName(t, lang)}
                      </Link>
                      {aboutIn(t, lang).best && <p className="mt-0.5 line-clamp-2 max-w-xl text-xs text-muted">{aboutIn(t, lang).best}</p>}
                      {sort !== "phase" && <div className="mt-1"><PhaseBadge phase={t.phase} lang={lang} /></div>}
                    </td>
                    <td className="p-2"><GroupBadge grp={t.grp} lang={lang} /></td>
                    <td className="p-2"><FormatBadge format={t.format} /></td>
                    <td className="p-2"><StatusBadge status={t.status} /></td>
                    <td className="p-2 text-right tabular-nums text-muted">{t.times_used || ""}</td>
                    <td className="p-2"><FileLinks t={t} lang={lang} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g, gi) => (
            <section key={`${g.phase}-${gi}`} className="space-y-2">
              {sort === "phase" && <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{g.phase ? PHASE_LABEL[g.phase][lang] : "No phase"} · {g.items.length}</h2>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((t) => {
                  const a = aboutIn(t, lang);
                  return (
                    <article key={t.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-card">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`${BASE}/${t.id}`} className="font-medium leading-snug hover:underline">
                          {t.code && <span className="mr-1.5 font-mono text-xs text-muted">{t.code}</span>}
                          {displayName(t, lang)}
                        </Link>
                        <button type="button" onClick={() => star(t)} className={t.favorite ? "text-amber-500" : "text-muted hover:text-fg"} aria-label="Favorite" aria-pressed={t.favorite}>
                          <Icon name="star" size={16} />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1"><PhaseBadge phase={t.phase} lang={lang} /><GroupBadge grp={t.grp} lang={lang} /><FormatBadge format={t.format} /></div>
                      {a.best && <p className="text-sm"><span className="text-muted">{ABOUT_LABEL[lang].best}: </span>{a.best}</p>}
                      {a.use && <p className="line-clamp-3 text-xs text-muted"><b className="text-success">✓</b> {a.use}</p>}
                      {a.skip && <p className="line-clamp-2 text-xs text-muted"><b className="text-danger">✕</b> {a.skip}</p>}
                      <div className="mt-auto pt-1"><FileLinks t={t} lang={lang} /></div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Segmented({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-line-strong p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className={`rounded px-2 py-1 text-xs font-medium ${value === v ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Download links: the file in the chosen language first, then the other one. Counts a use. */
export function FileLinks({ t, lang }: { t: FileTemplate; lang: Lang }) {
  const files = (t.tm_files ?? []).filter((x) => x.role === "original");
  if (t.format === "link" && t.source_url) {
    return <a href={t.source_url} target="_blank" rel="noreferrer" onClick={() => void recordUseAction(t.id)} className={BTN_SMALL}>Open link ↗</a>;
  }
  if (!files.length) return <span className="text-xs text-muted">No file yet</span>;
  const order = (x: TemplateFile) => (x.lang === lang ? 0 : x.lang ? 1 : 2);
  const list = [...files].sort((a, b) => order(a) - order(b) || a.file_name.localeCompare(b.file_name));
  return (
    <div className="flex flex-wrap gap-1">
      {list.slice(0, 4).map((x) => (
        <a key={x.id} href={fileUrl(x.storage_path, true)} onClick={() => void recordUseAction(t.id)} className={BTN_SMALL} title={`Download ${x.file_name}`}>
          <Icon name="import" size={13} />
          {x.lang ? x.lang.toUpperCase() : ""} {extLabel(x.file_name)}
        </a>
      ))}
    </div>
  );
}

function extLabel(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "file";
}
