"use client";
// Gallery view of the notes database: a responsive grid of cards. Each card shows the note's cover (or
// the first lines of its text), the checkbox, icon + title and the visible properties as pills.
import { memo } from "react";
import { coverStyle } from "@/lib/covers";
import { NoteCheckbox } from "@/components/NotesExport";
import { NoteTitle } from "@/components/notes-db/db-title";
import { CardProps, displayTitle, parentTitle, useChunk, useDb, useOpenNote } from "@/components/notes-db/db-shared";
import type { CardSize } from "@/components/notes-db/db-toolbar";
import type { DbNote, NoteProperty } from "@/lib/notes-db/types";

/** The first lines of the note (plain text) for a card without a cover. */
function previewOf(text: string) {
  const t = (text ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > 420 ? `${t.slice(0, 420)}…` : t;
}

type CardP = { note: DbNote; cols: NoteProperty[]; properties: NoteProperty[]; parent: string | null; open: (e: React.MouseEvent, id: string) => void };

const GalleryCard = memo(function GalleryCard({ note, cols, properties, parent, open }: CardP) {
  const preview = note.cover ? "" : previewOf(note.text);
  return (
    <div className="db-gcard" role="listitem" onClick={(e) => open(e, note.id)}>
      <div className="db-gcard-top">
        {note.cover ? (
          <div className="db-gcard-cover" style={coverStyle(note.cover)} aria-hidden />
        ) : (
          <div className={`db-gcard-preview ${preview ? "" : "is-empty"}`} aria-hidden>
            {preview || "Empty note"}
          </div>
        )}
        <div className="db-gcard-check">
          <NoteCheckbox id={note.id} title={displayTitle(note)} />
        </div>
      </div>
      <div className="db-gcard-body">
        <NoteTitle note={note} parent={parent} />
        <CardProps note={note} cols={cols} properties={properties} />
      </div>
    </div>
  );
});

export function GalleryView({ notes, cols, titles, size }: { notes: DbNote[]; cols: NoteProperty[]; titles: Map<string, string>; size: CardSize }) {
  const env = useDb();
  const open = useOpenNote();
  const { limit, sentinel } = useChunk(notes.length, 60);
  const cards = notes.length > limit ? notes.slice(0, limit) : notes;
  return (
    <>
      <div className="db-gallery" data-size={size} role="list" aria-label="Notes">
        {cards.map((n) => (
          <GalleryCard key={n.id} note={n} cols={cols} properties={env.properties} parent={parentTitle(n, titles)} open={open} />
        ))}
      </div>
      {sentinel}
    </>
  );
}
