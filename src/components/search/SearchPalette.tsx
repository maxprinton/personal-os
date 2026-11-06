"use client";
// Ctrl+F (⌘F) anywhere: a search box over the page that searches every word of every note (and its files).
// Ctrl+F again while it is open closes it and lets the browser's own find work. Esc closes. ↑ ↓ Enter open.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchAction } from "@/app/search-actions";
import { ResultCard, resultHref } from "@/components/search/SearchResults";
import type { SearchResponse } from "@/lib/search/server";

export const OPEN_SEARCH = "open-notes-search";

export default function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const openRef = useRef(false);
  openRef.current = open;
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        if (openRef.current) {
          setOpen(false); // second Ctrl+F: the browser's find
          return;
        }
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === "string") setQ(text);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.select(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (!text) {
      setRes(null);
      setBusy(false);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      void searchAction(text, { limit: 8 })
        .then((r) => {
          if (n !== seq.current) return;
          setRes(r);
          setIdx(0);
        })
        .finally(() => n === seq.current && setBusy(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  if (!open) return null;
  const results = res?.results ?? [];
  const query = res?.corrected ?? q.trim();
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 px-3 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-label="Search notes" className="w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <span aria-hidden className="text-muted">⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[idx];
                if (r) go(resultHref(r, query));
                else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
              }
            }}
            placeholder="Search every note… words, “exact phrase”, -not, OR"
            aria-label="Search notes"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint"
          />
          {busy && <span className="text-xs text-faint">…</span>}
          <kbd className="hidden rounded border border-line px-1.5 text-[11px] text-muted sm:inline">Esc</kbd>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
          {res?.corrected && <p className="text-sm text-muted">No exact matches. Showing results for “{res.corrected}”.</p>}
          {res && !res.ok && <p className="text-sm text-danger">Search isn&apos;t ready: {res.error ?? "error"}</p>}
          {res?.ok && q.trim() && !results.length && !busy && <p className="text-sm text-muted">No notes contain all of these words.</p>}
          {!q.trim() && <p className="text-sm text-muted">Type words to search titles, text, code, tables, properties and attached files. Ctrl+F again uses the browser&apos;s find.</p>}
          {results.map((r, i) => (
            <ResultCard key={r.id} r={r} query={query} active={i === idx} compact onOpen={() => setOpen(false)} />
          ))}
        </div>
        {q.trim() && (
          <button type="button" onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)} className="flex w-full items-center justify-between border-t border-line px-4 py-2.5 text-sm text-muted hover:bg-subtle hover:text-fg">
            <span>See all results{res?.total ? ` (${res.total})` : ""} + ✨ AI summary</span>
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </div>
  );
}
