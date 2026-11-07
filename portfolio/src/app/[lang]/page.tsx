import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "../../components/Shell";
import { Body, ProjectList } from "../../components/Page";
import VideoEmbed from "../../components/VideoEmbed";
import { getPage, getSite, listPages, listVideos } from "../../lib/data";
import { DICT, LANGS, isLang, type Lang } from "../../lib/i18n";
import { metaForList } from "../../lib/seo";
import { siteUrl } from "../../lib/paths";
import { pickLatest, textOf, thumbOf, watchUrl } from "../../lib/videos";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const [home, site] = await Promise.all([getPage(lang, "home"), getSite()]);
  const base = await metaForList(lang, "home", "", site.name);
  const description = home?.meta.seo_desc?.trim() || home?.summary?.trim() || site.tagline[lang];
  return { ...base, title: { absolute: [site.name, site.tagline[lang]].filter(Boolean).join(" — ") }, description, openGraph: { ...base.openGraph, title: site.name, description } };
}

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const l: Lang = lang;
  const [site, home, projects, videos] = await Promise.all([getSite(), getPage(l, "home"), listPages(l, "project"), listVideos()]);
  const latest = pickLatest(videos);
  const t = DICT[l];
  const alt: Partial<Record<Lang, string>> = Object.fromEntries(LANGS.map((x) => [x, `/${x}`]));
  const featured = projects.filter((p) => p.featured);
  const shown = (featured.length ? featured : projects).slice(0, 5);
  const person = { "@context": "https://schema.org", "@type": "Person", name: site.name, url: `${siteUrl()}/${l}`, sameAs: site.links.map((x) => x.url) };
  return (
    <Shell lang={l} current="home" alt={alt}>
      <h1 className="lead">
        <mark>{site.tagline[l]}</mark>
      </h1>
      {home && <Body html={home.body_html} />}
      {shown.length > 0 && (
        <>
          <h2>{featured.length ? t.featured : t.nav.projects}</h2>
          <ProjectList lang={l} items={shown} />
          <p>
            <Link href={`/${l}/projects`}>{t.allProjects} →</Link>
          </p>
        </>
      )}
      {latest && (
        <>
          <h2>{t.videos.latest}</h2>
          <VideoEmbed id={latest.youtube_video_id} title={textOf(latest.title, l)} thumb={thumbOf(latest)} playLabel={t.videos.play(textOf(latest.title, l))} watchLabel={t.videos.watch} watchHref={watchUrl(latest.youtube_video_id)} />
          <p className="byline">{textOf(latest.title, l)}</p>
          <p>
            <Link href={`/${l}/videos`}>{t.videos.all} →</Link>
          </p>
        </>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(person).replace(/</g, "\\u003c") }} />
    </Shell>
  );
}
