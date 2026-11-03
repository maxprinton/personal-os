"use client";
// "📎 Related notes" of a block: the normal notes related to it (linked to the block, or related to the block's own
// note). The block's own shared note is shown separately, above. Used in the block window and the Focus panel.
// The person picks how many to see (5 / 10 / 20) and the order (newest / oldest edited); default 5 newest, remembered.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CalendarData } from "@/lib/calendar/types";

const LIMITS = [5, 10, 20];
type Order = "newest" | "oldest";
const KEY = "block-related-notes";

function readPrefs(): { limit: number; order: Order } {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { limit?: number; order?: string };
    return { limit: LIMITS.includes(p.limit ?? 0) ? (p.limit as number) : 5, order: p.order === "oldest" ? "oldest" : "newest" };
  } catch {
    return { limit: 5, order: "newest" };
  }
}

export default function BlockRelatedNotes({ data, blockTypeId, variant }: { data: CalendarData; blockTypeId: string; variant: "card" | "plain" }) {
  const [limit, setLimit] = useState<number>(5);
  const [order, setOrder] = useState<Order>("newest");
  useEffect(() => {
    const p = readPrefs();
    setLimit(p.limit);
    setOrder(p.order);
  }, []);
  const save = (l: number, o: Order) => {
    setLimit(l);
    setOrder(o);
    try {
      localStorage.setItem(KEY, JSON.stringify({ limit: l, order: o }));
    } catch {
      /* private window: it just won't be remembered */
    }
  };

  const all = data.blockLinks?.[blockTypeId] ?? [];
  if (!all.length) return null;
  const sorted = [...all].sort((a, b) => (order === "newest" ? b.updated.localeCompare(a.updated) : a.updated.localeCompare(b.updated)) || a.title.localeCompare(b.title));
  const list = sorted.slice(0, limit);
  const sel = "rounded border border-line bg-surface px-1 py-0.5 text-xs text-fg";

  const controls = all.length > 1 && (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <label className="flex items-center gap-1">
        Show
        <select className={sel} value={limit} onChange={(e) => save(Number(e.target.value), order)} aria-label="How many related notes to show">
          {LIMITS.map((n) => (
            <option key={n} value={n} className="bg-surface text-fg">{n}</option>
          ))}
        </select>
      </label>
      <select className={sel} value={order} onChange={(e) => save(limit, e.target.value as Order)} aria-label="Order of related notes">
        <option value="newest" className="bg-surface text-fg">Newest edited</option>
        <option value="oldest" className="bg-surface text-fg">Oldest edited</option>
      </select>
      {all.length > list.length && <span className="text-faint">of {all.length}</span>}
    </div>
  );

  const items = (
    <ul className="space-y-0.5">
      {list.map((n) => (
        <li key={n.id}>
          <Link href={`/notes/${n.id}`} className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-subtle" title={n.title}>
            <span className="w-5 shrink-0 text-center">{n.icon || "📄"}</span>
            <span className="min-w-0 flex-1 truncate">{n.title}</span>
            {n.sub && <span className="shrink-0 text-xs text-faint">sub-page</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
  if (variant === "plain") {
    return (
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">📎 Related notes · {all.length}</h3>
        {controls}
        {items}
      </div>
    );
  }
  return (
    <section className="space-y-1.5 rounded-lg border border-line p-3">
      <h3 className="text-sm font-medium">📎 Related notes · {all.length}</h3>
      {controls}
      {items}
    </section>
  );
}
