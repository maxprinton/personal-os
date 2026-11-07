// Portfolio add-on — slot rules (pure functions: no database, easy to test).
import { KINDS, LANGS, type Lang, type SlotKind } from "@/lib/portfolio/constants";
import type { Slot, SlotLangs } from "@/lib/portfolio/types";

/** Kinds that exist exactly once: their key is the kind itself. */
export const SINGLETON_KINDS: readonly SlotKind[] = ["home", "about", "now", "uses"];
export const isSingleton = (k: SlotKind) => SINGLETON_KINDS.includes(k);
export const isKind = (v: unknown): v is SlotKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

export const KIND_LABEL: Record<SlotKind, string> = {
  home: "Home",
  about: "About",
  now: "Now",
  uses: "Uses",
  project: "Project",
  article: "Article",
};

/** Lowercase a-z0-9 and single hyphens; accents removed. "Mi Proyecto Ñandú!" -> "mi-proyecto-nandu". */
export function slugify(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Slugs that would clash with site routes. */
export const RESERVED_SLUGS = ["es", "en", "api", "preview", "search", "rss", "feed", "sitemap", "robots", "admin", "_next"];

/** null = fine, otherwise a short message for the user. */
export function slugProblem(slug: string): string | null {
  if (!slug) return "Write a URL name (slug).";
  if (slug.length > 60) return "The URL name is too long (60 characters at most).";
  if (!SLUG_RE.test(slug)) return "Use only lowercase letters, numbers and single hyphens.";
  if (RESERVED_SLUGS.includes(slug)) return `"${slug}" is reserved by the site.`;
  return null;
}

/** The internal key of a slot: the kind for singletons, a clean slug otherwise. */
export function keyFor(kind: SlotKind, wanted: string): string {
  return isSingleton(kind) ? kind : slugify(wanted);
}

export function keyProblem(kind: SlotKind, key: string): string | null {
  if (isSingleton(kind)) return key === kind ? null : `The key of ${KIND_LABEL[kind]} is always "${kind}".`;
  if (!key) return "Write a name for this slot.";
  return slugProblem(key);
}

/** The URL slug of a slot in a language: its own, or the key. Singletons have no slug in their URL. */
export function slugFor(slot: Pick<Slot, "kind" | "key" | "langs">, lang: Lang): string {
  return slot.langs?.[lang]?.slug?.trim() || slot.key;
}

/** Path of a published page inside one language (the language prefix is added by the site). */
export function pathFor(slot: Pick<Slot, "kind" | "key" | "langs">, lang: Lang): string {
  const slug = slugFor(slot, lang);
  switch (slot.kind) {
    case "home":
      return "/";
    case "about":
      return "/about";
    case "now":
      return "/now";
    case "uses":
      return "/uses";
    case "project":
      return `/projects/${slug}`;
    case "article":
      return `/writing/${slug}`;
  }
}

/** Another slot of the same kind that already uses this slug in this language (null = free). */
export function slugTaken(slots: Pick<Slot, "id" | "kind" | "key" | "langs" | "archived">[], self: string | null, kind: SlotKind, lang: Lang, slug: string) {
  return (
    slots.find((s) => s.id !== self && s.kind === kind && !s.archived && slugFor(s, lang) === slug) ?? null
  );
}

/** Slugs can change freely until the first publish; later, the old one is kept for redirects. */
export function renameKey(slot: Pick<Slot, "key" | "previous_keys">, newKey: string, everPublished: boolean) {
  if (newKey === slot.key) return { key: slot.key, previous_keys: slot.previous_keys };
  return {
    key: newKey,
    previous_keys: everPublished ? [...new Set([...slot.previous_keys, slot.key])].filter((k) => k !== newKey) : slot.previous_keys,
  };
}

/** Position for a new slot: after the last one of its kind. */
export function nextPosition(slots: Pick<Slot, "kind" | "position">[], kind: SlotKind) {
  const last = slots.filter((s) => s.kind === kind).reduce((m, s) => Math.max(m, s.position), 0);
  return last + 1;
}

/** Order for lists: kind order, featured first, then position, then key. */
export function sortSlots<T extends Pick<Slot, "kind" | "featured" | "position" | "key">>(list: T[]): T[] {
  const k = (s: T) => KINDS.indexOf(s.kind);
  return [...list].sort((a, b) => k(a) - k(b) || Number(b.featured) - Number(a.featured) || a.position - b.position || a.key.localeCompare(b.key));
}

/** Keeps only known languages and trims texts; drops empty entries. */
export function cleanLangs(input: unknown): SlotLangs {
  const out: SlotLangs = {};
  if (!input || typeof input !== "object") return out;
  for (const lang of LANGS) {
    const raw = (input as Record<string, unknown>)[lang];
    if (!raw || typeof raw !== "object") continue;
    const m: Record<string, string> = {};
    for (const f of ["slug", "summary", "role", "seo_title", "seo_desc"] as const) {
      const v = (raw as Record<string, unknown>)[f];
      if (typeof v === "string" && v.trim()) m[f] = v.trim().slice(0, f === "seo_desc" || f === "summary" ? 400 : 120);
    }
    if (Object.keys(m).length) out[lang] = m;
  }
  return out;
}
