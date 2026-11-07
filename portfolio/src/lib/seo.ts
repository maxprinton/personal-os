// Page metadata: title, description, canonical address, language alternates, social cards.
import type { Metadata } from "next";
import { alternates, getSite, type Kind, type PageRow } from "./data";
import { plain } from "./html";
import { LANGS, type Lang } from "./i18n";
import { ogPath } from "./og";
import { hrefOf, siteUrl } from "./paths";

export const noindex = () => process.env.ROBOTS_NOINDEX === "1";
const OG_LOCALE: Record<Lang, string> = { en: "en_US", es: "es_ES" };

/** Metadata of a page that exists (a live row). */
export async function metaFor(lang: Lang, row: PageRow): Promise<Metadata> {
  const [site, alt] = await Promise.all([getSite(), alternates(row.slot_id)]);
  const title = row.meta.seo_title?.trim() || row.title;
  const body = row.search_text.startsWith(row.title) ? row.search_text.slice(row.title.length) : row.search_text;
  const description = row.meta.seo_desc?.trim() || row.summary?.trim() || plain(body, 160);
  const url = siteUrl() + hrefOf(lang, row.kind, row.slug);
  const languages: Record<string, string> = {};
  for (const l of LANGS) if (alt[l]) languages[l] = siteUrl() + hrefOf(l, alt[l]!.kind, alt[l]!.slug);
  if (languages[site.default_lang]) languages["x-default"] = languages[site.default_lang];
  const image = row.cover_url && /^https:\/\//.test(row.cover_url) ? row.cover_url.split("#")[0] : (site.social_image_url ?? siteUrl() + ogPath(lang, row.kind, row.slug));
  const full = row.kind === "home" ? site.name : `${title} · ${site.name}`;
  return {
    title: row.kind === "home" ? { absolute: `${site.name} — ${site.tagline[lang] ?? ""}`.replace(/ — $/, "") } : title,
    description,
    alternates: { canonical: url, languages, types: { "application/rss+xml": `${siteUrl()}/${lang}/rss.xml` } },
    openGraph: { title: full, description, url, siteName: site.name, locale: OG_LOCALE[lang], type: row.kind === "article" ? "article" : "website", ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title: full, description, ...(image ? { images: [image] } : {}) },
    robots: noindex() ? { index: false, follow: false } : undefined,
  };
}

/** Metadata of a list page (e.g. all projects). */
export async function metaForList(lang: Lang, kind: Kind, path: string, title: string): Promise<Metadata> {
  const site = await getSite();
  const languages: Record<string, string> = {};
  for (const l of LANGS) languages[l] = siteUrl() + `/${l}${path}`;
  languages["x-default"] = languages[site.default_lang];
  return {
    title,
    alternates: { canonical: siteUrl() + `/${lang}${path}`, languages, types: { "application/rss+xml": `${siteUrl()}/${lang}/rss.xml` } },
    openGraph: { title: `${title} · ${site.name}`, siteName: site.name, locale: OG_LOCALE[lang], type: "website", url: siteUrl() + `/${lang}${path}`, images: [{ url: site.social_image_url ?? siteUrl() + ogPath(lang, "site", "site") }] },
    robots: noindex() ? { index: false, follow: false } : undefined,
  };
}
