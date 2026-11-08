"use client";
// The list of notes on the left of an open note: search, sort and a favorites filter.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export type RailNote = {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
  block_name?: string | null;
  favorite: boolean;
};

type SortKey = "edited" | "created" | "title";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "edited", label: "Last edited" },
  { key: "created", label: "Date created" },
  { key: "title", label: "Title A–Z" },
];
const STORE = "notes-rail-v1";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const name = (n: RailNote) => n.title.trim() || "Untitled";

export default function NoteRail({ notes }: { notes: RailNote[] }) {
  const params = useParams<{ id?: string }>();
  const activeId = params?.id;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("edited");
  const [favOnly, setFavOnly] = useState(false);

  // Remember sort + favorites filter on this device (the search text is not remembered).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (SORTS.some((o) => o.key === s.sort)) setSort(s.sort);
      if (typeof s.favOnly === "boolean") setFavOnly(s.favOnly);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ sort, favOnly }));
    } catch {}
  }, [sort, favOnly]);

  const favCount = useMemo(() => notes.filter((n) => n.favorite).length, [notes]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = notes.filter((n) => (!favOnly || n.favorite) && (!needle || name(n).toLowerCase().includes(needle) || (n.block_name ?? "").toLowerCase().includes(needle)));
    list = [...list].sort((a, b) => {
      if (sort === "title") return name(a).localeCompare(name(b), undefined, { sensitivity: "base", numeric: true });
      const k = sort === "created" ? "created_at" : "updated_at";
      return a[k] < b[k] ? 1 : a[k] > b[k] ? -1 : 0; // newest first
    });
    return list;
  }, [notes, q, sort, favOnly]);

  const filtering = q.trim() !== "" || favOnly;

  return (
    <>
      <div className="space-y-2 px-1 pb-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter notes…"
          aria-label="Filter notes by title"
          className="w-full rounded-xl border border-line bg-transparent px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort notes"
            className="min-w-0 flex-1 rounded-xl border border-line bg-transparent px-2 py-1 text-sm text-muted outline-none focus:border-accent"
          >
            {SORTS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            aria-pressed={favOnly}
            title={favCount ? "Show only favorites" : "No favorites yet — tick the Favorite property on a note"}
            className={`shrink-0 rounded-xl border px-2.5 py-1 text-sm transition-colors ${favOnly ? "border-accent bg-accent-soft font-semibold" : "border-line text-muted hover:bg-subtle"}`}
          >
            ★ Favorites{favCount ? ` ${favCount}` : ""}
          </button>
        </div>
        {filtering && (
          <p className="px-1 text-xs text-muted" aria-live="polite">
            {shown.length} of {notes.length} notes
          </p>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">
          {favOnly && !q.trim() ? "No favorite notes yet." : "No notes match."}
          {filtering && (
            <button type="button" onClick={() => { setQ(""); setFavOnly(false); }} className="ml-1 text-accent hover:underline">
              Clear
            </button>
          )}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((n) => {
            const active = n.id === activeId;
            return (
              <li key={n.id}>
                <Link
                  href={`/notes/${n.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-xl px-3 py-2 transition-colors ${active ? "bg-accent-soft" : "hover:bg-subtle"}`}
                >
                  <span className={`block truncate text-[0.9375rem] ${active ? "font-semibold" : "font-medium"}`}>
                    {n.favorite && <span aria-label="Favorite" className="mr-1 text-accent">★</span>}
                    {name(n)}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {n.block_name ? `Block: ${n.block_name}, ` : ""}
                    {sort === "created" ? `Created ${day(n.created_at)}` : day(n.updated_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
