"use client";
// OWNED BY: templates. On an empty note: "Start with a template" list (applies it to this note).
import { useState } from "react";
import { applyTemplateToNote } from "@/app/template-actions";
import type { TemplateInfo } from "@/lib/notes-db/types";
import { TplIcon, errText, settleEditor, tplTitle } from "./tpl-ui";
import "./templates.css";

const FIRST = 6;

export default function EmptyNoteTemplates({ noteId, templates }: { noteId: string; templates: TemplateInfo[] }) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (hidden || !templates.length) return null;

  // The default one first
  const list = [...templates].sort((a, b) => Number(!!b.config.isDefault) - Number(!!a.config.isDefault));
  const shown = all ? list : list.slice(0, FIRST);

  async function apply(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await settleEditor(); // a title being typed is saved first, so its save can't overwrite the template's text
      const r = await applyTemplateToNote(noteId, id);
      if (r.ok) {
        window.location.reload(); // the editor reloads with the template's text
        return;
      }
      setError(errText(r, "Couldn't apply the template."));
    } catch (e) {
      setError(errText(e, "Couldn't apply the template."));
    }
    setBusy(null);
  }

  return (
    <div className="tpl-empty" aria-label="Start with a template">
      <p className="tpl-empty-label">Start with a template, or just start typing</p>
      <div className="tpl-empty-list">
        {shown.map((t) => (
          <button key={t.id} type="button" className="tpl-empty-item" onClick={() => void apply(t.id)} disabled={!!busy}>
            <span className="tpl-empty-icon" aria-hidden>
              <TplIcon icon={t.icon} />
            </span>
            <span>{busy === t.id ? `Applying “${tplTitle(t)}”…` : tplTitle(t)}</span>
          </button>
        ))}
        {!all && list.length > FIRST && (
          <button type="button" className="tpl-empty-item" onClick={() => setAll(true)}>
            <span className="tpl-empty-icon" aria-hidden>
              ⋯
            </span>
            <span>{list.length - FIRST} more</span>
          </button>
        )}
        <button type="button" className="tpl-empty-item" onClick={() => setHidden(true)} disabled={!!busy}>
          <span className="tpl-empty-icon" aria-hidden>
            📄
          </span>
          <span>Empty page</span>
        </button>
      </div>
      {error && (
        <p className="tpl-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
