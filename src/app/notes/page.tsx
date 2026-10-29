import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getTagsFor, idsWithTag } from "@/lib/tags";
import { formatDateLong, utcToLocal } from "@/lib/time";
import { createNote } from "@/app/note-actions";
import TagChips from "@/components/TagChips";
import { currentUserId, getBlockTypes, getSlots } from "@/lib/calendar/model";
import { getBlockNotes, noteAsPlainText, noteKey } from "@/lib/block-notes";
import { localNow } from "@/lib/time";
import { openBlockNote } from "@/app/block-note-actions";
import { NoteCheckbox, NoteSelection, NotesExportBar } from "@/components/NotesExport";
import type { ExportNote } from "@/lib/note-export/model";
import { getNotesDatabase } from "@/lib/notes-db/server";
import Database from "@/components/notes-db/Database";
import type { DbData } from "@/lib/notes-db/types";

export const dynamic = "force-dynamic";

type NoteRow = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  block_name?: string | null;
  page?: { icon?: string | null } | null;
  parent_id?: string | null;
};

/** Sub-pages right under their page (like Notion's sidebar), each with its depth. */
function asTree(notes: NoteRow[]): { n: NoteRow; depth: number }[] {
  const ids = new Set(notes.map((n) => n.id));
  const kids = new Map<string, NoteRow[]>();
  for (const n of notes) if (n.parent_id && ids.has(n.parent_id)) kids.set(n.parent_id, [...(kids.get(n.parent_id) ?? []), n]);
  const out: { n: NoteRow; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (n: NoteRow, depth: number) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push({ n, depth });
    for (const k of kids.get(n.id) ?? []) walk(k, Math.min(depth + 1, 4));
  };
  for (const n of notes) if (!n.parent_id || !ids.has(n.parent_id)) walk(n, 0);
  return out;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string; view?: string }>;
}) {
  const { tag, q, view } = await searchParams;
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  if (view === "blocks") return <BlockNotes timezone={timezone} />;

  // The notes database (migration 0021). Without it, the old list below still works.
  let db: DbData | null = null;
  let dbError: string | null = null;
  try {
    db = await getNotesDatabase(supabase);
  } catch (e) {
    dbError = e instanceof Error ? e.message : "The notes database couldn't load.";
  }
  if (db) {
    return (
      <main className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-6 sm:px-6 lg:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        </div>
        <Tabs current="all" />
        <Database data={db} />
      </main>
    );
  }

  const search = (q ?? "").replace(/[%_,()]/g, " ").trim();
  const tagIds = tag ? await idsWithTag(supabase, "note", tag) : null;
  const build = (withBlocks: boolean, withPages = withBlocks) => {
    let query = supabase
      .from("notes")
      .select(withPages ? "id,title,content,updated_at,block_name,page,parent_id" : withBlocks ? "id,title,content,updated_at,block_name" : "id,title,content,updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
    // Block notes have their own tab (a search or a tag still finds them)
    else if (withBlocks && !tagIds) query = query.is("block_name", null);
    if (tagIds) query = query.in("id", tagIds);
    return query;
  };
  let { data, error } = await build(true);
  if (error) ({ data, error } = await build(true, false)); // migration 0020 not run yet
  if (error) ({ data } = await build(false)); // migration 0017 not run yet
  const notes = (data ?? []) as unknown as NoteRow[];
  const tags = await getTagsFor(supabase, "note", notes.map((n) => n.id));
  const exportable: ExportNote[] = notes.map((n) => ({
    id: n.id,
    title: n.block_name || n.title,
    content: n.content,
    updatedAt: n.updated_at,
    tags: (tags.get(n.id) ?? []).map((t) => t.name),
    kind: n.block_name ? "block" : "note",
  }));

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
            {tag && (
              <p className="text-sm text-muted">
                Filtered by <strong>#{tag}</strong> · <Link href="/notes" className="underline">clear</Link>
              </p>
            )}
          </div>
          <form action={createNote} className="flex gap-2">
            <input name="title" placeholder="New note title" className="rounded-md border border-line-strong px-3 py-2 text-sm" />
            <button className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg">New note</button>
          </form>
        </div>
        <Tabs current="all" />
        {dbError && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{dbError}</p>}
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search notes…"
            className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-2 text-sm">Search</button>
        </form>
        <NoteSelection notes={exportable}>
        <NotesExportBar />
        <ul className="space-y-2">
          {(search || tagIds ? notes.map((n) => ({ n, depth: 0 })) : asTree(notes)).map(({ n, depth }) => (
            <li key={n.id} style={depth ? { marginLeft: depth * 24 } : undefined} className={`flex items-start gap-3 rounded-lg border border-line p-3 hover:border-line-strong ${SELECTED}`}>
              <NoteCheckbox id={n.id} title={n.block_name || n.title} />
              <div className="min-w-0 flex-1">
              <Link href={`/notes/${n.id}`} className="block">
                <p className="font-medium">
                  {n.block_name && <span className="mr-1.5 rounded bg-subtle px-1.5 text-xs font-normal text-muted">✏️ Block</span>}
                  {!n.block_name && <span className="mr-1.5">{n.page?.icon && !/^(https?:|\/)/.test(n.page.icon) ? n.page.icon : "📄"}</span>}
                  {n.title || "Untitled"}
                </p>
                <p className="line-clamp-2 text-sm text-muted">{noteAsPlainText(n.content.slice(0, 600)).slice(0, 200) || "Empty note"}</p>
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
                <span>Edited {formatDateLong(utcToLocal(n.updated_at, timezone).date)}</span>
                <TagChips tags={tags.get(n.id) ?? []} base="/notes" />
              </div>
              </div>
            </li>
          ))}
          {notes.length === 0 && <p className="text-sm text-muted">No notes yet.</p>}
        </ul>
        </NoteSelection>
      </main>
    </>
  );
}

/** A selected note's card is tinted (its checkbox is inside). */
const SELECTED = "has-[input:checked]:border-accent/60 has-[input:checked]:bg-accent-soft/40";

function Tabs({ current }: { current: "all" | "blocks" }) {
  const cls = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle hover:text-fg"}`;
  return (
    <nav className="flex gap-1" aria-label="Notes views">
      <Link href="/notes" className={cls(current === "all")}>All notes</Link>
      <Link href="/notes?view=blocks" className={cls(current === "blocks")}>✏️ Block notes</Link>
    </nav>
  );
}

/**
 * Block notes (the central notes manager of LifeOS): one note per block name.
 * Active = the block still has a weekly time or an appearance from today on. Orphaned = no future
 * (or the block was deleted); it comes back by itself if a block with that name is created again.
 */
async function BlockNotes({ timezone }: { timezone: string }) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const today = localNow(timezone).date;
  const [types, slots, notes, futureRes] = await Promise.all([
    getBlockTypes(supabase, userId),
    getSlots(supabase, userId, today),
    getBlockNotes(supabase, userId),
    supabase
      .from("block_occurrences")
      .select("block_type_id")
      .eq("user_id", userId)
      .gte("date", today)
      .neq("status", "cancelled")
      .limit(5000),
  ]);
  const withFuture = new Set([
    ...slots.map((s) => s.block_type_id),
    ...((futureRes.data ?? []) as { block_type_id: string }[]).map((o) => o.block_type_id),
  ]);
  const active = types.filter((t) => withFuture.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
  const activeKeys = new Set(active.map((t) => noteKey(t.name)));
  const liveKeys = new Set(types.map((t) => noteKey(t.name)));
  const byKey = new Map(notes.map((n) => [noteKey(n.name), n]));
  const orphaned = notes.filter((n) => !activeKeys.has(noteKey(n.name))).sort((a, b) => a.name.localeCompare(b.name));
  const exportable: ExportNote[] = notes
    .filter((n) => n.content.trim())
    .map((n) => ({ id: n.id, title: n.name, content: n.content, updatedAt: n.updated_at, kind: "block" as const }));
  const canExport = new Set(exportable.map((n) => n.id));
  const preview = (md: string) => {
    const t = noteAsPlainText(md).replace(/\s+/g, " ");
    return t ? (t.length > 90 ? `${t.slice(0, 90)}…` : t) : "";
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="text-sm text-muted">
          Every block name has one note, shared by all its appearances. Write it from the block&apos;s window, the focus panel or here.
        </p>
      </div>
      <Tabs current="blocks" />
      <NoteSelection notes={exportable}>
      <NotesExportBar />

      <section className="space-y-2">
        <h2 className="section-title">Active ({active.length})</h2>
        {active.length === 0 && <p className="text-sm text-muted">No blocks with times from today on.</p>}
        <ul className="space-y-2">
          {active.map((t) => {
            const n = byKey.get(noteKey(t.name));
            const body = (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </p>
                <p className="line-clamp-2 text-sm text-muted">
                  {n && preview(n.content) ? preview(n.content) : <span className="italic text-faint">No note yet</span>}
                </p>
              </>
            );
            return (
              <li key={t.id} className={`flex items-start gap-3 rounded-lg border border-line p-3 hover:border-line-strong ${SELECTED}`}>
                {n && canExport.has(n.id) ? <NoteCheckbox id={n.id} title={t.name} /> : <span className="w-4 shrink-0" aria-hidden />}
                <div className="min-w-0 flex-1">
                {n ? (
                  <Link href={`/notes/${n.id}`} className="block">{body}</Link>
                ) : (
                  <form action={openBlockNote}>
                    <input type="hidden" name="name" value={t.name} />
                    <button className="block w-full text-left">{body}</button>
                  </form>
                )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="section-title">Orphaned ({orphaned.length})</h2>
        <p className="text-xs text-muted">
          Notes of blocks with no times from today on, or deleted. Create a block with the same name and its note is back.
        </p>
        {orphaned.length === 0 && <p className="text-sm text-muted">Your notes are clean.</p>}
        <ul className="space-y-2">
          {orphaned.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 rounded-lg border border-dashed border-line p-3 hover:border-line-strong ${SELECTED}`}>
              {canExport.has(n.id) ? <NoteCheckbox id={n.id} title={n.name} /> : <span className="w-4 shrink-0" aria-hidden />}
              <Link href={`/notes/${n.id}`} className="block min-w-0 flex-1">
                <p className="font-medium">
                  {n.name}
                  <span className="ml-2 text-xs font-normal text-faint">
                    {liveKeys.has(noteKey(n.name)) ? "no times from today on" : "block deleted"} · edited{" "}
                    {formatDateLong(utcToLocal(n.updated_at, timezone).date)}
                  </span>
                </p>
                <p className="line-clamp-2 text-sm text-muted">{preview(n.content) || <span className="italic text-faint">Empty</span>}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      </NoteSelection>
    </main>
  );
}
