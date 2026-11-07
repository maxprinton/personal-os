// Portfolio add-on — status of one slot + language (pure function).
import type { LinkedNote, PageStatus, PublishedInfo } from "@/lib/portfolio/types";

/**
 * No note · Draft · Published · Changed since published · Unpublished · Source note in trash.
 * "Changed" compares a hash of the note when both are known (exact); otherwise it falls back to
 * "the note was edited after it went live" (a few seconds of tolerance for the publish itself).
 */
export function computeStatus(note: LinkedNote | null, published: PublishedInfo | null, currentHash?: string | null): PageStatus {
  if (!note) return published?.is_live ? "published" : "no_note";
  if (note.deleted_at) return "trashed";
  if (!published) return "draft";
  if (!published.is_live) return "unpublished";
  return hasChanged(note, published, currentHash) ? "changed" : "published";
}

export function hasChanged(note: LinkedNote, published: PublishedInfo, currentHash?: string | null): boolean {
  if (currentHash && published.source_hash) return currentHash !== published.source_hash;
  if (!published.published_at) return true;
  return Date.parse(note.updated_at) - Date.parse(published.published_at) > 5_000;
}

/** Statuses that need the owner's attention on the Overview. */
export const NEEDS_ATTENTION: readonly PageStatus[] = ["changed", "trashed"];

/** A page can go live only with a live, non-trashed note. */
export const canPublish = (s: PageStatus) => s === "draft" || s === "changed" || s === "unpublished";
