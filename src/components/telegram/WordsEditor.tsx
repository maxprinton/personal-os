"use client";

import { useState, useTransition } from "react";
import { addWord, hideWord, removeWord, renameCommand, showWord, type WordsResult } from "@/app/telegram-actions";
import { bare, type VocabRow } from "@/lib/bot/vocab";

/** The words a feature answers to. Add your own, or rename it; originals of money and system features always stay. */
export default function WordsEditor({
  featureId, base, locked, vocab, onVocab,
}: { featureId: string; base: string[]; locked: boolean; vocab: VocabRow[]; onVocab: (rows: VocabRow[]) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const mine = vocab.filter((r) => r.feature_id === featureId);
  const added = mine.filter((r) => r.kind === "add");
  const hidden = new Set(mine.filter((r) => r.kind === "hide").map((r) => r.word));
  // "/hoy" and "hoy" are one word to the bot
  const shown = base.filter((w, i) => !w.startsWith("/") || !base.some((o, j) => j !== i && o === w.slice(1)));

  const run = (fn: () => Promise<WordsResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      onVocab(r.vocab);
      setError(r.ok ? null : (r.error ?? "Could not save."));
      if (r.ok) after?.();
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((w) => {
          const off = hidden.has(bare(w));
          return (
            <span key={w} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${off ? "border-line text-faint line-through" : "border-line bg-subtle"}`}>
              <code>{w}</code>
              {!locked && (
                <button type="button" disabled={busy} title={off ? "Turn this word back on" : "Turn this word off"} aria-label={off ? `Turn ${w} on` : `Turn ${w} off`} onClick={() => run(() => (off ? showWord(featureId, w) : hideWord(featureId, w)))} className="text-faint hover:text-fg">
                  {off ? "↺" : "✕"}
                </button>
              )}
            </span>
          );
        })}
        {added.map((r) => (
          <span key={r.word} className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-xs text-accent">
            <code>/{r.word.replace(/ /g, "_")}</code>
            <button type="button" disabled={busy} title="Remove your word" aria-label={`Remove ${r.word}`} onClick={() => run(() => removeWord(featureId, r.word))} className="hover:text-fg">✕</button>
          </span>
        ))}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) run(() => addWord(featureId, value), () => setValue(""));
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="your own word, e.g. misdias" maxLength={30} className="min-w-0 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 text-sm outline-none focus:border-accent" />
        <button type="submit" disabled={busy || !value.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">Add</button>
        {!locked && (
          <button type="button" disabled={busy || !value.trim()} onClick={() => run(() => renameCommand(featureId, value), () => setValue(""))} title="Add this word and turn the original words off" className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg disabled:opacity-50">
            Rename
          </button>
        )}
      </form>
      <p className="text-xs text-faint">
        {locked
          ? "This one touches money or the system, so its original words always stay on. You can still add your own."
          : "Add keeps the original words. Rename adds yours and turns the originals off (✕ on a chip turns just one off; ↺ brings it back)."}
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
