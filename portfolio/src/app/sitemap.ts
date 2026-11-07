import type { MetadataRoute } from "next";
import { getSite, listVideos, liveIndex } from "../lib/data";
import { LANGS } from "../lib/i18n";
import { hrefOf, siteUrl } from "../lib/paths";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSite();
  const base = siteUrl();
  const out: MetadataRoute.Sitemap = [];
  const hasVideos = (await listVideos()).length > 0;
  const lists: Record<string, string> = { project: "/projects", article: "/writing" };
  for (const lang of LANGS) {
    out.push({ url: `${base}/${lang}`, changeFrequency: "weekly", priority: 1 });
    if (hasVideos) out.push({ url: `${base}/${lang}/videos`, changeFrequency: "weekly", priority: 0.6 });
    if (site.contact_enabled) out.push({ url: `${base}/${lang}/contact`, changeFrequency: "yearly", priority: 0.4 });
    const live = await liveIndex(lang);
    const kinds = new Set(live.map((p) => p.kind));
    for (const k of kinds) if (lists[k]) out.push({ url: `${base}/${lang}${lists[k]}`, changeFrequency: "weekly", priority: 0.7 });
    for (const p of live) if (p.kind !== "home") out.push({ url: base + hrefOf(lang, p.kind, p.slug), lastModified: p.updated_at, priority: p.kind === "project" ? 0.8 : 0.6 });
  }
  return out;
}
