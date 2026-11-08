// Notes remember the name they had before they became the note of a block / a portfolio page (notes.name_memory, migration 0046).
// When a note stops being that note, the user chooses:
//   · "former"   → it is renamed "Former · <name> · <date>" (portfolio: "Former · <title> · <lang> · <date>")
//   · "previous" → it gets its previous name back, as if nothing had happened
// "Restore" puts a note that was released back where it came from. Pure functions: no database here.
import { normalizeName } from "@/lib/calendar/edit";

export type NameScope = "block" | "portfolio";
export type NameChoice = "former" | "previous";
export type NameMemory = {
  /** The name before it became a block / portfolio note. null = it was born as a block note (no earlier name). */
  original: string | null;
  /** The "Former · …" title we gave it (so we only undo a rename we made ourselves). */
  former: string | null;
  scope: NameScope;
  block?: string;
  slotId?: string;
  lang?: string;
  /** yyyy-mm-dd it was released (or linked). */
  at: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Reads notes.name_memory defensively (it is user data: any shape can come back). */
export function parseMemory(v: unknown): NameMemory | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.scope !== "block" && o.scope !== "portfolio") return null;
  return {
    original: str(o.original),
    former: str(o.former),
    scope: o.scope,
    block: str(o.block) ?? undefined,
    slotId: str(o.slotId) ?? undefined,
    lang: str(o.lang) ?? undefined,
    at: str(o.at) ?? "",
  };
}

/** "Former · Gym · Nov 8" or, with a language, "Former · About · es · Nov 7". */
export function formerName(name: string, ymd: string, lang?: string) {
  const [, m, d] = ymd.split("-").map(Number);
  const date = `${MONTHS[(m || 1) - 1]} ${d || 1}`;
  return lang ? `Former · ${name} · ${lang} · ${date}` : `Former · ${normalizeName(name)} · ${date}`;
}

/** The note's own name: when its title is a "Former" title we made, the name it had before that. */
export function ownName(title: string, mem: NameMemory | null): string | null {
  return mem?.former && title === mem.former ? mem.original : title;
}

export type Release = { title: string; memory: NameMemory | null; usedChoice: NameChoice };

/**
 * The new title and memory of a note that stops being a block / portfolio note.
 * · portfolio: the note kept its own title while it was a page, so "previous" = leave it as it is.
 * · block: the note was renamed to the block's name when it was linked, so "previous" = the name saved then
 *   (a note born as a block note has none: it gets the Former title instead).
 */
export function releaseNaming(a: { title: string; mem: NameMemory | null; choice: NameChoice; scope: NameScope; ymd: string; block?: string; slotId?: string; lang?: string }): Release {
  const own = ownName(a.title, a.mem) ?? a.title;
  if (a.scope === "portfolio") {
    if (a.choice === "previous") return { title: own, memory: null, usedChoice: "previous" };
    const title = formerName(own || "Untitled", a.ymd, a.lang);
    return { title, memory: { original: own, former: title, scope: "portfolio", slotId: a.slotId, lang: a.lang, at: a.ymd }, usedChoice: "former" };
  }
  const before = a.mem?.original ?? null;
  if (a.choice === "previous" && before) return { title: before, memory: null, usedChoice: "previous" };
  const title = formerName(a.block ?? a.title, a.ymd);
  return { title, memory: { original: before, former: title, scope: "block", block: a.block, at: a.ymd }, usedChoice: "former" };
}

/** What a note remembers when it becomes the note of a block (its title is about to become the block's name). */
export function memoryOnBlockLink(note: { title: string; block_name: string | null }, mem: NameMemory | null, block: string, ymd: string): NameMemory | null {
  const name = normalizeName(block);
  // already a block note (moved to another block): keep the name it had before ever being a block note
  const original = note.block_name ? (mem?.original ?? null) : ownName(note.title, mem);
  if (!original || normalizeName(original).toLowerCase() === name.toLowerCase()) return null; // nothing to remember
  return { original, former: null, scope: "block", block: name, at: ymd };
}

/** Linking a note that still carries a Former title we made: the title it had before comes back (portfolio keeps titles). */
export function titleOnPortfolioLink(title: string, mem: NameMemory | null): string {
  return mem?.former && title === mem.former ? (mem.original ?? title) : title;
}

/** What to show for "its previous name" in a choice: block → saved name; portfolio → the title it has. */
export function previousName(scope: NameScope, title: string, mem: NameMemory | null): string | null {
  return scope === "portfolio" ? (ownName(title, mem) ?? title) : (mem?.original ?? null);
}
