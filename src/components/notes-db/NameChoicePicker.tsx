"use client";
// "What should the old note be called?" — shown whenever a note stops being the note of a block / a portfolio page.
//  · Former  → "Former · <name> · <date>"
//  · Previous → the name it had before (so nothing looks like it happened)
// Controlled: the parent keeps `value`. With `inputName` it also writes a hidden field (for plain <form> actions).
import type { NameChoice } from "@/lib/note-name-memory";

export default function NameChoicePicker({
  value,
  onChange,
  formerPreview,
  previous,
  previousHint,
  inputName,
  heading = "The old note will be called…",
}: {
  value: NameChoice;
  onChange: (v: NameChoice) => void;
  /** e.g. "Former · Gym · today" */
  formerPreview: string;
  /** Its previous name, or null when it has none saved. */
  previous: string | null;
  previousHint?: string;
  inputName?: string;
  heading?: string;
}) {
  const canPrevious = !!previous;
  const eff: NameChoice = value === "previous" && !canPrevious ? "former" : value;
  return (
    <fieldset className="space-y-1.5 rounded-md border border-line p-2 text-xs">
      <legend className="px-1 text-muted">{heading}</legend>
      {inputName && <input type="hidden" name={inputName} value={eff} />}
      <label className="flex cursor-pointer items-start gap-2">
        <input type="radio" className="mt-0.5" checked={eff === "former"} onChange={() => onChange("former")} />
        <span className="min-w-0">
          <b>“{formerPreview}”</b>
          <span className="block text-muted">Marked as Former, so you can tell it was replaced.</span>
        </span>
      </label>
      <label className={`flex items-start gap-2 ${canPrevious ? "cursor-pointer" : "opacity-60"}`}>
        <input type="radio" className="mt-0.5" disabled={!canPrevious} checked={eff === "previous"} onChange={() => onChange("previous")} />
        <span className="min-w-0">
          <b>{canPrevious ? `“${previous}”` : "Its previous name"}</b>
          <span className="block text-muted">{canPrevious ? (previousHint ?? "The name it had before; as if nothing had happened.") : "It has no earlier name saved (it was created as this note)."}</span>
        </span>
      </label>
    </fieldset>
  );
}

/** "Former · <name> · [lang ·] today" for the preview line. */
export const formerPreviewOf = (name: string, lang?: string) => `Former · ${name.replace(/\s+/g, " ").trim() || "Untitled"} · ${lang ? `${lang} · ` : ""}today`;
