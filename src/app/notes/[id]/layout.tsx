import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type RailNote = { id: string; title: string; updated_at: string; block_name?: string | null };

/**
 * Notes in two panels (Blocks design): your recent notes on the left (desktop), the open note on the right.
 * Phones keep the single-note view.
 */
export default async function NoteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select("id,title,updated_at,block_name")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(80);
  const notes = (data ?? []) as RailNote[];
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="lg:flex">
      <aside aria-label="Your notes" className="hidden w-[300px] shrink-0 border-r border-line lg:block">
        <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto p-3">
          <div className="flex items-baseline justify-between px-2 pb-2 pt-1">
            <Link href="/notes" className="font-display text-xl font-bold tracking-tight">
              Notes
            </Link>
            <Link href="/notes" className="text-sm text-muted transition-colors hover:text-accent">
              All notes
            </Link>
          </div>
          <ul className="space-y-0.5">
            {notes.map((n) => {
              const active = n.id === id;
              return (
                <li key={n.id}>
                  <Link
                    href={`/notes/${n.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-xl px-3 py-2 transition-colors ${active ? "bg-accent-soft" : "hover:bg-subtle"}`}
                  >
                    <span className={`block truncate text-[0.9375rem] ${active ? "font-semibold" : "font-medium"}`}>{n.title || "Untitled"}</span>
                    <span className="block truncate text-sm text-muted">
                      {n.block_name ? `Block: ${n.block_name}, ` : ""}
                      {day(n.updated_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
