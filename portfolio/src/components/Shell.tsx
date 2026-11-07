// The frame of every page: sidebar (name, menu, language, "Now") + the notebook page.
import Link from "next/link";
import type { ReactNode } from "react";
import { getPage, getSite, listVideos, liveIndex } from "../lib/data";
import { plain } from "../lib/html";
import { DICT, LANG_NAME, OTHER, type Lang } from "../lib/i18n";
import { buildNav, type NavKey } from "../lib/nav";

export default async function Shell({ lang, current, alt, children }: { lang: Lang; current: NavKey | null; alt?: Partial<Record<Lang, string>>; children: ReactNode }) {
  const [site, index, now, videos] = await Promise.all([getSite(), liveIndex(lang), getPage(lang, "now"), listVideos()]);
  const t = DICT[lang];
  const nav = buildNav(lang, site, index, { videos: videos.length > 0 });
  const other = OTHER[lang];
  const otherHref = alt?.[other];
  const nowText = now ? (now.summary?.trim() || plain(now.search_text.startsWith(now.title) ? now.search_text.slice(now.title.length) : now.search_text, 150)) : "";
  const role = site.tagline[lang];
  return (
    <>
      <a href="#main" className="skip">
        {t.skip}
      </a>
      <div className="shell">
        <header className="side">
          <Link href={`/${lang}`} className="name">
            <span>{site.name}</span>
          </Link>
          {role && <p className="role">{role}</p>}
          <nav className="menu" aria-label="Main">
            {nav.map((n) => (
              <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <form className="searchbox" action={`/${lang}/search`} method="get" role="search">
            <label className="sr" htmlFor="q">
              {t.search.label}
            </label>
            <input id="q" name="q" type="search" maxLength={80} placeholder={t.search.placeholder} autoComplete="off" />
            <button type="submit">{t.search.button}</button>
          </form>
          <div className="langs" role="group" aria-label={t.language}>
            <span aria-current="true" lang={lang}>
              {lang.toUpperCase()}
            </span>
            {otherHref ? (
              <Link href={otherHref} hrefLang={other} lang={other} title={LANG_NAME[other]}>
                {other.toUpperCase()}
              </Link>
            ) : (
              <Link href={`/${other}`} hrefLang={other} lang={other} className="dim" title={`${DICT[other].notTranslated} ${LANG_NAME[other]}`}>
                {other.toUpperCase()}
              </Link>
            )}
          </div>
          {now && nowText && (
            <aside className="nowcard" aria-label={t.now}>
              <b>
                <span className="dot" aria-hidden="true" />
                {t.now}
              </b>
              {nowText} <Link href={`/${lang}/now`}>{t.seeNow}</Link>
            </aside>
          )}
          {site.links.length > 0 && (
            <div className="sidelinks">
              {site.links.map((l) => (
                <a key={l.url} href={l.url} rel="me noopener noreferrer" target="_blank">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </header>
        <main id="main" className="page">
          {children}
          <p className="foot">
            © {new Date().getFullYear()} {site.name} · {t.footer}
          </p>
        </main>
      </div>
    </>
  );
}
