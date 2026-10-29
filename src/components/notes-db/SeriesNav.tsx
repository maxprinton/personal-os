"use client";
// OWNED BY: templates. "← previous · next →" between notes made from the same template.
import Link from "next/link";
import type { DbData, DbNote } from "@/lib/notes-db/types";
import { tplTitle } from "./tpl-ui";
import "./templates.css";

/** Order of a series: when each note was made (the scheduled ones are made in date order). */
function seriesOf(notes: DbNote[], templateId: string) {
  return notes
    .filter((n) => n.templateId === templateId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const noteName = (n: DbNote) => n.title.trim() || "Untitled";

export default function SeriesNav({ noteId, data }: { noteId: string; data: DbData }) {
  const note = data.notes.find((n) => n.id === noteId);
  const tplId = note?.templateId;
  if (!note || !tplId) return null;
  const template = data.templates.find((t) => t.id === tplId) ?? null;
  const series = seriesOf(data.notes, tplId);
  if (!template && series.length <= 1) return null;
  const i = series.findIndex((n) => n.id === noteId);
  const prev = i > 0 ? series[i - 1] : null;
  const next = i >= 0 && i < series.length - 1 ? series[i + 1] : null;

  return (
    <nav className="tpl-series" aria-label="Notes from the same template">
      <div className="tpl-series-side">
        {prev && (
          <Link href={`/notes/${prev.id}`} title={`Previous: ${noteName(prev)}`} rel="prev">
            <span aria-hidden>←</span>
            <span>{noteName(prev)}</span>
          </Link>
        )}
      </div>
      {template ? (
        <Link href={`/notes/${template.id}`} className="tpl-series-tpl" title={`Made from the template “${tplTitle(template)}” — open it to edit`}>
          <span aria-hidden>📐</span>
          <span>{tplTitle(template)}</span>
          {series.length > 1 && i >= 0 && (
            <small>
              {i + 1}/{series.length}
            </small>
          )}
        </Link>
      ) : (
        <span className="tpl-series-tpl is-gone" title="The template was deleted">
          {i + 1}/{series.length}
        </span>
      )}
      <div className="tpl-series-side is-next">
        {next && (
          <Link href={`/notes/${next.id}`} title={`Next: ${noteName(next)}`} rel="next">
            <span>{noteName(next)}</span>
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
