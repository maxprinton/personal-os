// Writing assistant settings (user_settings.writing, migration 0024). Pure: browser and server.

export type WritingArea = "notes" | "tasks" | "calendar" | "finance" | "titles";
export const WRITING_AREAS: { id: WritingArea; label: string }[] = [
  { id: "notes", label: "Notes" },
  { id: "titles", label: "Note titles & quick capture" },
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "finance", label: "Finance" },
];

export type WritingSettings = {
  spell?: boolean; // spelling + rules
  predict?: boolean; // next-word prediction
  ai?: boolean; // the AI checks on its own (grave problems, non-native English)
  es?: boolean;
  en?: boolean;
  areas?: Partial<Record<WritingArea, boolean>>;
  /** How you write, summarized by the AI from your notes (a few lines). */
  voice?: string | null;
  voiceAt?: string | null;
  /** The AI's own checks today (daily cap). */
  aiDay?: string | null;
  aiCount?: number;
  trainedAt?: string | null;
};

/** The AI checks on its own at most this many times a day (the user's choice, Oct 2026). */
export const AI_DAILY_CAP = 150;
/** …and at most this many a minute (Groq's free per-minute limit). */
export const AI_PER_MINUTE = 6;

export const areaOn = (s: WritingSettings, a: WritingArea) => s.areas?.[a] !== false;
export const spellOn = (s: WritingSettings, a: WritingArea) => s.spell !== false && areaOn(s, a);
export const predictOn = (s: WritingSettings, a: WritingArea) => s.predict !== false && areaOn(s, a);
export const aiOn = (s: WritingSettings, a: WritingArea) => s.ai !== false && spellOn(s, a);
export const langsOf = (s: WritingSettings) => ({ es: s.es !== false, en: s.en !== false });

/** Only these keys can be changed from the screen (the counters are the server's). */
export function cleanPatch(p: Record<string, unknown>): WritingSettings {
  const out: WritingSettings = {};
  for (const k of ["spell", "predict", "ai", "es", "en"] as const) if (typeof p[k] === "boolean") out[k] = p[k] as boolean;
  if (p.areas && typeof p.areas === "object") {
    const a: Partial<Record<WritingArea, boolean>> = {};
    for (const { id } of WRITING_AREAS) if (typeof (p.areas as Record<string, unknown>)[id] === "boolean") a[id] = (p.areas as Record<string, boolean>)[id];
    out.areas = a;
  }
  return out;
}

/** Monday of the week of a YYYY-MM-DD date. */
export function mondayOf(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}
