// Social-card helpers (pure). The card address is built from a page's kind and slug; the title is read from the database,
// never from the address, so nobody can make the site draw text of their choosing.
import type { Lang } from "./i18n";

export const OG_KINDS = ["site", "home", "about", "now", "uses", "project", "article"] as const;
export type OgKind = (typeof OG_KINDS)[number];
export const isOgKind = (v: string): v is OgKind => (OG_KINDS as readonly string[]).includes(v);
export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const ogPath = (lang: Lang, kind: OgKind, slug: string) => `/${lang}/og/${kind}/${kind === "site" ? "site" : SLUG.test(slug) ? slug : kind}`;

/** Title cut to fit the card, and a font size that fits its length. */
export function fitTitle(title: string): { text: string; size: number } {
  const t = title.replace(/\s+/g, " ").trim();
  const text = t.length > 90 ? t.slice(0, 89).replace(/\s+\S*$/, "") + "…" : t;
  return { text, size: text.length <= 28 ? 84 : text.length <= 52 ? 68 : 54 };
}
