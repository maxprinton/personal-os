import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getLinkOptions, getLinksFrom } from "@/lib/links";
import { getTagsFor } from "@/lib/tags";
import { localNow, zonedToUtc } from "@/lib/time";
import { deleteNote, deletePage, type PageSettings } from "@/app/note-actions";
import type { PageRef } from "@/lib/editor/context";
import { removeLink } from "@/app/task-actions";
import NoteEditor from "@/components/NoteEditor";
import LinkForm from "@/components/LinkForm";
import BlockNoteEditor from "@/components/BlockNoteEditor";
import NoteTagsForm from "@/components/NoteTagsForm";
import { NoteExportMenu } from "@/components/NotesExport";
import { getNoteRow } from "@/lib/notes-db/server";
import NoteProperties from "@/components/notes-db/NoteProperties";
import TemplateBar from "@/components/notes-db/TemplateBar";
import SeriesNav from "@/components/notes-db/SeriesNav";
import EmptyNoteTemplates from "@/components/notes-db/EmptyNoteTemplates";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { time_block: "Block (old)", block_type: "Block", event: "Event", task: "Task", note: "Note" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const read = (cols: string) => supabase.from("notes").select(cols).eq("id", id).is("deleted_at", null).maybeSingle();
  let { data, error } = await read("id,title,content,updated_at,block_name,page,parent_id");
  if (error) ({ data, error } = await read("id,title,content,updated_at,block_name")); // migration 0020 not run yet
  if (error) ({ data } = await read("id,title,content,updated_at")); // migration 0017 not run yet
  const note = data as unknown as {
    id: string;
    title: string;
    content: string;
    updated_at: string;
    block_name?: string | null;
    page?: PageSettings | null;
    parent_id?: string | null;
  } | null;
  if (!note) notFound();

  // Every note (for @ mentions, page links, breadcrumbs) and the notes that link here (backlinks)
  const [allRes, backRes] = await Promise.all([
    supabase.from("notes").select("id,title,page,parent_id").is("deleted_at", null).is("block_name", null).order("updated_at", { ascending: false }).limit(1000),
    supabase.from("notes").select("id,title,page,parent_id").is("deleted_at", null).neq("id", id).ilike("content", `%/notes/${id}%`).limit(50),
  ]);
  const toRef = (r: { id: string; title: string; page?: PageSettings | null; parent_id?: string | null }): PageRef => ({
    id: r.id,
    title: r.title,
    icon: r.page?.icon ?? null,
    parentId: r.parent_id ?? null,
  });
  type Row = { id: string; title: string; page?: PageSettings | null; parent_id?: string | null };
  let pages: PageRef[] = ((allRes.data ?? []) as Row[]).map(toRef);
  if (allRes.error) {
    const { data: plain } = await supabase.from("notes").select("id,title").is("deleted_at", null).order("updated_at", { ascending: false }).limit(1000);
    pages = ((plain ?? []) as Row[]).map(toRef);
  }
  const backlinks = ((backRes.data ?? []) as Row[]).map(toRef);

  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const [tags, links, options] = await Promise.all([
    getTagsFor(supabase, "note", [id]),
    getLinksFrom(supabase, "note", id),
    getLinkOptions(supabase, zonedToUtc(today, "00:00", timezone).toISOString(), timezone),
  ]);
  const tagNames = (tags.get(id) ?? []).map((t) => t.name);
  // The notes database (migration 0021): properties under the title, templates, series
  let db: Awaited<ReturnType<typeof getNoteRow>> | null = null;
  let dbError: string | null = null;
  try {
    db = await getNoteRow(supabase, id);
  } catch (e) {
    dbError = e instanceof Error ? e.message : "The notes database couldn't load.";
  }
  const dbNote = db?.note ?? null;
  const isTemplate = !!db?.template;
  const exportMenu = (
    <NoteExportMenu
      liveKey={note.block_name ? `block:${note.block_name}` : note.id}
      note={{
        id: note.id,
        title: note.block_name || note.title,
        content: note.content,
        updatedAt: note.updated_at,
        tags: tagNames,
        kind: note.block_name ? "block" : "note",
      }}
    />
  );

  return (
    <>
      <main className={note.block_name ? "mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8" : "w-full px-4 py-6 sm:px-6 lg:py-8"}>
        {note.block_name ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href="/notes?view=blocks" className="text-sm text-muted hover:text-fg">← Block notes</Link>
              {exportMenu}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">✏️ Block note</p>
              <h1 className="text-2xl font-semibold">{note.block_name}</h1>
              <p className="text-sm text-muted">
                Shared by every “{note.block_name}” block. Its title follows the block&apos;s name; it saves by itself.
              </p>
            </div>
            {db && dbNote && <NoteProperties data={db} noteId={note.id} />}
            <BlockNoteEditor name={note.block_name} content={note.content} minRows={14} />
            {!dbNote && <NoteTagsForm id={note.id} tags={tagNames.join(", ")} />}
          </>
        ) : (
          <>
            <NoteEditor
              id={note.id}
              title={note.title}
              content={note.content}
              page={note.page ?? {}}
              parentId={note.parent_id ?? null}
              updatedAt={note.updated_at}
              pages={pages}
              backlinks={backlinks}
              actions={exportMenu}
              belowTitle={db && dbNote ? <NoteProperties data={db} noteId={note.id} /> : dbError ? <p className="mt-2 text-xs text-warning">{dbError}</p> : null}
              banner={db && db.template ? <TemplateBar template={db.template} data={db} /> : db && dbNote?.templateId ? <SeriesNav noteId={note.id} data={db} /> : null}
              whenEmpty={db && !isTemplate && !db.templateNotes?.some((n) => n.id === note.id) && db.templates.length ? <EmptyNoteTemplates noteId={note.id} templates={db.templates} /> : null}
            />
          </>
        )}

        <div className={note.block_name ? "space-y-6" : "mx-auto w-full max-w-[708px] space-y-6 pt-6"}>
        {!note.block_name && !dbNote && <NoteTagsForm id={note.id} tags={tagNames.join(", ")} />}
        {!dbNote && (
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
        )}
        <form action={note.block_name ? deleteNote : deletePage}>
          <input type="hidden" name="id" value={id} />
          <button className="text-sm text-muted hover:text-danger">Delete note</button>
        </form>
        </div>
      </main>
    </>
  );
}
