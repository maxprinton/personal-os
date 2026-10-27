import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getLinkOptions, getLinksFrom } from "@/lib/links";
import { getTagsFor } from "@/lib/tags";
import { localNow, zonedToUtc } from "@/lib/time";
import { deleteNote } from "@/app/note-actions";
import { removeLink } from "@/app/task-actions";
import NoteEditor from "@/components/NoteEditor";
import LinkForm from "@/components/LinkForm";
import BlockNoteEditor from "@/components/BlockNoteEditor";
import NoteTagsForm from "@/components/NoteTagsForm";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { time_block: "Block (old)", block_type: "Block", event: "Event", task: "Task", note: "Note" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const read = (cols: string) => supabase.from("notes").select(cols).eq("id", id).is("deleted_at", null).maybeSingle();
  let { data, error } = await read("id,title,content,block_name");
  if (error) ({ data } = await read("id,title,content")); // migration 0017 not run yet
  const note = data as unknown as { id: string; title: string; content: string; block_name?: string | null } | null;
  if (!note) notFound();

  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const [tags, links, options] = await Promise.all([
    getTagsFor(supabase, "note", [id]),
    getLinksFrom(supabase, "note", id),
    getLinkOptions(supabase, zonedToUtc(today, "00:00", timezone).toISOString(), timezone),
  ]);

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        {note.block_name ? (
          <>
            <Link href="/notes?view=blocks" className="text-sm text-muted hover:text-fg">← Block notes</Link>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">✏️ Block note</p>
              <h1 className="text-2xl font-semibold">{note.block_name}</h1>
              <p className="text-sm text-muted">
                Shared by every “{note.block_name}” block. Its title follows the block&apos;s name; it saves by itself.
              </p>
            </div>
            <BlockNoteEditor name={note.block_name} content={note.content} minRows={14} />
            <NoteTagsForm id={note.id} tags={(tags.get(id) ?? []).map((t) => t.name).join(", ")} />
          </>
        ) : (
          <>
            <Link href="/notes" className="text-sm text-muted hover:text-fg">← All notes</Link>
            <NoteEditor id={note.id} title={note.title} content={note.content} />
            <NoteTagsForm id={note.id} tags={(tags.get(id) ?? []).map((t) => t.name).join(", ")} />
          </>
        )}

        <section className="space-y-2 rounded-lg border border-line p-4 bg-surface shadow-card">
          <h2 className="text-sm font-medium">Linked to</h2>
          <p className="text-xs text-muted">
            Linked notes show up on the Today screen 5 minutes before an event starts, and during a block.
          </p>
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.relationId} className="flex items-center justify-between text-sm">
                <span>{KIND[l.targetType]} · {l.title}</span>
                <form action={removeLink}>
                  <input type="hidden" name="relation_id" value={l.relationId} />
                  <input type="hidden" name="back" value={`/notes/${id}`} />
                  <button className="text-xs text-muted hover:text-danger">Remove</button>
                </form>
              </li>
            ))}
            {links.length === 0 && <li className="text-sm text-faint">Not linked yet.</li>}
          </ul>
          <LinkForm sourceType="note" sourceId={id} options={options} />
        </section>
        <form action={deleteNote}>
          <input type="hidden" name="id" value={id} />
          <button className="text-sm text-muted hover:text-danger">Delete note</button>
        </form>
      </main>
    </>
  );
}
