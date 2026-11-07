// Public site (portfolio/), Phase 3: languages, menu, addresses, headings, page order, and that the site's copies of the
// OS's sanitizer and signing helper are identical. Nothing is sent.
// Run: npm run test:site
import { readFileSync } from "node:fs";
import { DICT, LANGS, OTHER, isLang, pickLang, splitPath } from "../portfolio/src/lib/i18n";
import { buildNav, READY } from "../portfolio/src/lib/nav";
import { hrefOf, pathOf } from "../portfolio/src/lib/paths";
import { plain, safeBody, shiftHeadings } from "../portfolio/src/lib/html";
import { SITE_DEFAULTS, sortPages } from "../portfolio/src/lib/data";
import { middleware } from "../portfolio/src/middleware";
import { renderNote } from "@/lib/portfolio/publish/render";
import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ——— the site's copies are the OS's files, byte for byte ———
ok("sanitize.ts copy is identical", read("portfolio/src/lib/sanitize.ts") === read("src/lib/portfolio/publish/sanitize.ts"));
ok("contact-validate.ts copy is identical", read("portfolio/src/lib/contact-validate.ts") === read("src/lib/portfolio/contact-validate.ts"));
ok("sign.ts copy is identical", read("portfolio/src/lib/sign.ts") === read("src/lib/portfolio/sign.ts"));

// ——— languages ———
ok("langs", LANGS.join() === "en,es" && isLang("es") && !isLang("fr") && OTHER.en === "es" && OTHER.es === "en");
ok("dictionaries have the same keys", JSON.stringify(Object.keys(DICT.en).sort()) === JSON.stringify(Object.keys(DICT.es).sort()) && JSON.stringify(Object.keys(DICT.en.nav)) === JSON.stringify(Object.keys(DICT.es.nav)) && JSON.stringify(Object.keys(DICT.en.status)) === JSON.stringify(Object.keys(DICT.es.status)));
ok("years", DICT.en.years(2024, null) === "2024 – now" && DICT.es.years(2024, null) === "2024 – hoy" && DICT.en.years(2023, 2024) === "2023 – 2024" && DICT.en.years(2024, 2024) === "2024" && DICT.en.years(undefined) === "");
ok("read time", DICT.en.readMin(3) === "3 min read" && DICT.es.readMin(3) === "3 min de lectura");
ok("pickLang: cookie wins", pickLang("es", "en-US,en;q=0.9") === "es");
ok("pickLang: browser language", pickLang(undefined, "es-MX,es;q=0.9,en;q=0.8") === "es" && pickLang(undefined, "fr-FR,en;q=0.5") === "en" && pickLang(undefined, "fr-FR") === "en" && pickLang(undefined, null, "es") === "es");
ok("pickLang: junk cookie ignored", pickLang("zz", "es") === "es");
ok("splitPath", splitPath("/en")?.rest === "/" && splitPath("/es/projects/os")?.rest === "/projects/os" && splitPath("/about") === null && splitPath("/english") === null && splitPath("/") === null);

// ——— middleware ———
const mw = (path: string, headers: Record<string, string> = {}) => middleware(new NextRequest(`https://site.test${path}`, { headers }));
{
  const r = mw("/", { "accept-language": "es-MX,es;q=0.9" });
  ok("/ → /es by browser language", r.status === 307 && new URL(r.headers.get("location")!).pathname === "/es");
  const r2 = mw("/about?x=1", { cookie: "lang=en", "accept-language": "es" });
  ok("/about → /en/about keeps the query, cookie beats browser", r2.status === 307 && r2.headers.get("location") === "https://site.test/en/about?x=1");
  const r3 = mw("/es/projects");
  ok("paths with a language pass and remember it", r3.status === 200 && /lang=es/.test(r3.headers.get("set-cookie") ?? ""));
  const r4 = mw("/en", { cookie: "lang=en" });
  ok("no cookie rewrite when unchanged", !r4.headers.get("set-cookie"));
}

// ——— addresses ———
ok("paths", pathOf("home", "x") === "" && pathOf("about", "x") === "/about" && pathOf("project", "os") === "/projects/os" && pathOf("article", "hi") === "/writing/hi" && pathOf("now", "x") === "/now" && pathOf("uses", "x") === "/uses");
ok("hrefs", hrefOf("en", "home", "home") === "/en" && hrefOf("es", "project", "os") === "/es/projects/os");

// ——— menu ———
{
  const live = [{ kind: "about" as const }, { kind: "project" as const }, { kind: "now" as const }];
  const nav = buildNav("en", SITE_DEFAULTS, live);
  ok("menu: only sections that exist and are built", nav.map((n) => n.key).join() === "home,about,projects,now,contact", nav.map((n) => n.key).join());
  ok("menu: spanish labels and language in links", buildNav("es", SITE_DEFAULTS, live)[1].label === "Sobre mí" && buildNav("es", SITE_DEFAULTS, live)[1].href === "/es/about");
  ok("menu: nothing published → Home and Contact", buildNav("en", SITE_DEFAULTS, []).map((n) => n.key).join() === "home,contact");
  ok("menu: contact can be switched off", !buildNav("en", { ...SITE_DEFAULTS, contact_enabled: false }, []).some((n) => n.key === "contact"));
  const custom = buildNav("en", { ...SITE_DEFAULTS, nav: [{ kind: "projects", label: { en: "Work" } }, { kind: "about", label: {} }] }, live);
  ok("menu: custom order and label", custom.map((n) => `${n.key}:${n.label}`).join() === "projects:Work,about:About");
  ok("menu: sections not built yet never show", !buildNav("en", SITE_DEFAULTS, [{ kind: "article" as const }]).some((n) => n.key === "writing") || READY.writing);
}

// ——— ordering ———
{
  const p = (id: string, featured: boolean, position: number, at: string | null = null) => ({ id, featured, position, published_at: at });
  ok("projects: featured first, then position", sortPages([p("a", false, 1), p("b", true, 3), p("c", true, 2), p("d", false, 0)], "project").map((x) => x.id).join() === "c,b,d,a");
  ok("articles: newest first", sortPages([p("a", false, 0, "2026-01-01"), p("b", false, 0, "2026-03-01"), p("c", false, 0, null)], "article").map((x) => x.id).join() === "b,a,c");
}

// ——— headings and text ———
ok("headings shift down one level", shiftHeadings('<h1 id="a">A</h1><h2>B</h2><h5>C</h5><h6>D</h6>') === '<h2 id="a">A</h2><h3>B</h3><h6>C</h6><h6>D</h6>', shiftHeadings('<h1 id="a">A</h1><h2>B</h2><h5>C</h5><h6>D</h6>'));
ok("plain shortens at a word", plain("one two three four five six", 14) === "one two three…" && plain("short") === "short" && plain("  a \n b ") === "a b");

// ——— OS render → site display: one pipeline ———
{
  const r = renderNote('# Hello\n\n## Part\n\nText with [site](https://example.com) and <script>alert(1)</script>.\n\n<callout icon="💡">\n\nTip\n\n</callout>', { lang: "en" });
  const shown = safeBody(r.html);
  ok("body: headings moved, callout kept", shown.includes('<h2 id="hello">') && shown.includes("<h3") && shown.includes("n-callout"));
  ok("body: script text is inert", !/<script/i.test(shown));
  const evil = safeBody('<p onmouseover="x()">a</p><a href="javascript:alert(1)">b</a><iframe src="https://evil.test"></iframe><img src=x onerror=alert(1)>');
  ok("body: hostile HTML from a bad row is cleaned again at display", !/onmouseover|javascript:|<iframe|onerror/i.test(evil), evil);
}

console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
