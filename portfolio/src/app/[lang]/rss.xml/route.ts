// RSS feed of the articles in one language. Summary only, so readers come to the site.
import { getSite, listArticlesForFeed } from "../../../lib/data";
import { isLang } from "../../../lib/i18n";
import { plain } from "../../../lib/html";
import { hrefOf, siteUrl } from "../../../lib/paths";
import { buildRss } from "../../../lib/rss";

export const revalidate = 3600;

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) return new Response("Not found", { status: 404 });
  const [site, rows] = await Promise.all([getSite(), listArticlesForFeed(lang)]);
  const base = siteUrl();
  const xml = buildRss({
    title: `${site.name} — ${lang === "es" ? "Escritos" : "Writing"}`,
    description: site.tagline[lang] ?? site.name,
    lang,
    siteLink: `${base}/${lang}/writing`,
    selfLink: `${base}/${lang}/rss.xml`,
    items: rows.slice(0, 50).map((r) => ({
      title: r.title,
      link: base + hrefOf(lang, "article", r.slug),
      pubDate: r.published_at,
      summary: r.summary?.trim() || plain(r.search_text.startsWith(r.title) ? r.search_text.slice(r.title.length) : r.search_text, 200),
    })),
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
