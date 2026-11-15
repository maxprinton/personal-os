// Tests for md.js with a tiny fake DOM. Run: node test-md.cjs
const assert = require("node:assert/strict");
const { htmlToMd, transcriptToMd, guessKeyword, fillTitle } = require("./md.js");

const el = (tag, attrs, ...children) => {
  if (typeof attrs === "string" || (attrs && attrs.nodeType)) { children.unshift(attrs); attrs = {}; }
  const node = { nodeType: 1, nodeName: tag.toUpperCase(), childNodes: [], getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null), hasAttribute: (k) => !!attrs && k in attrs };
  for (const c of children) node.childNodes.push(typeof c === "string" ? { nodeType: 3, nodeValue: c, childNodes: [] } : c);
  return node;
};
const base = "https://www.coursera.org/learn/x/supplement/y";
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok", name); };

t("headings, paragraphs, bold, links", () => {
  const dom = el("div", el("h2", el("strong", "The project manager")), el("p", "Hello ", el("strong", "big"), " ", el("a", { href: "/learn/other" }, "world"), "."));
  assert.equal(htmlToMd(dom, base), "## The project manager\n\nHello **big** [world](https://www.coursera.org/learn/other).");
});
t("lists nested and ordered", () => {
  const dom = el("div", el("ul", el("li", "One", el("ul", el("li", "Sub"))), el("li", el("p", "Two"))), el("ol", el("li", "A"), el("li", "B")));
  assert.equal(htmlToMd(dom, base), "- One\n   - Sub\n- Two\n\n1. A\n2. B");
});
t("images: absolute, alt, duplicate pair kept once, parens encoded", () => {
  const dom = el("div",
    el("img", { src: "https://d3.cloudfront.net/a/pic.png?expiry=1&hmac=x", alt: "Juggling PM" }),
    el("img", { src: "https://d3.cloudfront.net/a/pic.png?expiry=2&hmac=y", alt: "" }),
    el("p", el("img", { src: "/rel/p(1).png", alt: "" })));
  assert.equal(htmlToMd(dom, base), "![Juggling PM](https://d3.cloudfront.net/a/pic.png?expiry=1&hmac=x)\n\n![](https://www.coursera.org/rel/p%281%29.png)");
});
t("table to GFM", () => {
  const dom = el("div", el("table", el("thead", el("tr", el("th", "Role"), el("th", "Does"))), el("tbody", el("tr", el("td", "Sponsor"), el("td", "Funds | decides")))));
  assert.equal(htmlToMd(dom, base), "| Role | Does |\n| --- | --- |\n| Sponsor | Funds \\| decides |");
});
t("code block, quote, hr, skipped parts", () => {
  const dom = el("div", el("pre", "a = 1\nb = 2\n"), el("blockquote", el("p", "Wise words")), el("hr"), el("button", "Mark as completed"), el("script", "x()"), el("p", { hidden: "" }, "secret"));
  assert.equal(htmlToMd(dom, base), "```\na = 1\nb = 2\n```\n\n> Wise words\n\n---");
});
t("loose text inside divs becomes paragraphs", () => {
  const dom = el("div", el("div", "First line"), el("div", "Second ", el("em", "line")));
  assert.equal(htmlToMd(dom, base), "First line\n\nSecond *line*");
});
t("transcript: joins cut lines and groups sentences", () => {
  const lines = ["As we mentioned in the last video,", "when you're managing a project. Why is it so important?", "It's because there are many parts. Trust matters. Roles help.", "Next sentence here."];
  assert.equal(transcriptToMd(lines), "As we mentioned in the last video, when you're managing a project. Why is it so important? It's because there are many parts. Trust matters.\n\nRoles help. Next sentence here.");
  assert.equal(transcriptToMd([]), "");
});
t("keyword guess: shared word, plural, fallback", () => {
  assert.equal(guessKeyword("Essential project roles", "Defining project roles", ""), "project".length > "roles".length ? "project" : "roles");
  assert.equal(guessKeyword("Defining role", "Essential project roles", "pm"), "role");
  assert.equal(guessKeyword("Charters", "SMART goals", "initiation"), "initiation");
  assert.equal(guessKeyword("Charters", "", ""), "");
});
t("title pattern", () => {
  assert.equal(fillTitle("Transcript · {title}", { title: "Essential roles" }), "Transcript · Essential roles");
  assert.equal(fillTitle("", { title: "X" }), "X");
});
console.log(`\n${n} md tests passed`);
