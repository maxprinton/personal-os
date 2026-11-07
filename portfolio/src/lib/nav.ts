// The menu. Sections whose routes are not built yet stay out, whatever the site settings say.
import type { Kind, SiteRow } from "./data";
import { DICT, type Lang } from "./i18n";

export type NavKey = "home" | "about" | "projects" | "writing" | "uses" | "now" | "videos" | "contact";
/** Flip these as the phases ship. */
export const READY: Record<NavKey, boolean> = { home: true, about: true, projects: true, writing: true, uses: true, now: true, videos: true, contact: true };

export type NavItem = { key: NavKey; href: string; label: string };

const KIND_TO_KEY: Record<string, NavKey> = { home: "home", about: "about", project: "projects", projects: "projects", article: "writing", writing: "writing", uses: "uses", now: "now", videos: "videos", contact: "contact" };
const HREF: Record<NavKey, string> = { home: "", about: "/about", projects: "/projects", writing: "/writing", uses: "/uses", now: "/now", videos: "/videos", contact: "/contact" };

export function buildNav(lang: Lang, site: SiteRow, live: { kind: Kind }[], extras: { videos?: boolean } = {}): NavItem[] {
  const has = new Set(live.map((p) => p.kind));
  const exists: Record<NavKey, boolean> = {
    home: true,
    about: has.has("about"),
    projects: has.has("project"),
    writing: has.has("article"),
    uses: has.has("uses"),
    now: has.has("now"),
    videos: !!extras.videos,
    contact: site.contact_enabled,
  };
  const t = DICT[lang].nav;
  const custom = site.nav.map((n) => ({ key: KIND_TO_KEY[n.kind], label: n.label?.[lang] })).filter((n): n is { key: NavKey; label: string | undefined } => !!n.key);
  const order: { key: NavKey; label?: string }[] = custom.length ? custom : (["home", "about", "projects", "writing", "uses", "now", "videos", "contact"] as NavKey[]).map((key) => ({ key }));
  return order.filter((n) => READY[n.key] && exists[n.key]).map((n) => ({ key: n.key, href: `/${lang}${HREF[n.key]}`, label: n.label?.trim() || t[n.key] }));
}
