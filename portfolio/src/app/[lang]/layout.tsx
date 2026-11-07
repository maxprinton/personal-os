import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Shantell_Sans, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "../globals.css";
import { LANGS, isLang } from "../../lib/i18n";
import { ANALYTICS_SRC, analyticsOn } from "../../lib/analytics";
import { getSite } from "../../lib/data";
import { noindex } from "../../lib/seo";
import { siteUrl } from "../../lib/paths";

const hand = Shantell_Sans({ subsets: ["latin"], weight: ["800"], variable: "--f-hand", display: "swap" });
const ui = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-ui", display: "swap" });
const body = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], variable: "--f-body", display: "swap" });

export const metadata: Metadata = { metadataBase: new URL(siteUrl()), robots: noindex() ? { index: false, follow: false } : undefined };
export const generateStaticParams = () => LANGS.map((lang) => ({ lang }));
export const dynamicParams = false;

export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const site = await getSite();
  return (
    <html lang={lang} className={`${hand.variable} ${ui.variable} ${body.variable}`}>
      <body>
        {children}
        {analyticsOn(site) && <script defer src={ANALYTICS_SRC} />}
      </body>
    </html>
  );
}
