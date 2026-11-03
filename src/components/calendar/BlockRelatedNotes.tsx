"use client";
// "📎 Related notes" of a block: the normal notes linked to it (note → "Events & blocks" property, or "Link to…" on the
// note page). The block's own shared note is shown separately, above. Used in the block window and the Focus panel.
import Link from "next/link";
import type { CalendarData } from "@/lib/calendar/types";

export default function BlockRelatedNotes({ data, blockTypeId, variant }: { data: CalendarData; blockTypeId: string; variant: "card" | "plain" }) {
  const list = data.blockLinks?.[blockTypeId] ?? [];
  if (!list.length) return null;
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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">📎 Related notes</h3>
        {items}
      </div>
    );
  }
  return (
    <section className="space-y-1 rounded-lg border border-line p-3">
      <h3 className="flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>📎 Related notes · {list.length}</span>
        <span className="text-xs font-normal text-faint">linked to this block from the note</span>
      </h3>
      {items}
    </section>
  );
}
