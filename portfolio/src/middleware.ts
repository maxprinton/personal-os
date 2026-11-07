// Every address needs a language: "/" and "/about" go to "/en…" or "/es…" (the visitor's saved choice, then the browser's language).
// Anything else (files, API, _next) is left alone. Also remembers the language the visitor picks.
import { NextResponse, type NextRequest } from "next/server";
import { pickLang, splitPath } from "./lib/i18n";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const have = splitPath(pathname);
  if (have) {
    const fwd = new Headers(req.headers);
    fwd.set("x-lang", have.lang); // lets the 404 page speak the visitor's language
    const res = NextResponse.next({ request: { headers: fwd } });
    if (req.cookies.get("lang")?.value !== have.lang) res.cookies.set("lang", have.lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: true });
    return res;
  }
  const lang = pickLang(req.cookies.get("lang")?.value, req.headers.get("accept-language"), (process.env.DEFAULT_LANG as "en" | "es" | undefined) ?? "en");
  const url = req.nextUrl.clone();
  url.pathname = `/${lang}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.redirect(url, 307);
}

export const config = {
  // not for: API routes, Next internals, and any address with a file extension (sitemap.xml, robots.txt, favicon…)
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
