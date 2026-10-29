// Title, description, picture and icon of a web page, for web bookmarks and link mentions (like Notion).
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

function meta(html: string, names: string[]): string | null {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = re1.exec(html) ?? re2.exec(html);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

const decode = (s: string | null) =>
  s
    ?.replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .slice(0, 300) ?? null;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Bad link" }, { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) return NextResponse.json({ error: "Bad link" }, { status: 400 });
  const out: { title: string | null; description: string | null; image: string | null; icon: string | null } = { title: null, description: null, image: null, icon: null };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; PersonalOS-LinkPreview/1.0)", Accept: "text/html,*/*" } });
    clearTimeout(t);
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("html")) {
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        const dec = new TextDecoder();
        while (html.length < 400_000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += dec.decode(value, { stream: true });
          if (/<\/head>/i.test(html)) break;
        }
        void reader.cancel().catch(() => {});
      }
      const base = new URL(res.url || url.href);
      const abs = (v: string | null) => {
        if (!v) return null;
        try {
          return new URL(v, base).href;
        } catch {
          return null;
        }
      };
      out.title = decode(meta(html, ["og:title", "twitter:title"]) ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null);
      out.description = decode(meta(html, ["og:description", "twitter:description", "description"]));
      out.image = abs(meta(html, ["og:image", "og:image:url", "twitter:image"]));
      const icon = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i.exec(html)?.[1] ?? null;
      out.icon = abs(icon) ?? `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=64`;
    }
  } catch {
    // Unreachable sites still get a bookmark with their address
  }
  if (!out.icon) out.icon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
  return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=86400" } });
}
