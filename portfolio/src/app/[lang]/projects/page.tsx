import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Shell from "../../../components/Shell";
import { ProjectList } from "../../../components/Page";
import { listPages } from "../../../lib/data";
import { DICT, LANGS, isLang, type Lang } from "../../../lib/i18n";
import { metaForList } from "../../../lib/seo";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? metaForList(lang, "project", "/projects", DICT[lang].nav.projects) : {};
}

export default async function Projects({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const items = await listPages(lang, "project");
  const alt: Partial<Record<Lang, string>> = Object.fromEntries(LANGS.map((l) => [l, `/${l}/projects`]));
  return (
    <Shell lang={lang} current="projects" alt={alt}>
      <h1>{DICT[lang].nav.projects}</h1>
      <ProjectList lang={lang} items={items} />
    </Shell>
  );
}
