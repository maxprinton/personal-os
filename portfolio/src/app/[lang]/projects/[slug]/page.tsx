import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Shell from "../../../../components/Shell";
import { Attached, Body, Cover, Toc } from "../../../../components/Page";
import { alternates, getPage, liveSlugs, movedTo } from "../../../../lib/data";
import { DICT, LANGS, isLang, type Lang } from "../../../../lib/i18n";
import { metaFor } from "../../../../lib/seo";
import { safeUrl } from "../../../../lib/sanitize";

export const revalidate = 3600;
// pages published after the build are rendered on demand, then cached
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await liveSlugs("project")).map((p) => ({ lang: p.lang, slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const page = isLang(lang) ? await getPage(lang, "project", slug) : null;
  return page && isLang(lang) ? metaFor(lang, page) : {};
}

export default async function Project({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();
  const page = await getPage(lang, "project", slug);
  if (!page) {
    const now = await movedTo(lang, "project", slug);
    if (now) permanentRedirect(`/${lang}/projects/${now}`);
    notFound();
  }
  const t = DICT[lang];
  const a = await alternates(page.slot_id);
  const alt: Partial<Record<Lang, string>> = {};
  for (const l of LANGS) if (a[l]) alt[l] = `/${l}/projects/${a[l]!.slug}`;
  const m = page.meta;
  const years = t.years(m.year_from, m.year_to);
  const links = (m.links ?? []).filter((l) => /^https?:\/\//i.test(l.url) && safeUrl(l.url));
  return (
    <Shell lang={lang} current="projects" alt={alt}>
      <h1>
        {page.icon && !page.icon.startsWith("http") ? `${page.icon} ` : ""}
        {page.title}
      </h1>
      {page.summary && <p className="sub">{page.summary}</p>}
      <div className="meta-row">
        {m.status && <span className="stamp">{t.status[m.status]}</span>}
        {years && <span>{years}</span>}
        {m.role && <span>{m.role}</span>}
        {m.stack && m.stack.length > 0 && (
          <span className="chips" aria-label={t.stack}>
            {m.stack.map((s) => (
              <span className="chip" key={s}>
                {s}
              </span>
            ))}
          </span>
        )}
      </div>
      {links.length > 0 && (
        <div className="btnrow">
          {links.map((l) => (
            <a key={l.url} className="btn" href={l.url} rel="noopener noreferrer" target="_blank">
              {l.label}
            </a>
          ))}
        </div>
      )}
      <Cover url={page.cover_url} />
      <Toc lang={lang} page={page} />
      <Body html={page.body_html} />
      <Attached lang={lang} id={page.meta.video} title={page.title} />
    </Shell>
  );
}
