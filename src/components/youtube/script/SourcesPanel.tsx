"use client";
// Research cards of a section as collapsible "📎 Source" blocks (yt_sections.card_ids). They live inside the
// section text but are never part of the script (words, prompter, export, captions skip them).
import { useState } from "react";
import { cardSource } from "@/lib/youtube/outline";
import type { ScriptCard } from "./ScriptWorkspace";
import { BTN_SM } from "./ui";

export default function SourcesPanel({
  cards,
  usedIds,
  busy,
  onToggle,
}: {
  cards: ScriptCard[];
  usedIds: string[];
  busy: boolean;
  onToggle: (card: ScriptCard, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const used = usedIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is ScriptCard => !!c);
  const free = cards.filter((c) => !usedIds.includes(c.id));
  const groups = [...new Set(free.map((c) => c.bucket))];
  const label = (c: ScriptCard) => cardSource(c, c.noteTitle).title;

  return (
    <details className="rounded-md border border-line bg-subtle/40 p-2.5" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium">
        📎 Sources <span className="text-xs font-normal text-muted">({used.length}) · research cards for this part — not part of the script</span>
      </summary>
      <div className="mt-2 space-y-3">
        {used.length > 0 && (
          <ul className="space-y-1">
            {used.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={label(c)}>
                  {label(c)} <span className="text-xs text-faint">· {c.bucket}</span>
                </span>
                <button type="button" className={BTN_SM} disabled={busy} onClick={() => onToggle(c, false)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {cards.length === 0 ? (
          <p className="text-xs text-muted">No research cards yet. Collect them in the Research tab, then add them here.</p>
        ) : free.length === 0 ? (
          <p className="text-xs text-muted">All research cards are in this part.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">Add a card: it goes in as a folded “📎 Source” block at the end. Rewrite it in your own words below it.</p>
            {groups.map((g) => (
              <div key={g}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{g}</p>
                <ul className="mt-1 space-y-1">
                  {free
                    .filter((c) => c.bucket === g)
                    .map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <span className="rounded bg-subtle px-1 text-[10px] uppercase text-muted">{c.kind}</span>
                        <span className="min-w-0 flex-1 truncate" title={label(c)}>
                          {label(c)}
                        </span>
                        <button type="button" className={BTN_SM} disabled={busy} onClick={() => onToggle(c, true)}>
                          + Add
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
