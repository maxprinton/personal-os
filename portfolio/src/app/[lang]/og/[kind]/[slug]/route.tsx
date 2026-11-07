// Social card (1200×630) for a page: its title on the notebook look. Built from the page's kind and slug; the text comes from the database.
import { ImageResponse } from "next/og";
import { getPage, getSite, type Kind } from "../../../../../lib/data";
import { DICT, isLang } from "../../../../../lib/i18n";
import { fitTitle, isOgKind, SLUG } from "../../../../../lib/og";

export const revalidate = 3600;
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; kind: string; slug: string }> }) {
  const { lang, kind, slug } = await params;
  if (!isLang(lang) || !isOgKind(kind) || !SLUG.test(slug)) return new Response("Not found", { status: 404 });
  const site = await getSite();
  let title = site.name;
  let sub = site.tagline[lang] ?? "";
  if (kind !== "site") {
    const page = await getPage(lang, kind as Kind, ["project", "article"].includes(kind) ? slug : undefined);
    if (!page) return new Response("Not found", { status: 404 });
    if (kind !== "home") {
      title = page.title;
      sub = `${DICT[lang].search.kinds[kind]} · ${site.name}`;
    }
  }
  const t = fitTitle(title);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#17302a", padding: 56 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#eceeea", borderRadius: 18, padding: "56px 72px", border: "4px solid #1b2a26" }}>
          <div style={{ display: "flex", fontSize: 30, color: "#3f4d48", letterSpacing: 1 }}>{site.name}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: t.size, fontWeight: 800, color: "#2b4f9e", lineHeight: 1.1 }}>{t.text}</div>
            <div style={{ display: "flex", width: 220, height: 14, background: "#f4d35e", marginTop: 24 }} />
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#1b2a26" }}>{sub}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
