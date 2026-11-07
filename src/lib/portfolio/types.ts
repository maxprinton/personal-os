// Portfolio add-on — shared types (no server code).
import type { Lang, SlotKind } from "@/lib/portfolio/constants";

export type { Lang, SlotKind };

/** Per-language text of a slot: URL slug and the texts that are not part of the note body. */
export type LangMeta = { slug?: string; summary?: string; role?: string; seo_title?: string; seo_desc?: string };
export type SlotLangs = Partial<Record<Lang, LangMeta>>;

/** Neutral slot metadata (the same in both languages). */
export type SlotMeta = {
  status?: "idea" | "in_progress" | "shipped" | "paused";
  year_from?: number;
  year_to?: number | null;
  stack?: string[];
  links?: { label: string; url: string }[];
  video?: string; // YouTube video id of a related video
};

export type Slot = {
  id: string;
  kind: SlotKind;
  key: string;
  previous_keys: string[];
  position: number;
  featured: boolean;
  archived: boolean;
  meta: SlotMeta;
  langs: SlotLangs;
  created_at: string;
  updated_at: string;
};

/** The note linked to a slot in one language (only what the portfolio screens need). */
export type LinkedNote = { id: string; title: string; icon: string | null; updated_at: string; deleted_at: string | null };

/** The public row of a slot in one language, when it was ever published. */
export type PublishedInfo = {
  version: number;
  is_live: boolean;
  published_at: string | null;
  slug: string;
  /** hash of the note content that went live (from the last publish version), when known */
  source_hash: string | null;
};

export type PageStatus = "no_note" | "draft" | "published" | "changed" | "unpublished" | "trashed";

export const STATUS_LABEL: Record<PageStatus, string> = {
  no_note: "No note",
  draft: "Draft",
  published: "Published",
  changed: "Changed since published",
  unpublished: "Unpublished",
  trashed: "Source note in trash",
};

/** One slot with, per language, its note, its public row and its computed status. */
export type SlotView = Slot & {
  pages: Record<Lang, { note: LinkedNote | null; published: PublishedInfo | null; status: PageStatus }>;
};
