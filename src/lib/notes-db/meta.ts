// Every property of a note as plain text lines ("Type: Idea", "AI summary: …"), for Telegram and the AI
// that answers "@os" questions. Server only for noteMetaMap (it loads the whole notes database).
import type { SupabaseClient } from "@supabase/supabase-js";
import { getNotesDatabase } from "@/lib/notes-db/server";
import { displayText, rawValue } from "@/lib/notes-db/values";
import type { DbNote, NoteProperty } from "@/lib/notes-db/types";

/** "Name: value" for each property with a value, in the database's order (empty ones left out). */
export function noteMetaLines(note: DbNote, properties: NoteProperty[], tz = "UTC", parentTitle?: string | null): string[] {
  const out: string[] = [];
  if (parentTitle) out.push(`Inside page: ${parentTitle}`);
  for (const p of [...properties].sort((a, b) => a.position - b.position)) {
    let text = "";
    try {
      if (p.type === "checkbox") {
        if (rawValue(note, p, properties) !== true) continue;
        text = "yes";
      } else if (p.type === "word_count" || p.type === "open_todos" || p.type === "backlinks" || p.type === "rollup") {
        const v = rawValue(note, p, properties);
        if (v === 0 || v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
        text = displayText(note, p, properties, tz);
      } else {
        text = displayText(note, p, properties, tz);
      }
    } catch {
      continue;
    }
    text = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (p.type === "unique_id") text = text.replace(/\s/g, "");
    out.push(`${p.name}: ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`);
  }
  return out;
}

/** Every note's property lines (by note id). Empty when the notes database can't load (migration 0021). */
export async function noteMetaMap(sb: SupabaseClient, userId: string): Promise<Map<string, string[]>> {
  try {
    const db = await getNotesDatabase(sb, { userId });
    const titles = new Map(db.notes.map((n) => [n.id, n.title || "Untitled"]));
    return new Map(db.notes.map((n) => [n.id, noteMetaLines(n, db.properties, db.timezone, n.parentId ? titles.get(n.parentId) ?? null : null)]));
  } catch (e) {
    console.error("note metadata", e);
    return new Map();
  }
}
