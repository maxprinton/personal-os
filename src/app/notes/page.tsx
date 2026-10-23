import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getTagsFor, idsWithTag } from "@/lib/tags";
import { formatDateLong, utcToLocal } from "@/lib/time";
import { createNote } from "@/app/note-actions";
import Nav from "@/components/Nav";
import TagChips from "@/components/TagChips";

export const dynamic = "force-dynamic";

type NoteRow = { id: string; title: string; content: string; updated_at: string };

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const { tag, q } = await searchParams;
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);

  let query = supabase
    .from("notes")
    .select("id,title,content,updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  const search = (q ?? "").replace(/[%_,()]/g, " ").trim();
  if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
  if (tag) query = query.in("id", await idsWithTag(supabase, "note", tag));
  const { data } = await query;
  const notes = (data ?? []) as NoteRow[];
  const tags = await getTagsFor(supabase, "note", notes.map((n) => n.id));

  return (
    <>
      <Nav active="/notes" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Notes</h1>
            {tag && (
              <p className="text-sm text-neutral-500">
                Filtered by <strong>#{tag}</strong> · <Link href="/notes" className="underline">clear</Link>
              </p>
            )}
          </div>
          <form action={createNote} className="flex gap-2">
            <input name="title" placeholder="New note title" className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white">New note</button>
          </form>
        </div>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search notes…"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button className="rounded-md border border-neutral-300 px-3 py-2 text-sm">Search</button>
        </form>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-neutral-200 p-3 hover:border-neutral-400">
              <Link href={`/notes/${n.id}`} className="block">
                <p className="font-medium">{n.title || "Untitled"}</p>
                <p className="line-clamp-2 text-sm text-neutral-500">{n.content.slice(0, 200) || "Empty note"}</p>
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                <span>Edited {formatDateLong(utcToLocal(n.updated_at, timezone).date)}</span>
                <TagChips tags={tags.get(n.id) ?? []} base="/notes" />
              </div>
            </li>
          ))}
          {notes.length === 0 && <p className="text-sm text-neutral-500">No notes yet.</p>}
        </ul>
      </main>
    </>
  );
}
