import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Shell from "../../../components/Shell";
import { SingletonView } from "../../../components/Page";
import { alternates, getPage } from "../../../lib/data";
import { LANGS, isLang, type Lang } from "../../../lib/i18n";
import { metaFor } from "../../../lib/seo";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const page = isLang(lang) ? await getPage(lang, "uses") : null;
  return page && isLang(lang) ? metaFor(lang, page) : {};
}

export default async function Uses({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const page = await getPage(lang, "uses");
  if (!page) notFound();
  const a = await alternates(page.slot_id);
  const alt: Partial<Record<Lang, string>> = {};
  for (const l of LANGS) if (a[l]) alt[l] = `/${l}/uses`;
  return (
    <Shell lang={lang} current="uses" alt={alt}>
      <SingletonView lang={lang} page={page} />
    </Shell>
  );
}
