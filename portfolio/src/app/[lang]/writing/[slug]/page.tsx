import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Shell from "../../../../components/Shell";
import { Attached, Body, Cover, Toc } from "../../../../components/Page";
import { alternates, getPage, getSite, liveSlugs, movedTo } from "../../../../lib/data";
import { fmtDate } from "../../../../lib/dates";
import { DICT, LANGS, isLang, type Lang } from "../../../../lib/i18n";
import { jsonLd } from "../../../../lib/html";
import { hrefOf, siteUrl } from "../../../../lib/paths";
import { metaFor } from "../../../../lib/seo";

export const revalidate = 3600;
// pages published after the build are rendered on demand, then cached
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await liveSlugs("article")).map((p) => ({ lang: p.lang, slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const page = isLang(lang) ? await getPage(lang, "article", slug) : null;
  return page && isLang(lang) ? metaFor(lang, page) : {};
}

export default async function Article({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();
  const page = await getPage(lang, "article", slug);
  if (!page) {
    const now = await movedTo(lang, "article", slug);
    if (now) permanentRedirect(`/${lang}/writing/${now}`);
    notFound();
  }
  const t = DICT[lang];
  const [site, a] = await Promise.all([getSite(), alternates(page.slot_id)]);
  const alt: Partial<Record<Lang, string>> = {};
  for (const l of LANGS) if (a[l]) alt[l] = `/${l}/writing/${a[l]!.slug}`;
  const url = siteUrl() + hrefOf(lang, "article", page.slug);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    ...(page.summary ? { description: page.summary } : {}),
    inLanguage: lang,
    datePublished: page.published_at ?? undefined,
    dateModified: page.updated_at,
    author: { "@type": "Person", name: site.name },
    mainEntityOfPage: url,
    ...(page.cover_url && /^https:\/\//.test(page.cover_url) ? { image: page.cover_url.split("#")[0] } : {}),
  };
  const json = jsonLd(ld);
  return (
    <Shell lang={lang} current="writing" alt={alt}>
      <h1>
        {page.icon && !page.icon.startsWith("http") ? `${page.icon} ` : ""}
        {page.title}
      </h1>
      {page.summary && <p className="sub">{page.summary}</p>}
      <p className="byline">
        {page.published_at ? t.publishedOn(fmtDate(page.published_at, lang)) : ""}
        {page.published_at && page.reading_minutes ? " · " : ""}
        {page.reading_minutes ? t.readMin(page.reading_minutes) : ""}
      </p>
      <Cover url={page.cover_url} />
      <Toc lang={lang} page={page} />
      <Body html={page.body_html} />
      <Attached lang={lang} id={page.meta.video} title={page.title} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
    </Shell>
  );
}
