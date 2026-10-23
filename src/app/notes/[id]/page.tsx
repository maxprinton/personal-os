import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getLinkOptions, getLinksFrom } from "@/lib/links";
import { getTagsFor } from "@/lib/tags";
import { localNow, zonedToUtc } from "@/lib/time";
import { deleteNote } from "@/app/note-actions";
import { removeLink } from "@/app/task-actions";
import Nav from "@/components/Nav";
import NoteEditor from "@/components/NoteEditor";
import LinkForm from "@/components/LinkForm";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { time_block: "Block", event: "Event", task: "Task", note: "Note" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: note } = await supabase
    .from("notes")
    .select("id,title,content")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
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
      <Nav active="/notes" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <Link href="/notes" className="text-sm text-neutral-500 hover:text-neutral-900">← All notes</Link>
        <NoteEditor
          id={note.id}
          title={note.title}
          content={note.content}
          tags={(tags.get(id) ?? []).map((t) => t.name).join(", ")}
        />
        {note.content.trim() && (
          <section className="space-y-2 rounded-lg border border-neutral-200 p-4">
            <h2 className="text-sm font-medium text-neutral-500">Preview</h2>
            <div className="space-y-3 text-[15px] leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
          </section>
        )}

        <section className="space-y-2 rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium">Linked to</h2>
          <p className="text-xs text-neutral-500">
            Linked notes show up on the Today screen 5 minutes before an event starts, and during a block.
          </p>
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.relationId} className="flex items-center justify-between text-sm">
                <span>{KIND[l.targetType]} · {l.title}</span>
                <form action={removeLink}>
                  <input type="hidden" name="relation_id" value={l.relationId} />
                  <input type="hidden" name="back" value={`/notes/${id}`} />
                  <button className="text-xs text-neutral-500 hover:text-red-600">Remove</button>
                </form>
              </li>
            ))}
            {links.length === 0 && <li className="text-sm text-neutral-400">Not linked yet.</li>}
          </ul>
          <LinkForm sourceType="note" sourceId={id} options={options} />
        </section>
        <form action={deleteNote}>
          <input type="hidden" name="id" value={id} />
          <button className="text-sm text-neutral-500 hover:text-red-600">Delete note</button>
        </form>
      </main>
    </>
  );
}
