// Pieces shared by the pages: project list, table of contents, singleton page (About, Now…).
import Link from "next/link";
import { listVideos, type ListItem, type PageRow } from "../lib/data";
import { safeBody } from "../lib/html";
import { DICT, type Lang } from "../lib/i18n";
import { fmtDate } from "../lib/dates";
import { hrefOf } from "../lib/paths";
import { thumbOf, watchUrl, YT_ID } from "../lib/videos";
import VideoEmbed from "./VideoEmbed";

export function ProjectList({ lang, items }: { lang: Lang; items: ListItem[] }) {
  const t = DICT[lang];
  if (!items.length) return <p className="sub">{t.noProjects}</p>;
  return (
    <ul className="plist">
      {items.map((p) => (
        <li key={p.slot_id}>
          <span className="yr">{t.years(p.meta.year_from, p.meta.year_to)}</span>
          <span>
            <Link className="pn" href={hrefOf(lang, "project", p.slug)}>
              {p.icon && !p.icon.startsWith("http") ? `${p.icon} ` : ""}
              {p.title}
            </Link>
            {p.summary && <span className="one">{p.summary}</span>}
          </span>
          {p.meta.status && <span className="stamp">{t.status[p.meta.status]}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Toc({ lang, page }: { lang: Lang; page: Pick<PageRow, "toc" | "meta"> }) {
  if (!page.meta.show_toc || page.toc.length < 2) return null;
  return (
    <nav className="toc" aria-label={DICT[lang].onThisPage}>
      <b>{DICT[lang].onThisPage}</b>
      {page.toc.map((h) => (
        <a key={h.id} href={`#${h.id}`} className={h.level >= 3 ? "l3" : undefined}>
          {h.text}
        </a>
      ))}
    </nav>
  );
}

export function Body({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: safeBody(html) }} />;
}

export function Cover({ url }: { url: string | null }) {
  if (!url || !/^https:\/\//.test(url)) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="cover" src={url.split("#")[0]} alt="" loading="lazy" />;
}

export function SingletonView({ lang, page }: { lang: Lang; page: PageRow }) {
  return (
    <>
      <h1>{page.title}</h1>
      {page.summary && <p className="sub">{page.summary}</p>}
      <Cover url={page.cover_url} />
      <Toc lang={lang} page={page} />
      <Body html={page.body_html} />
    </>
  );
}

export function ArticleList({ lang, items }: { lang: Lang; items: ListItem[] }) {
  const t = DICT[lang];
  if (!items.length) return <p className="sub">{t.noArticles}</p>;
  return (
    <ul className="alist">
      {items.map((a) => (
        <li key={a.slot_id}>
          <time className="dt" dateTime={a.published_at ?? undefined}>
            {fmtDate(a.published_at, lang)}
          </time>
          <span>
            <Link className="pn" href={hrefOf(lang, "article", a.slug)}>
              {a.icon && !a.icon.startsWith("http") ? `${a.icon} ` : ""}
              {a.title}
            </Link>
            {a.summary && <span className="one">{a.summary}</span>}
            {a.reading_minutes ? <span className="rd">{t.readMin(a.reading_minutes)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The YouTube video attached to a project or article (its "Video" field in the OS). Click to load. */
export async function Attached({ lang, id, title }: { lang: Lang; id: string | undefined; title: string }) {
  if (!id || !YT_ID.test(id)) return null;
  const t = DICT[lang].videos;
  // only our own copy of the thumbnail is used: nothing is loaded from YouTube before the visitor presses play
  const known = (await listVideos()).find((v) => v.youtube_video_id === id);
  return <VideoEmbed id={id} title={title} thumb={known ? thumbOf(known) : null} playLabel={t.play(title)} watchLabel={t.watch} watchHref={watchUrl(id)} />;
}
