"use client";
// One card per note found: icon, title, where it lives, and its best matching pieces with the words marked.
import Link from "next/link";
import type { SearchHit, SearchResult } from "@/lib/search/server";
import type { Snippet } from "@/lib/search/core";

const KIND: Record<string, string> = { title: "Title", heading: "Heading", text: "Text", table: "Table", props: "Properties", media: "Media" };

export function hitLabel(h: SearchHit): string {
  if (h.kind === "code") return `Code · ${h.label ?? "Plain text"}`;
  if (h.kind === "file" || h.kind === "media") return h.label ?? "File";
  return KIND[h.kind] ?? "Text";
}

export function Marked({ snippet }: { snippet: Snippet }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  snippet.marks.forEach(([a, b], i) => {
    if (a > at) out.push(snippet.text.slice(at, a));
    out.push(
      <mark key={i} className="search-mark">
        {snippet.text.slice(a, b)}
      </mark>,
    );
    at = b;
  });
  if (at < snippet.text.length) out.push(snippet.text.slice(at));
  return <>{out}</>;
}

export const resultHref = (r: SearchResult, query: string) => `/notes/${r.id}?find=${encodeURIComponent(query)}`;

const ago = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

export function ResultCard({ r, query, active, compact, onOpen }: { r: SearchResult; query: string; active?: boolean; compact?: boolean; onOpen?: () => void }) {
  const hits = compact ? r.hits.slice(0, 1) : r.hits;
  return (
    <Link
      href={resultHref(r, query)}
      onClick={onOpen}
      data-active={active ? "true" : undefined}
      className={`block rounded-lg border px-3 py-2.5 transition-colors ${active ? "border-accent bg-subtle" : "border-line hover:bg-subtle"}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="shrink-0 text-base leading-none">{r.icon ?? (r.blockName ? "✏️" : "📄")}</span>
        <span className="min-w-0 truncate font-medium text-fg">{r.title}</span>
        {r.trashed && <span className="shrink-0 rounded bg-subtle px-1.5 text-[11px] text-muted">Trash</span>}
        {r.template && <span className="shrink-0 rounded bg-subtle px-1.5 text-[11px] text-muted">Template</span>}
        <span className="ml-auto shrink-0 text-xs text-faint">{ago(r.updatedAt)}</span>
      </div>
      {r.parentTitle && <div className="mt-0.5 truncate text-xs text-muted">in {r.parentTitle}</div>}
      <div className="mt-1.5 space-y-1">
        {hits.map((h, i) => (
          <div key={i} className="text-sm leading-snug text-muted">
            <span className="mr-1.5 rounded bg-subtle px-1.5 py-px text-[11px] font-medium text-fg/80">{hitLabel(h)}</span>
            <span className={h.kind === "code" ? "font-mono text-[12.5px]" : ""}>
              <Marked snippet={h.snippet} />
            </span>
          </div>
        ))}
        {!compact && r.pieces > r.hits.length && <div className="text-xs text-faint">+{r.pieces - r.hits.length} more matches in this note</div>}
      </div>
    </Link>
  );
}
