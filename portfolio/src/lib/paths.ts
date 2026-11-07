// Public addresses. The OS stores a page's path without language ("/projects/os"); the site puts the language in front.
import type { Lang } from "./i18n";
import type { Kind } from "./data";

export function pathOf(kind: Kind, slug: string): string {
  switch (kind) {
    case "home":
      return "";
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
export const hrefOf = (lang: Lang, kind: Kind, slug: string) => `/${lang}${pathOf(kind, slug)}`;

export function siteUrl(): string {
  return (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || "http://localhost:3001").replace(/\/+$/, "");
}
