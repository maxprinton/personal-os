"use client";
// List view of the notes database: one line per note (checkbox, icon + title, "↳ parent" hint for
// sub-pages) and the visible properties as compact pills on the right (under the title on phones).
import { memo } from "react";
import { NoteCheckbox } from "@/components/NotesExport";
import { NoteTitle } from "@/components/notes-db/db-title";
import { CardProps, displayTitle, parentTitle, useChunk, useDb, useOpenNote } from "@/components/notes-db/db-shared";
import type { DbNote, NoteProperty } from "@/lib/notes-db/types";

type RowProps = { note: DbNote; cols: NoteProperty[]; properties: NoteProperty[]; parent: string | null; open: (e: React.MouseEvent, id: string) => void };

const ListRow = memo(function ListRow({ note, cols, properties, parent, open }: RowProps) {
  return (
    <div className="db-lrow" role="listitem" onClick={(e) => open(e, note.id)}>
      <NoteCheckbox id={note.id} title={displayTitle(note)} />
      <div className="db-lrow-main">
        <NoteTitle note={note} parent={parent} />
        <CardProps note={note} cols={cols} properties={properties} className="db-lrow-props" />
      </div>
    </div>
  );
});

export function ListView({ notes, cols, titles }: { notes: DbNote[]; cols: NoteProperty[]; titles: Map<string, string> }) {
  const env = useDb();
  const open = useOpenNote();
  const { limit, sentinel } = useChunk(notes.length);
  const rows = notes.length > limit ? notes.slice(0, limit) : notes;
  return (
    <div className="db-list" role="list" aria-label="Notes">
      {rows.map((n) => (
        <ListRow key={n.id} note={n} cols={cols} properties={env.properties} parent={parentTitle(n, titles)} open={open} />
      ))}
      {sentinel}
    </div>
  );
}
