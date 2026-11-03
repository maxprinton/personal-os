// Pure rules for editing tags (shared by the notes, tasks and events): rename / recolor / delete / merge a tag, and
// the same changes applied to the tag lists that are already on screen. No database here.
import { COLOR_NAMES, type ColorName } from "@/lib/editor/colors";

export type TagLite = { name: string; color: string | null };

/** What happened to a tag; also the payload of the "pos-tags-changed" browser event that updates the screen. */
export type TagChange =
  | { kind: "update"; name: string; to?: string; color?: ColorName }
  | { kind: "delete"; name: string }
  | { kind: "merge"; name: string; into: string };

export const TAGS_CHANGED = "pos-tags-changed";

/** Colors a new tag or option cycles through (no "default"): the same order Notion-style pickers use. */
export const TAG_PALETTE: ColorName[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

/** The color the n-th new tag gets when nobody picked one. */
export const nextColor = (count: number): ColorName => TAG_PALETTE[((count % TAG_PALETTE.length) + TAG_PALETTE.length) % TAG_PALETTE.length];

export const isColor = (c: unknown): c is ColorName => typeof c === "string" && (COLOR_NAMES as readonly string[]).includes(c);

/** "#Work " → "Work" (max 60 characters). */
export const cleanTagName = (raw: unknown) => (typeof raw === "string" ? raw.trim().replace(/^#/, "").trim().slice(0, 60) : "");

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Applies one change to a list of tags (a note's tags, or the known ones). Never returns two tags with the same name. */
export function applyTagChange<T extends TagLite>(tags: T[], change: TagChange): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const push = (t: T) => {
    const k = t.name.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  if (change.kind === "delete") {
    for (const t of tags) if (!same(t.name, change.name)) push(t);
    return out;
  }
  if (change.kind === "merge") {
    const target = tags.find((t) => same(t.name, change.into));
    for (const t of tags) {
      if (same(t.name, change.name)) push(target ?? { ...t, name: change.into }); // keeps the target's color
      else push(t);
    }
    return out;
  }
  for (const t of tags) {
    if (!same(t.name, change.name)) {
      push(t);
      continue;
    }
    push({ ...t, name: change.to?.trim() || t.name, color: change.color ?? t.color });
  }
  return out;
}

/** Notes (or anything with `tags`) after a change; objects that don't carry the tag are returned as they were. */
export function applyTagChangeToAll<T extends { tags: TagLite[] }>(items: T[], change: TagChange): T[] {
  return items.map((n) => (n.tags.some((t) => same(t.name, change.name)) ? { ...n, tags: applyTagChange(n.tags, change) } : n));
}
