// BL-104: two switches per note. AI correction is OFF until you turn it on in that note (saves tokens);
// spellcheck is ON until you turn it off. They sit on top of the global Settings → Writing choices:
// a switch can only turn things off further, never override a global "off".
import { aiOn, spellOn, type WritingArea, type WritingSettings } from "@/lib/writing/settings";

export type NoteToggles = { aiCorrect?: boolean | null; spellcheck?: boolean | null };

export const noteAiOn = (t: NoteToggles | null | undefined) => t?.aiCorrect === true;
export const noteSpellOn = (t: NoteToggles | null | undefined) => t?.spellcheck !== false;

/** Does the AI correction run for this note? (global setting AND the note's own switch) */
export const aiAllowed = (s: WritingSettings, area: WritingArea, t: NoteToggles | null | undefined) => noteAiOn(t) && noteSpellOn(t) && aiOn(s, area);
/** Does the spellcheck run for this note? */
export const spellAllowed = (s: WritingSettings, area: WritingArea, t: NoteToggles | null | undefined) => noteSpellOn(t) && spellOn(s, area);

export const AI_OFF_MESSAGE = "AI correction is off for this note. Turn it on in the ⋯ menu.";
