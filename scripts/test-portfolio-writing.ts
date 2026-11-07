// Portfolio add-on, Phase 4: starter templates, RSS, search helpers, dates, article order, menu, JSON-LD safety.
// No database, nothing is sent. Run: npm run test:portfolio-writing
import { starterFor } from "@/lib/portfolio/templates";
import { KINDS, LANGS } from "@/lib/portfolio/constants";
import { renderNote } from "@/lib/portfolio/publish/render";
import { hasErrors, needsConfirm } from "@/lib/portfolio/publish/warnings";
import { createLinkedNote } from "@/lib/portfolio/link";
import { fakeDb, type Row } from "./fake-supabase";
import { buildRss, escapeXml } from "../portfolio/src/lib/rss";
import { cleanQuery, rank, score, snippet, termsOf } from "../portfolio/src/lib/search";
import { fmtDate } from "../portfolio/src/lib/dates";
import { jsonLd } from "../portfolio/src/lib/html";
import { sortPages, SITE_DEFAULTS } from "../portfolio/src/lib/data";
import { buildNav } from "../portfolio/src/lib/nav";
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

// ——— starter templates ———
for (const kind of KINDS) {
  for (const lang of LANGS) {
    const md = starterFor(kind, lang);
    const r = renderNote(md, { lang, noteLink: () => null, osHosts: [] });
    ok(`template ${kind}/${lang}: has text`, md.trim().length > 40 && r.html.trim().length > 0);
    ok(`template ${kind}/${lang}: renders with no warnings`, r.warnings.length === 0 && !hasErrors(r.warnings) && !needsConfirm(r.warnings), JSON.stringify(r.warnings));
    ok(`template ${kind}/${lang}: no private markers or raw HTML`, !/🔒|<[a-z]|\[ \]|\]\(\/notes/i.test(md));
  }
  ok(`template ${kind}: English and Spanish differ`, starterFor(kind, "en") !== starterFor(kind, "es"));
}
ok("template: article and project get section headings", /^## /m.test(starterFor("article", "en")) && /^## /m.test(starterFor("project", "es")));

// createLinkedNote fills the starter text (and keeps explicit content when given)
{
  const U = "u1";
  const tables: Record<string, Row[]> = {
    portfolio_slots: [{ id: "s1", user_id: U, kind: "article", key: "first-post", previous_keys: [], position: 1, featured: false, archived: false, meta: {}, langs: { en: {}, es: {} } }],
    notes: [],
  };
  const sb = fakeDb(tables) as never;
  const a = await createLinkedNote(sb, U, { slotId: "s1", lang: "es" });
  ok("new linked note: ok", a.ok, JSON.stringify(a));
  ok("new linked note: starter text in its language", tables.notes.length === 1 && tables.notes[0].content === starterFor("article", "es") && tables.notes[0].portfolio_lang === "es");
  const b = await createLinkedNote(sb, U, { slotId: "s1", lang: "en", content: "mine" });
  ok("new linked note: explicit content wins", b.ok && tables.notes[1].content === "mine");
}

// ——— RSS ———
{
  ok("xml: escapes", escapeXml(`a & b < c > "d" 'e'`) === "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;");
  ok("xml: invalid control characters dropped", escapeXml("a\u0000b\u000Bc\u001Fd\te\nf") === "abcd\te\nf");
  const xml = buildRss({
    title: "Max — Writing",
    description: "Notes & more",
    lang: "en",
    siteLink: "https://site.test/en/writing",
    selfLink: "https://site.test/en/rss.xml",
    items: [
      { title: "Newer <post>", link: "https://site.test/en/writing/new", pubDate: "2026-11-05T10:00:00Z", summary: "About \"things\" & stuff" },
      { title: "Older", link: "https://site.test/en/writing/old", pubDate: "2026-10-01T10:00:00Z", summary: "x" },
      { title: "No date", link: "https://site.test/en/writing/nd", pubDate: null, summary: "" },
    ],
  });
  ok("rss: header and root", xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">'));
  ok("rss: channel data escaped", xml.includes("<description>Notes &amp; more</description>") && xml.includes("<language>en</language>"));
  ok("rss: self link", xml.includes('<atom:link href="https://site.test/en/rss.xml" rel="self" type="application/rss+xml"/>'));
  ok("rss: item title/summary escaped", xml.includes("<title>Newer &lt;post&gt;</title>") && xml.includes("<description>About &quot;things&quot; &amp; stuff</description>"));
  ok("rss: pubDate in RFC 822 and lastBuildDate is the newest", xml.includes("<pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate>") && xml.includes("<lastBuildDate>Thu, 05 Nov 2026 10:00:00 GMT</lastBuildDate>"));
  ok("rss: item without date has no pubDate", xml.split("<item>").length === 4 && xml.split("<pubDate>").length === 3);
  ok("rss: guid is the link", xml.includes('<guid isPermaLink="true">https://site.test/en/writing/new</guid>'));
  ok("rss: balanced tags", ["item", "channel", "rss"].every((t) => xml.split(`<${t}`).length - 1 === xml.split(`</${t}>`).length - 1));
  const empty = buildRss({ title: "t", description: "d", lang: "es", siteLink: "https://s/es/writing", selfLink: "https://s/es/rss.xml", items: [] });
  ok("rss: empty feed is still valid and has no lastBuildDate", empty.includes("</channel>") && !empty.includes("<item>") && !empty.includes("lastBuildDate"));
}

// ——— search helpers ———
{
  ok("query: too short → empty", cleanQuery("a") === "" && cleanQuery("  ") === "" && cleanQuery(null) === "" && cleanQuery(undefined) === "");
  ok("query: special characters stripped", cleanQuery(`50%_off, (a) "b" 'c' \\ * ; :`) === "50 off a b c", cleanQuery(`50%_off, (a) "b" 'c' \\ * ; :`));
  ok("query: filter injection characters gone", !/[,()*]/.test(cleanQuery("x),title.ilike.*,or(a")), cleanQuery("x),title.ilike.*,or(a"));
  ok("query: capped at 80", cleanQuery("ab ".repeat(100)).length <= 80);
  ok("query: control characters removed", cleanQuery("hi\u0000\n there") === "hi there");
  ok("terms: distinct, lowercase, 2+ letters, max 5", termsOf("Next next a js Supabase Vercel Web Perf Extra").join() === "next,js,supabase,vercel,web");
  const text = "word ".repeat(60) + "the target phrase is here " + "other ".repeat(60);
  const sn = snippet(text, ["target"], 120);
  ok("snippet: contains the match, starts and ends with …, short", sn.includes("target") && sn.startsWith("… ") && sn.endsWith(" …") && sn.length < 140, sn);
  ok("snippet: short text returned whole", snippet("hello  world", ["x"]) === "hello world");
  ok("snippet: no match → start of text", snippet("abc ".repeat(100), ["zzz"], 40).startsWith("abc") && !snippet("abc ".repeat(100), ["zzz"], 40).startsWith("…"));
  const items = [
    { title: "Other", summary: null, text: "build build build build" },
    { title: "Build log", summary: null, text: "x" },
    { title: "Misc", summary: "how to build", text: "x" },
  ];
  ok("rank: title match first, then summary, then body", rank(items, ["build"]).map((i) => i.title).join() === "Build log,Misc,Other", rank(items, ["build"]).map((i) => i.title).join());
  ok("score: body matches are capped", score({ title: "t", summary: null, text: "a ".repeat(500) }, ["a"]) === 5);
}

// ——— dates ———
ok("date: english", fmtDate("2026-11-07T23:30:00Z", "en") === "November 7, 2026", fmtDate("2026-11-07T23:30:00Z", "en"));
ok("date: spanish", fmtDate("2026-11-07T23:30:00Z", "es") === "7 de noviembre de 2026", fmtDate("2026-11-07T23:30:00Z", "es"));
ok("date: empty / invalid", fmtDate(null, "en") === "" && fmtDate("nope", "es") === "");

// ——— article order and menu ———
{
  const rows = [
    { slot: "a", featured: true, position: 1, published_at: "2026-01-01T00:00:00Z" },
    { slot: "b", featured: false, position: 2, published_at: "2026-06-01T00:00:00Z" },
    { slot: "c", featured: false, position: 3, published_at: null },
  ];
  ok("articles: newest first, undated last, featured does not jump the queue", sortPages(rows, "article").map((r) => r.slot).join() === "b,a,c");
  ok("projects: featured first, then position", sortPages(rows, "project").map((r) => r.slot).join() === "a,b,c");
  const live = [{ kind: "about" as const }, { kind: "article" as const }, { kind: "uses" as const }, { kind: "project" as const }];
  const keys = buildNav("en", SITE_DEFAULTS, live).map((n) => n.key).join();
  ok("menu: Writing and Uses show once they have a live page", keys === "home,about,projects,writing,uses,contact", keys);
  ok("menu: spanish labels", buildNav("es", SITE_DEFAULTS, live).map((n) => n.label).join() === "Inicio,Sobre mí,Proyectos,Escritos,Herramientas,Contacto");
  ok("menu: no article → no Writing", !buildNav("en", SITE_DEFAULTS, [{ kind: "about" as const }]).some((n) => n.key === "writing"));
}

// ——— JSON-LD is safe inside a <script> ———
{
  const j = jsonLd({ headline: "</script><script>alert(1)</script>", d: "a b" });
  ok("jsonld: no raw '<' and no raw line separators", !j.includes("<") && !j.includes(" "), j);
  ok("jsonld: still valid JSON with the same text", JSON.parse(j).headline === "</script><script>alert(1)</script>");
}

// ——— texts exist in both languages ———
{
  const keys = ["noArticles", "rss", "writingIntro"] as const;
  ok("i18n: writing and search texts in both languages", keys.every((k) => !!DICT.en[k] && !!DICT.es[k]) && DICT.en.search.results(1, "x").includes("1 result ") && DICT.es.search.results(2, "x").includes("2 resultados") && DICT.es.publishedOn("7 de noviembre").startsWith("Publicado"));
}

console.log(`${fail ? "❌" : "✅"} portfolio writing: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
