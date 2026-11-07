// Public site, Phase 7: analytics switch, social-card helpers, contrast of the colour tokens (WCAG AA), lazy images,
// language-aware 404 plumbing, reduced motion, touch targets. No network. Run: npm run test:portfolio-polish
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { analyticsOn, ANALYTICS_SRC } from "../portfolio/src/lib/analytics";
import { fitTitle, isOgKind, ogPath, SLUG } from "../portfolio/src/lib/og";
import { lazyImages, safeBody } from "../portfolio/src/lib/html";
import { middleware } from "../portfolio/src/middleware";
import { DICT } from "../portfolio/src/lib/i18n";

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

// ——— analytics ———
ok("analytics: on only in production and when the owner has it on", analyticsOn({ analytics_enabled: true }, { VERCEL_ENV: "production" }) && !analyticsOn({ analytics_enabled: false }, { VERCEL_ENV: "production" }) && !analyticsOn({ analytics_enabled: true }, { VERCEL_ENV: "preview" }) && !analyticsOn({ analytics_enabled: true }, {}));
ok("analytics: same-origin script, so the strict policy needs no change", ANALYTICS_SRC.startsWith("/_vercel/") && /script-src 'self'/.test(read("portfolio/next.config.ts")));
ok("analytics: the layout reads the switch", /analyticsOn\(site\)/.test(read("portfolio/src/app/[lang]/layout.tsx")));

// ——— social cards ———
{
  ok("og: kinds", ["site", "home", "project", "article"].every(isOgKind) && !isOgKind("evil") && !isOgKind(""));
  ok("og: path built from kind and slug only", ogPath("en", "project", "my-os") === "/en/og/project/my-os" && ogPath("es", "site", "whatever") === "/es/og/site/site");
  ok("og: a strange slug never reaches the path", ogPath("en", "project", "../../x") === "/en/og/project/project" && ogPath("en", "article", "A B") === "/en/og/article/article");
  ok("og: slug pattern", SLUG.test("a-b-1") && !SLUG.test("-a") && !SLUG.test("A") && !SLUG.test("a/b") && !SLUG.test(""));
  const short = fitTitle("Personal OS");
  const long = fitTitle("A very long title ".repeat(10));
  ok("og: title fits the card", short.size === 84 && long.text.length <= 90 && long.text.endsWith("…") && long.size === 54 && fitTitle("x".repeat(40)).size === 68);
  ok("og: whitespace tidied", fitTitle("  a \n b  ").text === "a b");
  const route = read("portfolio/src/app/[lang]/og/[kind]/[slug]/route.tsx");
  ok("og: text comes from the database, never from the address", !/searchParams|nextUrl|new URL\(req/.test(route) && /getPage\(/.test(route));
}

// ——— lazy images ———
{
  ok("images: lazy + async added", lazyImages('<p><img src="https://a/b.jpg" alt="x"></p>') === '<p><img loading="lazy" decoding="async" src="https://a/b.jpg" alt="x"></p>');
  ok("images: existing loading attribute kept, no duplicates", lazyImages('<img loading="eager" src="a">') === '<img loading="eager" src="a">' && (lazyImages('<img src="a" />').match(/loading=/g) ?? []).length === 1);
  ok("images: still sanitized first", !safeBody('<img src="x" onerror="alert(1)">').includes("onerror") && safeBody('<img src="https://a/b.jpg" alt="">').includes('loading="lazy"'));
}

// ——— contrast (WCAG AA: 4.5 for text, 3 for large text and borders) ———
{
  const css = read("portfolio/src/app/globals.css");
  const root = /:root\s*\{([^}]*)\}/.exec(css)![1];
  const tok = (n: string) => new RegExp(`--${n}:\\s*([^;]+);`).exec(root)![1].trim();
  const rgb = (c: string): [number, number, number] => {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
    const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)!;
    return [Number(r[1]), Number(r[2]), Number(r[3])];
  };
  const lum = ([r, g, b]: [number, number, number]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string | [number, number, number], b: string | [number, number, number]) => {
    const [x, y] = [lum(typeof a === "string" ? rgb(a) : a), lum(typeof b === "string" ? rgb(b) : b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const blend = (fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as [number, number, number];
  const paper = tok("paper");
  const pairs: [string, string | [number, number, number], string | [number, number, number], number][] = [
    ["body text (ink) on paper", tok("ink"), paper, 7],
    ["muted text (ink2) on paper", tok("ink2"), paper, 4.5],
    ["links and headings (acc) on paper", tok("acc"), paper, 4.5],
    ["status stamp and errors (stamp) on paper", tok("stamp"), paper, 4.5],
    ["button text on yellow", tok("ink"), tok("hl"), 7],
    ["sidebar text on board", tok("st"), tok("board"), 7],
    ["sidebar muted text on board", tok("stm"), tok("board"), 4.5],
    ["selected menu item (dark on yellow)", "#1b2a26", tok("yellow"), 7],
    ["links in the Now card (yellow on board)", tok("yellow"), tok("board"), 4.5],
    ["chip text on chip background", tok("acc"), blend(rgb("#2b4f9e"), 0.12, rgb(paper)), 4.5],
    ["inline code on its background", tok("ink"), blend(rgb("#1b2a26"), 0.08, rgb(paper)), 7],
    ["callout text on its background", tok("ink"), blend(rgb("#1b2a26"), 0.06, rgb(paper)), 7],
    ["muted text on a callout", tok("ink2"), blend(rgb("#1b2a26"), 0.06, rgb(paper)), 4.5],
    ["focus ring on paper (ink)", tok("ink"), paper, 3],
    ["focus ring in the sidebar (yellow on board)", tok("yellow"), tok("board"), 3],
  ];
  for (const [name, fg, bg, min] of pairs) {
    const r = ratio(fg, bg);
    ok(`contrast: ${name} ≥ ${min}`, r >= min, r.toFixed(2));
  }
}

// ——— keyboard, motion, touch, language ———
{
  const css = read("portfolio/src/app/globals.css");
  ok("a11y: reduced motion turns off the pulse and smooth scrolling", /prefers-reduced-motion: reduce[\s\S]*\.dot \{ animation: none/.test(css) && /scroll-behavior: auto/.test(css));
  ok("a11y: visible focus everywhere, dark inside the notebook", /:focus-visible \{ outline: 3px solid/.test(css) && /\.page :focus-visible[^}]*outline-color: var\(--ink\)/.test(css));
  ok("a11y: 44px touch targets on phones", /min-height: 44px/.test(css));
  const shell = read("portfolio/src/components/Shell.tsx");
  ok("a11y: skip link, labelled navigation, current page marked, language switch labelled", /className="skip"/.test(shell) && /aria-label="Main"/.test(shell) && /aria-current=\{n\.key === current/.test(shell) && /hrefLang=/.test(shell));
  ok("a11y: the page language is set on <html>", /<html lang=\{lang\}/.test(read("portfolio/src/app/[lang]/layout.tsx")));
  ok("a11y: video button has a label and the player a title", /aria-label=\{playLabel\}/.test(read("portfolio/src/components/VideoEmbed.tsx")) && /title=\{title\}/.test(read("portfolio/src/components/VideoEmbed.tsx")));
  ok("a11y: every form field has a label", ["ContactForm", "Shell"].every((f) => /<label/.test(read(`portfolio/src/components/${f}.tsx`))) && /<label/.test(read("portfolio/src/app/[lang]/search/page.tsx")));
}

// ——— 404 in the visitor's language ———
{
  const res = middleware(new NextRequest("https://site.test/es/nada"));
  ok("404: the middleware passes the language on", res.headers.get("x-middleware-request-x-lang") === "es" || (res.headers.get("x-middleware-override-headers") ?? "").includes("x-lang"), [...res.headers.keys()].join());
  ok("404: language pages have their own not-found page", /x-lang/.test(read("portfolio/src/app/[lang]/not-found.tsx")));
  ok("404: texts in both languages", !!DICT.en.notFoundTitle && !!DICT.es.notFoundTitle && DICT.es.notFoundText !== DICT.en.notFoundText);
}

// ——— copy review: the two dictionaries have the same shape and no placeholder text ———
{
  const shape = (o: unknown, path = ""): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => shape(v, `${path}.${k}`)) : [path + ":" + typeof o]);
  ok("copy: English and Spanish have exactly the same keys", shape(DICT.en).join("|") === shape(DICT.es).join("|"));
  const strings = (o: unknown): string[] => (typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : []);
  ok("copy: no empty strings, TODO or lorem", [...strings(DICT.en), ...strings(DICT.es)].every((s) => s.trim() !== "" && !/\bTODO\b|lorem ipsum|xxx/.test(s)), [...strings(DICT.en), ...strings(DICT.es)].filter((s) => s.trim() === "" || /\bTODO\b|lorem ipsum|xxx/.test(s)).join("|"));
  ok("copy: Spanish has no English leftovers in the menu", !/Uses|Writing|Contact\b|About/.test(Object.values(DICT.es.nav).join(" ")));
  ok("copy: Spanish uses ¿ ¡ pairs", ![DICT.es.contact.intro].some((s) => (s.match(/¿/g) ?? []).length !== (s.match(/\?/g) ?? []).length));
}

console.log(`${fail ? "❌" : "✅"} portfolio polish: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
