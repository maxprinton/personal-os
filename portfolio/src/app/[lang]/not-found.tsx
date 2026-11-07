// 404 inside /en and /es, in the visitor's language (the middleware passes it in the x-lang header).
import { headers } from "next/headers";
import Link from "next/link";
import Shell from "../../components/Shell";
import { DICT, isLang, type Lang } from "../../lib/i18n";

export const metadata = { title: "404", robots: { index: false, follow: false } };

export default async function LangNotFound() {
  const h = (await headers()).get("x-lang") ?? "";
  const lang: Lang = isLang(h) ? h : "en";
  const t = DICT[lang];
  return (
    <Shell lang={lang} current={null}>
      <h1>{t.notFoundTitle}</h1>
      <p className="sub">{t.notFoundText}</p>
      <p>
        <Link href={`/${lang}`}>{t.backHome} →</Link>
      </p>
    </Shell>
  );
}
