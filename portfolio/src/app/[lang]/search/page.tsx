import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "../../../components/Shell";
import { searchPages } from "../../../lib/data";
import { DICT, LANGS, isLang, type Lang } from "../../../lib/i18n";
import { hrefOf } from "../../../lib/paths";
import { cleanQuery } from "../../../lib/search";

// Depends on the query, so it is rendered on request and never indexed.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return { title: isLang(lang) ? DICT[lang].search.title : "Search", robots: { index: false, follow: false } };
}

export default async function Search({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const sp = await searchParams;
  const raw = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const q = cleanQuery(raw);
  const t = DICT[lang].search;
  const hits = q ? await searchPages(lang, q) : [];
  const alt: Partial<Record<Lang, string>> = Object.fromEntries(LANGS.map((l) => [l, `/${l}/search`]));
  return (
    <Shell lang={lang} current={null} alt={alt}>
      <h1>{t.title}</h1>
      <form className="sform" action={`/${lang}/search`} method="get" role="search">
        <label className="sr" htmlFor="sq">
          {t.label}
        </label>
        <input id="sq" name="q" type="search" defaultValue={q} maxLength={80} placeholder={t.placeholder} autoComplete="off" />
        <button type="submit">{t.button}</button>
      </form>
      {!raw.trim() ? (
        <p className="sub">{t.hint}</p>
      ) : !q ? (
        <p className="sub">{t.tooShort}</p>
      ) : hits.length === 0 ? (
        <p className="sub">{t.none(q)}</p>
      ) : (
        <>
          <p className="sub" aria-live="polite">
            {t.results(hits.length, q)}
          </p>
          <ul className="hits">
            {hits.map((h) => (
              <li key={h.kind + h.slug}>
                <Link className="pn" href={hrefOf(lang, h.kind, h.slug)}>
                  {h.icon && !h.icon.startsWith("http") ? `${h.icon} ` : ""}
                  {h.title}
                </Link>
                <span className="kind">{t.kinds[h.kind]}</span>
                <span className="one">{h.snippet}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}
