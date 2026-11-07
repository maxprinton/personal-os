"use client";
// One language of a slot: its note (open / replace / unlink / new) and its status.
import Link from "next/link";
import { useState } from "react";
import { linkNoteAction, newNoteAction, unlinkNoteAction } from "@/app/portfolio-actions";
import { LANG_LABEL, type Lang } from "@/lib/portfolio/constants";
import type { SlotView } from "@/lib/portfolio/types";
import { ActForm, BOX, BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, INPUT, LABEL, StatusBadge } from "./ui";

export type NoteChoice = { id: string; title: string };

export default function LangCard({ slot, lang, choices }: { slot: SlotView; lang: Lang; choices: NoteChoice[] }) {
  const page = slot.pages[lang];
  const note = page.note;
  const [picking, setPicking] = useState(false);
  return (
    <div className={`${BOX} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{LANG_LABEL[lang]}</h3>
        <StatusBadge status={page.status} />
      </div>

      {note ? (
        <p className="text-sm">
          <Link href={`/notes/${note.id}`} className="font-medium text-accent hover:underline">
            {note.icon ? `${note.icon} ` : ""}
            {note.title}
          </Link>
          {page.published && <span className="ml-2 text-xs text-muted">v{page.published.version}</span>}
        </p>
      ) : (
        <p className="text-sm text-muted">No note yet for this language.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {!note && (
          <ActForm action={newNoteAction} saved="">
            {(pending) => (
              <>
                <input type="hidden" name="slotId" value={slot.id} />
                <input type="hidden" name="lang" value={lang} />
                <button type="submit" disabled={pending} className={BTN_PRIMARY}>
                  Write a new note
                </button>
              </>
            )}
          </ActForm>
        )}
        <button type="button" onClick={() => setPicking((v) => !v)} className={BTN_PLAIN}>
          {note ? "Replace with another note" : "Link an existing note"}
        </button>
        {note && (
          <ActForm action={unlinkNoteAction} saved="" confirm="Unlink this note? It stays in Notes as a normal note, and the live page does not change.">
            {(pending) => (
              <>
                <input type="hidden" name="slotId" value={slot.id} />
                <input type="hidden" name="lang" value={lang} />
                <button type="submit" disabled={pending} className={BTN_DANGER}>
                  Unlink
                </button>
              </>
            )}
          </ActForm>
        )}
      </div>

      {picking && (
        <ActForm action={linkNoteAction} className="space-y-2 border-t border-line pt-3" saved="Linked ✓">
          {(pending) => (
            <>
              <input type="hidden" name="slotId" value={slot.id} />
              <input type="hidden" name="lang" value={lang} />
              <label className={LABEL}>
                Note
                <select name="noteId" required defaultValue="" className={INPUT}>
                  <option value="" disabled>
                    Choose a note (your latest {choices.length})…
                  </option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              {note && (
                <label className="flex items-start gap-2 text-xs text-muted">
                  <input type="checkbox" name="replace" className="mt-0.5" />
                  <span>Replace the current note. It becomes a normal note called “Former · … · {lang} · date”.</span>
                </label>
              )}
              <button type="submit" disabled={pending} className={BTN_PRIMARY}>
                Link note
              </button>
            </>
          )}
        </ActForm>
      )}
    </div>
  );
}
