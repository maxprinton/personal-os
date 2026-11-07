import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "../../../components/Shell";
import { ArticleList } from "../../../components/Page";
import { listPages } from "../../../lib/data";
import { DICT, LANGS, isLang, type Lang } from "../../../lib/i18n";
import { metaForList } from "../../../lib/seo";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const base = await metaForList(lang, "article", "/writing", DICT[lang].nav.writing);
  return { ...base, description: DICT[lang].writingIntro };
}

export default async function Writing({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = DICT[lang];
  const items = await listPages(lang, "article");
  const alt: Partial<Record<Lang, string>> = Object.fromEntries(LANGS.map((l) => [l, `/${l}/writing`]));
  return (
    <Shell lang={lang} current="writing" alt={alt}>
      <h1>{t.nav.writing}</h1>
      <p className="sub">{t.writingIntro}</p>
      <ArticleList lang={lang} items={items} />
      <p className="rsslink">
        <Link href={`/${lang}/rss.xml`} prefetch={false}>
          {t.rss}
        </Link>
      </p>
    </Shell>
  );
}
