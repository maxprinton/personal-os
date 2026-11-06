"use client";
// /search: the full search, with filters (Text · Code · Files, trash, templates), more results and the
// state of the index ("Update index now").
import { useEffect, useRef, useState } from "react";
import { reindexNowAction, searchAction, searchStatusAction } from "@/app/search-actions";
import { ResultCard } from "@/components/search/SearchResults";
import type { SearchResponse, SearchResult } from "@/lib/search/server";

type Kind = "text" | "code" | "file";
const KINDS: { id: Kind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "code", label: "Code" },
  { id: "file", label: "Files" },
];
const PAGE = 20;
type Status = Awaited<ReturnType<typeof searchStatusAction>>;

export default function SearchPage({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [trash, setTrash] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [list, setList] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [indexing, setIndexing] = useState<string | null>(null);
  const seq = useRef(0);

  const opts = (offset: number) => ({ kinds: kind === "all" ? undefined : [kind], trash, templates, limit: PAGE, offset });

  useEffect(() => {
    void searchStatusAction().then(setStatus);
  }, []);

  useEffect(() => {
    const text = q.trim();
    const url = new URL(window.location.href);
    if (text) url.searchParams.set("q", text);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
    if (!text) {
      setRes(null);
      setList([]);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      void searchAction(text, opts(0))
        .then((r) => {
          if (n !== seq.current) return;
          setRes(r);
          setList(r.results);
        })
        .finally(() => n === seq.current && setBusy(false));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, trash, templates]);

  const more = async () => {
    setBusy(true);
    const r = await searchAction(q.trim(), opts(list.length));
    setList((l) => [...l, ...r.results.filter((x) => !l.some((y) => y.id === x.id))]);
    setBusy(false);
  };

  const reindex = async () => {
    setIndexing("Updating…");
    const r = await reindexNowAction();
    setIndexing(r.ok ? `Updated ${r.notes ?? 0} notes and read ${r.files ?? 0} files.` : r.error ?? "Couldn't update.");
    setStatus(await searchStatusAction());
  };

  const query = res?.corrected ?? q.trim();
  const waiting = (status?.files.pending ?? 0) + (status?.files.wait ?? 0);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-2xl font-semibold">Search</h1>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
        <span aria-hidden className="text-muted">⌕</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words, “exact phrase”, -not, OR…" aria-label="Search notes" className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint" />
        {busy && <span className="text-xs text-faint">…</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5" role="radiogroup" aria-label="Where">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${kind === k.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}>
              {k.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} /> Include trash
        </label>
        <label className="inline-flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={templates} onChange={(e) => setTemplates(e.target.checked)} /> Include templates
        </label>
        {res?.ok && q.trim() && <span className="ml-auto text-xs text-muted">{res.total} {res.total === 1 ? "note" : "notes"}</span>}
      </div>

      {res?.corrected && <p className="text-sm text-muted">No exact matches. Showing results for “{res.corrected}”.</p>}
      {res && !res.ok && <p className="text-sm text-danger">Search isn&apos;t ready: {res.error ?? "error"}</p>}
      {res?.ok && q.trim() && !list.length && !busy && <p className="text-sm text-muted">No notes contain all of these words{kind !== "all" ? " in that place" : ""}.</p>}
      {!q.trim() && (
        <div className="space-y-1 text-sm text-muted">
          <p>Searches every word of every note: titles, text, lists, toggles, callouts, tables, code, equations, links, properties, captions and the text inside attached PDF, Word, Excel, PowerPoint and text files.</p>
          <p>
            <b>reunion budget</b> both words · <b>reun</b> start of a word · <b>&quot;present perfect&quot;</b> exact phrase · <b>ielts OR toefl</b> either · <b>budget -2025</b> without. Accents and capitals don&apos;t matter. Ctrl+F opens search anywhere.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {list.map((r) => (
          <ResultCard key={r.id} r={r} query={query} />
        ))}
      </div>
      {res?.ok && list.length < res.total && (
        <button type="button" onClick={() => void more()} disabled={busy} className="w-full rounded-lg border border-line py-2 text-sm text-muted hover:bg-subtle hover:text-fg">
          Show more ({res.total - list.length} left)
        </button>
      )}

      <div className="border-t border-line pt-3 text-xs text-muted">
        {status ? (
          <span>
            Index: {status.indexed} of {status.notes} notes · files read {status.files.done ?? 0}
            {waiting ? ` · ${waiting} waiting` : ""}
            {status.files.no_text ? ` · ${status.files.no_text} without text` : ""}
            {status.files.failed ? ` · ${status.files.failed} failed` : ""}
            {status.files.wait ? " · PDFs wait for the PDF reader (INSTALAR-BUSCADOR.cmd)" : ""}
          </span>
        ) : (
          <span>Index status unavailable.</span>
        )}
        <button type="button" onClick={() => void reindex()} disabled={indexing === "Updating…"} className="ml-3 underline hover:text-fg">
          Update index now
        </button>
        {indexing && <span className="ml-2">{indexing}</span>}
      </div>
    </main>
  );
}
