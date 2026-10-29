"use client";
// The title of a note in the views: icon + name (opens the note), "✏️ Block" badge, "↳ parent" hint for
// sub-pages, and a small inline rename (✎) in the table.
import { useState } from "react";
import Link from "next/link";
import { setNoteValue } from "@/app/notes-db-actions";
import { errorText, toast } from "@/components/notes-db/prop-ui";
import { NoteIcon, displayTitle } from "@/components/notes-db/db-shared";
import type { DbNote } from "@/lib/notes-db/types";

export function NoteTitle({ note, parent, onNote, rename = false, className = "" }: { note: DbNote; parent?: string | null; onNote?: (n: DbNote) => void; rename?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const canRename = rename && !!onNote && note.kind !== "block";

  async function save() {
    setEditing(false);
    const title = draft.trim();
    if (!onNote || !title || title === note.title) return;
    const before = note;
    onNote({ ...note, title });
    try {
      const r = await setNoteValue(note.id, "title", title);
      if (!r.ok) throw r;
    } catch (e) {
      onNote(before);
      toast(errorText(e, "Couldn't rename the note."));
    }
  }

  if (editing)
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="n-input db-rename-input"
        aria-label="Note title"
        maxLength={500}
      />
    );

  return (
    <span className={`db-title ${className}`}>
      <Link href={`/notes/${note.id}`} className="db-title-link" title={displayTitle(note)}>
        <span className="db-title-icon">
          <NoteIcon note={note} />
        </span>
        <span className={`db-title-text ${noteTitleEmpty(note) ? "is-empty" : ""}`}>{displayTitle(note)}</span>
      </Link>
      {note.kind === "block" && <span className="db-kind-badge">Block</span>}
      {parent && (
        <span className="db-parent" title={`Inside “${parent}”`}>
          ↳ {parent}
        </span>
      )}
      {canRename && (
        <button
          type="button"
          className="db-rename"
          title="Rename"
          aria-label="Rename"
          onClick={() => {
            setDraft(note.title);
            setEditing(true);
          }}
        >
          ✎
        </button>
      )}
    </span>
  );
}

const noteTitleEmpty = (n: DbNote) => !(n.blockName || n.title);
