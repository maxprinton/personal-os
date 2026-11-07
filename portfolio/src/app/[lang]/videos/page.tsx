import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Shell from "../../../components/Shell";
import VideoEmbed from "../../../components/VideoEmbed";
import { listVideos } from "../../../lib/data";
import { fmtDate } from "../../../lib/dates";
import { jsonLd } from "../../../lib/html";
import { DICT, LANGS, isLang, type Lang } from "../../../lib/i18n";
import { siteUrl } from "../../../lib/paths";
import { metaForList } from "../../../lib/seo";
import { fmtLength, isoDuration, textOf, thumbOf, watchUrl } from "../../../lib/videos";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const base = await metaForList(lang, "home", "/videos", DICT[lang].nav.videos);
  return { ...base, description: DICT[lang].videos.intro };
}

export default async function Videos({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = DICT[lang];
  const videos = await listVideos();
  const alt: Partial<Record<Lang, string>> = Object.fromEntries(LANGS.map((l) => [l, `/${l}/videos`]));
  const ld = videos.map((v) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: textOf(v.title, lang),
    description: textOf(v.description, lang) || textOf(v.title, lang),
    ...(thumbOf(v) ? { thumbnailUrl: thumbOf(v) } : {}),
    ...(v.published_at ? { uploadDate: v.published_at } : {}),
    ...(isoDuration(v.duration_s) ? { duration: isoDuration(v.duration_s) } : {}),
    embedUrl: `https://www.youtube-nocookie.com/embed/${v.youtube_video_id}`,
    inLanguage: lang,
    url: `${siteUrl()}/${lang}/videos`,
  }));
  return (
    <Shell lang={lang} current="videos" alt={alt}>
      <h1>{t.nav.videos}</h1>
      <p className="sub">{t.videos.intro}</p>
      {videos.length === 0 ? (
        <p className="sub">{t.videos.none}</p>
      ) : (
        <div className="vlist">
          {videos.map((v) => {
            const title = textOf(v.title, lang);
            const desc = textOf(v.description, lang);
            const meta = [fmtDate(v.published_at, lang), fmtLength(v.duration_s)].filter(Boolean).join(" · ");
            return (
              <article key={v.id} className="vitem">
                <h2>{title}</h2>
                {meta && <p className="byline">{meta}</p>}
                <VideoEmbed id={v.youtube_video_id} title={title} thumb={thumbOf(v)} playLabel={t.videos.play(title)} watchLabel={t.videos.watch} watchHref={watchUrl(v.youtube_video_id)} />
                {desc && <p>{desc}</p>}
              </article>
            );
          })}
        </div>
      )}
      {videos.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />}
    </Shell>
  );
}
