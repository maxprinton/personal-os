// Portfolio add-on — shared constants (no server code here, safe to import anywhere).
export const BASE = "/portfolio";
export const MIGRATION_FILE = "MIGRACION-0042-portfolio.sql";

/** Sub-navigation. */
export const ADDON_NAV = [
  { href: BASE, label: "Overview" },
  { href: `${BASE}/pages`, label: "Pages" },
  { href: `${BASE}/videos`, label: "Videos" },
  { href: `${BASE}/inbox`, label: "Inbox" },
  { href: `${BASE}/settings`, label: "Settings" },
] as const;

export const LANGS = ["en", "es"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_LABEL: Record<Lang, string> = { en: "English", es: "Español" };

export const KINDS = ["home", "about", "now", "uses", "project", "article"] as const;
export type SlotKind = (typeof KINDS)[number];
