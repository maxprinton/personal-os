"use client";
// ✨ AI summary on the Search page: runs by itself 1.5 s after the results settle. It reads every found
// note's properties and the parts where the words appear, and cites the notes as [n] (click = open the
// note at the match). "Sources" lists what it read from each note.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { summarizeSearchAction } from "@/app/search-actions";
import { splitCitations, type Source } from "@/lib/search/ai-evidence";
import type { SearchSummary } from "@/lib/search/ai";
import type { SearchOptions } from "@/lib/search/server";

const href = (s: Source, q: string) => `/notes/${s.id}?find=${encodeURIComponent(q)}`;

function Inline({ text, sources, q }: { text: string; sources: Source[]; q: string }) {
  const out: React.ReactNode[] = [];
  splitCitations(text, sources.length).forEach((p, i) => {
    if ("cite" in p) {
      out.push(
        <span key={i} className="whitespace-nowrap">
          {p.cite.map((n) => {
            const s = sources[n - 1];
            return (
              <Link key={n} href={href(s, q)} title={s.title} className="mx-px inline-block rounded bg-accent-soft px-1 align-baseline text-[11px] font-semibold text-accent no-underline hover:bg-accent hover:text-accent-fg">
                {n}
              </Link>
            );
          })}
        </span>,
      );
      return;
    }
    // **bold** and *italic*
    p.text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).forEach((t, j) => {
      if (!t) return;
      if (t.startsWith("**") && t.endsWith("**")) out.push(<strong key={`${i}-${j}`}>{t.slice(2, -2)}</strong>);
      else if (t.startsWith("*") && t.endsWith("*") && t.length > 2) out.push(<em key={`${i}-${j}`}>{t.slice(1, -1)}</em>);
      else out.push(t);
    });
  });
  return <>{out}</>;
}

function Answer({ text, sources, q }: { text: string; sources: Source[]; q: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`u${blocks.length}`} className="ml-5 list-disc space-y-1">
        {list.map((l, i) => (
          <li key={i}>
            <Inline text={l} sources={sources} q={q} />
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      list.push(li[1]);
      continue;
    }
    flush();
    blocks.push(
      <p key={`p${blocks.length}`}>
        <Inline text={line.replace(/^#+\s*/, "")} sources={sources} q={q} />
      </p>,
    );
  }
  flush();
  return <div className="space-y-2 text-sm leading-relaxed text-fg">{blocks}</div>;
}

export default function AiSummary({ query, opts, ready }: { query: string; opts: SearchOptions; ready: boolean }) {
  const [res, setRes] = useState<SearchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const seq = useRef(0);
  const key = JSON.stringify([query, opts.kinds ?? [], !!opts.trash, !!opts.templates]);

  const ran = useRef<string | null>(null);
  // A new search (words or filters): forget the old answer
  useEffect(() => {
    seq.current++;
    ran.current = null;
    setRes(null);
    setBusy(false);
    setShowSources(false);
  }, [key]);
  // Once its results are on screen: summarize it (only once per search; "Show more" doesn't re-run it)
  useEffect(() => {
    if (!ready || !query || ran.current === key) return;
    ran.current = key;
    const n = ++seq.current;
    setBusy(true);
    let fired = false;
    const t = window.setTimeout(() => {
      fired = true;
      void summarizeSearchAction(query, opts)
        .then((r) => n === seq.current && setRes(r))
        .catch(() => n === seq.current && setRes({ ok: false, error: "The AI summary failed." }))
        .finally(() => n === seq.current && setBusy(false));
    }, 1200);
    return () => {
      window.clearTimeout(t);
      if (!fired && n === seq.current) {
        ran.current = null; // stopped before it started: allow the next run
        setBusy(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  if (!query || (!busy && !res) || (res?.ok && !res.found)) return null;
  if (res?.ok && res.phrase && !res.matched)
    return <section className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">✨ No note has the whole phrase “{res.phrase}” together, so there is no AI summary. Put words in quotes or search fewer words.</section>;
  const sources = res?.sources ?? [];
  const q = res?.corrected ?? query;
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-fg">✨ AI summary</span>
        {res?.ok && res.phrase && res.matched ? (
          <span className="text-xs text-muted">
            only the {res.matched} {res.matched === 1 ? "note" : "notes"} with the whole phrase “{res.phrase}”{res.found && res.found > res.matched ? ` (of ${res.found} found)` : ""}
            {res.read !== res.matched ? ` · read ${res.read}` : ""} · properties + the parts with the phrase{res.cached ? " · saved answer" : ""}
          </span>
        ) : res?.ok && res.found ? (
          <span className="text-xs text-muted">
            read {res.read === res.found ? `all ${res.found}` : `${res.read} of ${res.found}`} {res.found === 1 ? "note" : "notes"} (properties + the parts with your words){res.cached ? " · saved answer" : ""}
          </span>
        ) : null}
      </div>
      {busy && !res && (
        <div className="space-y-2" aria-label="Reading the notes">
          <div className="h-3 w-11/12 animate-pulse rounded bg-subtle" />
          <div className="h-3 w-9/12 animate-pulse rounded bg-subtle" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-subtle" />
          <p className="text-xs text-muted">Reading the notes found…</p>
        </div>
      )}
      {res && !res.ok && <p className="text-sm text-muted">{res.error}</p>}
      {res?.ok && res.answer && (
        <>
          <Answer text={res.answer} sources={sources} q={q} />
          <button type="button" onClick={() => setShowSources((v) => !v)} className="mt-3 text-xs text-muted underline hover:text-fg">
            {showSources ? "Hide sources" : `Sources (${sources.length})`}
          </button>
          {showSources && (
            <ol className="mt-2 space-y-2 border-t border-line pt-2 text-xs">
              {sources.map((s) => (
                <li key={s.n} className="flex gap-2">
                  <span className="mt-px inline-block h-fit rounded bg-accent-soft px-1 font-semibold text-accent">{s.n}</span>
                  <div className="min-w-0">
                    <Link href={href(s, q)} className="font-medium text-fg hover:underline">
                      {s.title}
                    </Link>
                    {s.parentTitle && <span className="text-muted"> · in {s.parentTitle}</span>}
                    {s.props.length > 0 && <div className="truncate text-muted">{s.props.join(" · ")}</div>}
                    {s.passages.map((p, i) => (
                      <div key={i} className="text-muted">
                        <span className="font-medium text-fg/80">{p.label}:</span> {p.text}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
