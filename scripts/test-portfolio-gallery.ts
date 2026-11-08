// Portfolio add-on, Phase 8: gallery (3+ pictures in a row become a grid on the public page). Nothing is sent.
// Run: npm run test:portfolio-gallery
import { readFileSync } from "node:fs";
import { GALLERY_MIN, groupGalleries, renderNote } from "@/lib/portfolio/publish/render";

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
const img = (n: number, alt = `Photo ${n}`) => `![${alt}](/api/files/pic${n}.png)`;
const galleries = (html: string) => html.match(/<div class="n-gallery">/g)?.length ?? 0;
const figures = (html: string) => html.match(/<figure class="n-figure/g)?.length ?? 0;

ok("threshold is 3", GALLERY_MIN === 3);

{
  const r = renderNote(`# Project\n\n${img(1)}\n\n${img(2)}\n\n${img(3)}\n\nThe end.`);
  ok("three pictures in a row → one gallery with three figures", galleries(r.html) === 1 && figures(r.html) === 3, r.html);
  ok("the gallery survives the sanitizer (class is kept)", r.html.includes('<div class="n-gallery">'));
  ok("heading and text around it are untouched", r.html.includes("<h1") && r.html.includes("The end."));
  ok("order is kept", r.html.indexOf("pic1") < r.html.indexOf("pic2") && r.html.indexOf("pic2") < r.html.indexOf("pic3"));
  ok("the three files are still collected for publishing", r.media.length === 3);
}
{
  const r = renderNote(`${img(1)}\n\n${img(2)}`);
  ok("two pictures stay as they are", galleries(r.html) === 0 && figures(r.html) === 2);
}
{
  const r = renderNote(`${img(1)}\n\n${img(2)}\n\nA sentence in between.\n\n${img(3)}\n\n${img(4)}`);
  ok("text between pictures breaks the row (2 + 2 → no gallery)", galleries(r.html) === 0 && figures(r.html) === 4);
}
{
  const r = renderNote(`${img(1)}\n\n${img(2)}\n\n${img(3)}\n\nText.\n\n${img(4)}\n\n${img(5)}\n\n${img(6)}\n\n${img(7)}`);
  ok("two separate rows → two galleries", galleries(r.html) === 2 && figures(r.html) === 7);
}
{
  const r = renderNote(`${img(1, "A")}\n${img(2, "B")}\n${img(3, "C")}`);
  ok("pictures on consecutive lines (no blank line) also group", galleries(r.html) === 1 && figures(r.html) === 3, r.html);
  ok("alt text is kept as the caption", r.html.includes("<figcaption>A</figcaption>") && r.html.includes("<figcaption>C</figcaption>"));
}
{
  const bad = renderNote(`${img(1)}\n\n![x](javascript:alert(1))\n\n${img(2)}\n\n${img(3)}`);
  ok("a picture that was removed does not leave a hole: the other three still form a gallery", galleries(bad.html) === 1 && figures(bad.html) === 3 && !bad.html.includes("javascript"), bad.html);
  ok("…and the owner is still warned about the removed one", bad.warnings.length > 0);
}
{
  const r = renderNote(`<columns>\n<column>\n${img(1)}\n\n${img(2)}\n\n${img(3)}\n</column>\n<column>\nSide text\n</column>\n</columns>`);
  ok("pictures inside a column also group", galleries(r.html) === 1, r.html);
}
{
  const r = renderNote(`- item\n\n${img(1)}\n\n${img(2)}\n\n${img(3)}\n\n> quote`);
  ok("lists and quotes next to a gallery are fine", galleries(r.html) === 1 && r.html.includes("<li>") && r.html.includes("<blockquote"));
}
{
  const blocks = ['<p>a</p>', '<figure class="n-figure"><img></figure>', '', '<figure class="n-figure n-align-center"><img></figure>', '<figure class="n-figure"><img></figure>'];
  const g = groupGalleries(blocks);
  ok("groupGalleries: empty entries are ignored and aligned figures count", g.length === 2 && g[1].startsWith('<div class="n-gallery">'), JSON.stringify(g));
  ok("groupGalleries: video embeds are not pictures", groupGalleries(['<figure class="n-embed"></figure>', '<figure class="n-embed"></figure>', '<figure class="n-embed"></figure>']).every((x) => !x.includes("n-gallery")));
  ok("groupGalleries: no pictures → input unchanged", JSON.stringify(groupGalleries(["<p>a</p>", "<p>b</p>"])) === JSON.stringify(["<p>a</p>", "<p>b</p>"]));
}
{
  const css = read("portfolio/src/app/globals.css");
  ok("site CSS styles the gallery (grid, responsive, no fixed width)", /\.n-gallery\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%/.test(css));
  ok("preview in the OS styles it too", read("src/components/portfolio/PublishPanel.tsx").includes(".pf-preview .n-gallery"));
  ok("no new scripts needed: the gallery is CSS only", !/lightbox|onclick/i.test(css.split("Gallery:")[1] ?? ""));
}

console.log(`\nportfolio-gallery: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
