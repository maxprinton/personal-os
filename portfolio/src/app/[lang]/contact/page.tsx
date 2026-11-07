import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Shell from "../../../components/Shell";
import ContactForm from "../../../components/ContactForm";
import { getSite } from "../../../lib/data";
import { DICT, LANGS, isLang, type Lang } from "../../../lib/i18n";
import { metaForList } from "../../../lib/seo";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const base = await metaForList(lang, "home", "/contact", DICT[lang].nav.contact);
  return { ...base, description: DICT[lang].contact.intro };
}

export default async function Contact({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const site = await getSite();
  if (!site.contact_enabled) notFound();
  const t = DICT[lang];
  // the form needs Turnstile (site key) and the secrets to forward the message; without them it says so instead of failing
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const configured = !!siteKey && !!process.env.TURNSTILE_SECRET_KEY && !!process.env.PORTFOLIO_OS_URL && !!process.env.PORTFOLIO_REVALIDATE_SECRET;
  const alt: Partial<Record<Lang, string>> = Object.fromEntries(LANGS.map((l) => [l, `/${l}/contact`]));
  return (
    <Shell lang={lang} current="contact" alt={alt}>
      <h1>{t.nav.contact}</h1>
      <p className="sub">{t.contact.intro}</p>
      {configured ? (
        <ContactForm lang={lang} siteKey={siteKey!} />
      ) : (
        <p className="sub">
          {t.contact.unavailable}
          {site.links.length > 0 && (
            <>
              {" "}
              {site.links.map((l, i) => (
                <span key={l.url}>
                  {i ? " · " : ""}
                  <a href={l.url} rel="me noopener noreferrer" target="_blank">
                    {l.label}
                  </a>
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </Shell>
  );
}
