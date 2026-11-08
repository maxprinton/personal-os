import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NoteRail, { type RailNote } from "@/components/notes-db/NoteRail";

/**
 * Notes in two panels (Blocks design): your notes on the left (desktop), the open note on the right.
 * The left list can be searched, sorted and limited to favorites (NoteRail). Phones keep the single-note view.
 */
export default async function NoteLayout({ children }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const [{ data }, { data: favProp }] = await Promise.all([
    supabase
      .from("notes")
      .select("id,title,updated_at,created_at,block_name,props")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(300),
    // "Favorite" is a built-in checkbox property; each note stores its value under that property's id.
    supabase.from("note_properties").select("id").eq("builtin", true).eq("key", "favorite").is("deleted_at", null).limit(1),
  ]);
  const favId = (favProp as { id: string }[] | null)?.[0]?.id;
  const notes: RailNote[] = ((data ?? []) as (Omit<RailNote, "favorite"> & { props?: Record<string, unknown> | null })[]).map(({ props, ...n }) => ({
    ...n,
    favorite: !!favId && props?.[favId] === true,
  }));

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
          <NoteRail notes={notes} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
