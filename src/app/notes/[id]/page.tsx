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
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { time_block: "Block (old)", block_type: "Block", event: "Event", task: "Task", note: "Note" };

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
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <Link href="/notes" className="text-sm text-muted hover:text-fg">← All notes</Link>
        <NoteEditor
          id={note.id}
          title={note.title}
          content={note.content}
          tags={(tags.get(id) ?? []).map((t) => t.name).join(", ")}
        />
        {note.content.trim() && (
          <section className="space-y-2 rounded-lg border border-line p-4 bg-surface shadow-card">
            <h2 className="section-title">Preview</h2>
            <div className="space-y-3 text-[15px] leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
          </section>
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
