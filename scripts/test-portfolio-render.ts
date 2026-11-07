// Portfolio add-on, Phase 2: sanitizer + renderer (Markdown of a note → public HTML). No database, nothing is sent.
// Run: npm run test:render
import { sanitizeHtml, safeUrl, htmlToText } from "@/lib/portfolio/publish/sanitize";
import { renderNote, type RenderCtx } from "@/lib/portfolio/publish/render";
import { hasErrors, needsConfirm, Warnings, type Warning } from "@/lib/portfolio/publish/warnings";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const S = (h: string) => sanitizeHtml(h).html;
const has = (h: string, s: string) => h.includes(s);
const code = (r: { warnings: Warning[] }, c: string) => r.warnings.find((w) => w.code === c);

// ——— sanitizer ———
ok("san: script removed with content", S("<p>a</p><script>alert(1)</script>") === "<p>a</p>");
ok("san: onclick removed", !has(S('<p onclick="x()">a</p>'), "onclick"));
ok("san: javascript: href removed", !has(S('<a href="javascript:alert(1)">x</a>'), "javascript"));
ok("san: entity-obfuscated javascript:", !has(S('<a href="jav&#x61;script:alert(1)">x</a>'), "script"));
ok("san: tab/newline in scheme", !has(S('<a href="java\tscript:alert(1)">x</a>'), "script"));
ok("san: data: image removed", !has(S('<img src="data:image/svg+xml;base64,AAA">'), "data:"));
ok("san: svg dropped", S("<svg><script>x</script></svg>ok") === "ok");
ok("san: iframe not youtube removed", !has(S('<iframe src="https://evil.com/x"></iframe>'), "iframe"));
ok("san: iframe youtube kept", has(S('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'), "<iframe"));
ok("san: style expression removed", !has(S('<p style="background:url(javascript:x)">a</p>'), "style"));
ok("san: numeric style kept", has(S('<span style="height:0.5em">a</span>'), "height:0.5em"));
ok("san: link gets rel", has(S('<a href="https://x.com">a</a>'), 'rel="noopener noreferrer"'));
ok("san: unbalanced tags closed", S("<p><strong>a") === "<p><strong>a</strong></p>");
ok("san: stray < escaped", has(S("<p>1 < 2</p>"), "1 &lt; 2"));
ok("san: form/button dropped", S("<button>x</button><form>y</form>z") === "z");
ok("san: safeUrl", safeUrl("https://a.com") !== null && safeUrl("JaVaScRiPt:1") === null && safeUrl("//evil.com") === null && safeUrl("mailto:a@b.c") !== null && safeUrl("vbscript:x") === null);
ok("san: htmlToText", htmlToText("<p>Hi <b>there</b></p><p>You</p>") === "Hi there\nYou");

// ——— renderer: basics ———
const ctx: RenderCtx = {
  lang: "en",
  noteLink: (id) => (id === "11111111-1111-1111-1111-111111111111" ? "/projects/os" : null),
  osHosts: ["os.example.com"],
};
let r = renderNote("# Title\n\nHello **bold** and *it* and `code` and [site](https://example.com).\n\n## Second {color=\"red\"}\n\n- a\n- b\n\n1. x\n2. y\n\n> quote\n\n---\n", ctx);
ok("r: heading + id", has(r.html, '<h1 id="title">Title</h1>'));
ok("r: toc", r.toc.length === 2 && r.toc[1].id === "second" && r.toc[1].level === 2);
ok("r: heading color class", has(r.html, '<h2 id="second" class="n-color-red">'));
ok("r: bold/italic/code", has(r.html, "<strong>bold</strong>") && has(r.html, "<em>it</em>") && has(r.html, "<code>code</code>"));
ok("r: external link rel", has(r.html, 'href="https://example.com"') && has(r.html, "noopener"));
ok("r: lists, quote, hr", has(r.html, "<ul>") && has(r.html, "<ol>") && has(r.html, "<blockquote>") && has(r.html, "<hr>"));
ok("r: no warnings on clean note", r.warnings.length === 0, JSON.stringify(r.warnings));

r = renderNote("# A\n\n## Same\n\n## Same\n\n## Café ñandú", ctx);
ok("r: unique heading ids", r.toc.map((t) => t.id).join() === "a,same,same-2,cafe-nandu", r.toc.map((t) => t.id).join());

// ——— block tags ———
r = renderNote('<callout icon="💡" color="gray_bg">\n\nTip with **bold**\n\n</callout>\n\nafter', ctx);
ok("callout", has(r.html, '<aside class="n-callout n-color-gray_bg">') && has(r.html, "💡") && has(r.html, "<strong>bold</strong>") && has(r.html, "<p>after</p>"), r.html);

r = renderNote('<callout icon="🔒" color="red_bg">\n\nPrivate stuff\n\n</callout>\n\nvisible', ctx);
ok("callout 🔒 icon removed", !has(r.html, "Private") && has(r.html, "visible") && code(r, "locked_removed")?.count === 1 && code(r, "locked_removed")?.level === "info");
r = renderNote('<callout icon="💡">\n\n🔒 Only for me\n\n</callout>', ctx);
ok("callout 🔒 first text removed", !has(r.html, "Only for me") && code(r, "locked_removed")?.count === 1);

r = renderNote('<details>\n<summary>More **info**</summary>\n\nHidden body\n\n</details>', ctx);
ok("toggle", has(r.html, "<details") && has(r.html, "<summary>More <strong>info</strong></summary>") && has(r.html, "Hidden body"), r.html);
r = renderNote('<details>\n<summary>🔒 Secret</summary>\n\nno\n\n</details>\n\nok', ctx);
ok("toggle 🔒 removed", !has(r.html, "Secret") && !has(r.html, "no</p>") && code(r, "locked_removed")?.count === 1);
r = renderNote('<details open="true">\n<summary>T</summary>\n\nb\n\n</details>', ctx);
ok("toggle open", has(r.html, "<details class=\"n-toggle\" open>") || (has(r.html, "<details") && has(r.html, " open")), r.html);

r = renderNote('<columns>\n<column width="0.4">\n\nLeft\n\n</column>\n<column width="0.6">\n\nRight\n\n</column>\n</columns>', ctx);
ok("columns", has(r.html, 'class="n-columns"') && has(r.html, "width:40.00%") && has(r.html, "width:60.00%") && has(r.html, "Left") && has(r.html, "Right"), r.html);
r = renderNote("<columns>\n<column>\n\nA\n\n</column>\n<column>\n\nB\n\n</column>\n</columns>", ctx);
ok("columns equal", has(r.html, "width:50.00%"));

r = renderNote('<button label="Do it">\n\ninside\n\n</button>\n\nhi', ctx);
ok("button removed + warning", !has(r.html, "inside") && has(r.html, "hi") && code(r, "button")?.level === "warning");
r = renderNote("<table_of_contents/>\n\n# H", ctx);
ok("toc block", r.hasToc && !has(r.html, "table_of_contents"));
r = renderNote('<page url="/notes/22222222-2222-2222-2222-222222222222">Sub page</page>', ctx);
ok("subpage removed", !has(r.html, "Sub page") && code(r, "subpage")?.count === 1);
r = renderNote('<page url="/notes/11111111-1111-1111-1111-111111111111">Public one</page>', ctx);
ok("page link to published note", has(r.html, '<a href="/projects/os" rel="noopener">Public one</a>'));
r = renderNote('<audio src="/api/files/u/2026-10/a-x.mp3">cap</audio>', ctx);
ok("audio unsupported", code(r, "unsupported_block")?.count === 1);
r = renderNote("<empty-block/>\n\ntext\n\n<!-- hi -->", ctx);
ok("empty-block + comment silent", r.warnings.length === 0 && has(r.html, "text"), JSON.stringify(r.warnings));

// ——— links ———
r = renderNote("[pub](/notes/11111111-1111-1111-1111-111111111111) [priv](/notes/22222222-2222-2222-2222-222222222222) [abs](https://os.example.com/notes/33333333-3333-3333-3333-333333333333)", ctx);
ok("link public note", has(r.html, 'href="/projects/os"'));
ok("link private note → text", !has(r.html, "22222222") && has(r.html, "priv") && code(r, "private_link")?.count === 2, JSON.stringify(r.warnings));
r = renderNote("[tasks](/tasks) [os](https://os.example.com/x) [bad](javascript:alert(1)) [mail](mailto:a@b.co)", ctx);
ok("os links removed", !has(r.html, "/tasks") && !has(r.html, "os.example.com") && code(r, "os_link")?.count === 2, JSON.stringify(r.warnings));
ok("bad link text only", !has(r.html, "javascript") && code(r, "bad_link")?.count === 1 && has(r.html, "mailto:a@b.co"));
r = renderNote('<mention-page url="/notes/11111111-1111-1111-1111-111111111111">Public</mention-page> and <mention-page url="/notes/22222222-2222-2222-2222-222222222222">Priv</mention-page>', ctx);
ok("mention-page", has(r.html, '<a href="/projects/os" rel="noopener">Public</a>') && has(r.html, "Priv") && !has(r.html, "22222222") && code(r, "private_link")?.count === 1);
r = renderNote('Due <mention-date start="2026-10-28"/> to <mention-date start="2026-11-01" end="2026-11-03"/>', { ...ctx, lang: "es" });
ok("mention-date es", has(r.html, '<time datetime="2026-10-28">') && /octubre/.test(r.html) && /noviembre/.test(r.html), r.html);

// ——— images & media ———
r = renderNote('![A cat](/api/files/u1/2026-10/ab12cd34-cat.png) {width="480" align="center"}\n\ntext', ctx);
ok("image collected (pass 1)", r.media.length === 1 && r.media[0].src === "/api/files/u1/2026-10/ab12cd34-cat.png" && r.media[0].kind === "image");
r = renderNote('![A cat](/api/files/u1/2026-10/ab12cd34-cat.png) {width="480" align="center"}\n\ntext', { ...ctx, media: (s) => (s.endsWith("cat.png") ? "https://cdn.test/portfolio-media/x/hash-cat.png" : null) });
ok("image mapped (pass 2)", has(r.html, 'src="https://cdn.test/portfolio-media/x/hash-cat.png"') && has(r.html, 'width="480"') && has(r.html, "n-align-center") && has(r.html, "<figcaption>A cat</figcaption>") && !has(r.html, "/api/files"), r.html);
r = renderNote("![x](/api/files/u1/f.png)", { ...ctx, media: () => null });
ok("image missing → media_failed error", code(r, "media_failed")?.level === "error" && !has(r.html, "<img"));
r = renderNote("![x](blob:https://os.example.com/abc)", ctx);
ok("blob image → error", code(r, "blob_upload")?.level === "error" && hasErrors(r.warnings) && !has(r.html, "blob:"));
r = renderNote("![x](data:image/png;base64,AAAA)", ctx);
ok("data image removed", code(r, "data_url") !== undefined && !has(r.html, "data:"));
r = renderNote("![x](https://other.com/p.png)", ctx);
ok("external image kept + warning", has(r.html, "https://other.com/p.png") && code(r, "external_image")?.count === 1);
r = renderNote("Inline ![i](/api/files/u1/i.png) here", ctx);
ok("inline image collected", r.media.length === 1 && has(r.html, "<p>Inline "));
r = renderNote('<file src="/api/files/u1/2026-10/ab12cd34-report.pdf" name="Report.pdf" size="2097152">cap</file>\n\n<pdf src="/api/files/u1/2026-10/zz-doc.pdf" height="600">Doc</pdf>', { ...ctx, media: (s) => "https://cdn.test/" + s.split("/").pop() });
ok("file + pdf links", has(r.html, 'ab12cd34-report.pdf" download') && has(r.html, "n-pdf") && r.media.length === 2, r.html);
r = renderNote('<video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ">My talk</video>\n\n<embed src="https://youtu.be/dQw4w9WgXcQ"/>', ctx);
ok("youtube embeds", (r.html.match(/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/g) ?? []).length === 2 && has(r.html, "<figcaption>My talk</figcaption>") && r.warnings.length === 0, r.html);
r = renderNote('<video src="/api/files/u1/v.mp4"></video>', ctx);
ok("uploaded video → error", code(r, "video_file")?.level === "error");
r = renderNote('<embed src="https://evil.com/frame" height="300"/>', ctx);
ok("embed outside allowlist removed", !has(r.html, "evil.com") && code(r, "iframe_blocked")?.count === 1);
r = renderNote('<bookmark url="https://example.com/a" title="Example" description="Desc &amp; more" image="https://example.com/i.png"/>', ctx);
ok("bookmark card", has(r.html, 'class="n-bookmark"') && has(r.html, "<strong>Example</strong>") && has(r.html, "Desc &amp; more") && has(r.html, "example.com"), r.html);
r = renderNote('<bookmark url="javascript:alert(1)" title="x"/>', ctx);
ok("bookmark bad url removed", !has(r.html, "javascript") && code(r, "bad_link") !== undefined);

// ——— code, math, tables, to-dos ———
r = renderNote("```ts\nconst a: number = 1 < 2;\n```\n\n```\nplain <b>\n```\n\n```unknownlang\nx\n```", ctx);
ok("code highlighted", has(r.html, 'class="hljs language-ts"') && has(r.html, "hljs-keyword") && has(r.html, "&lt;"), r.html);
ok("code plain escaped", has(r.html, "plain &lt;b&gt;") && !has(r.html, "<b>"));
r = renderNote("Inline $x^2 + y$ and price $5 and $10 ok.\n\n$$\n\\frac{a}{b}\n$$\n\n$$E=mc^2$$", ctx);
ok("math inline + block", has(r.html, 'class="katex"') && has(r.html, 'class="n-math"') && (r.html.match(/class="n-math"/g) ?? []).length === 2, r.html.slice(0, 300));
ok("price dollars not math", has(r.html, "$5 and $10"));
ok("math keeps katex spans/styles", has(r.html, "mfrac") && has(r.html, "style="));
r = renderNote("bad $\\notacommand{$ here\n\n$$\n\\frac{\n$$", ctx);
ok("math error → warning", code(r, "math_error")?.level === "warning");
r = renderNote("Code `$not math$` stays", ctx);
ok("inline code protects $", has(r.html, "<code>$not math$</code>") && !has(r.html, "katex"));
r = renderNote("| a | b |\n|---|---|\n| 1 | 2 |\n", ctx);
ok("table wrapped", has(r.html, '<div class="n-table"><table>') && has(r.html, "<th>a</th>"));
r = renderNote("- [ ] open\n- [x] done\n- [ ] open 2\n", ctx);
ok("to-do list + warning", code(r, "unchecked_todo")?.count === 2 && has(r.html, "☑") && has(r.html, "☐") && !has(r.html, "<input"), r.html);
r = renderNote("- [x] a\n- [x] b", ctx);
ok("all done → no warning", !code(r, "unchecked_todo"));

// ——— inline color / underline / raw html ———
r = renderNote('A <span color="red">red</span> and <span color="blue_bg">**blue**</span> and <u>under</u>.\n\nPlain para {color="green"}', ctx);
ok("inline colors + underline", has(r.html, '<span class="n-color-red">red</span>') && has(r.html, 'class="n-color-blue_bg"') && has(r.html, "<u>under</u>") && has(r.html, '<p class="n-color-green">Plain para</p>'), r.html);
r = renderNote('Hi <script>alert(1)</script> <b onclick="x">b</b> <iframe src="https://evil.com"></iframe>', ctx);
ok("raw html shown as text", !has(r.html, "<script") && !has(r.html, "<iframe") && !/<b[^>]*onclick/.test(r.html) && code(r, "raw_html") !== undefined);
r = renderNote("line one<br>line two", ctx);
ok("<br> allowed", has(r.html, "line one<br>line two") && !code(r, "raw_html"));

// ——— robustness ———
r = renderNote("ab 0 red", ctx);
ok("private-use chars in source are neutralised", !/[-]/.test(r.html));
r = renderNote("", ctx);
ok("empty note renders empty", r.html === "" && r.warnings.length === 0);
const deep = Array.from({ length: 9 }, () => '<callout icon="💡">\n\n').join("") + "core" + Array.from({ length: 9 }, () => "\n\n</callout>").join("");
r = renderNote(deep, ctx);
ok("deep nesting flattened with warning", code(r, "nesting_limit") !== undefined);
r = renderNote("```\n<callout>x</callout>\n```", ctx);
ok("tags inside code fences stay code", has(r.html, "&lt;callout&gt;") && !has(r.html, "n-callout"));
r = renderNote("a\r\nb\r\n\r\n# H\r\n", ctx);
ok("CRLF", has(r.html, "<h1") && !has(r.html, "\r"));

// ——— warnings helper ———
const w = new Warnings();
w.add("button", "x");
w.add("button", "y");
w.add("blob_upload");
w.add("locked_removed");
const list = w.list();
ok("warnings sorted error→warning→info", list.map((x) => x.level).join() === "error,warning,info" && list[1].count === 2 && list[1].detail?.length === 2);
ok("warnings helpers", hasErrors(list) && needsConfirm(list) && !hasErrors([]) && !needsConfirm([list[2]]));

console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
