// Notes search engine: query parsing, snippets, every block type → chunks, files (docx / pptx / xlsx / text).
import { findMatches, makeSnippet, parseQuery, plainNumbers, splitIdentifiers, wordsOf } from "@/lib/search/core";
import { filePathOf, noteToChunks, readableFile } from "@/lib/search/extract";
import { docxText, fileText, pptxText, unzip, xlsxText } from "@/lib/search/files";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const ok = (name: string, v: boolean) => eq(name, v, true);

// ---- Query ----
eq("words, prefix", parseQuery("Reunión presupuesto").terms, ["reunion:*", "presupuesto:*"]);
eq("highlight words", parseQuery("Reunión presupuesto").words, ["reunion", "presupuesto"]);
eq("phrase", parseQuery('"present perfect"').terms, ["present <-> perfect"]);
eq("OR group", parseQuery("ielts OR toefl").terms, ["((ielts:*) | (toefl:*))"]);
eq("not", parseQuery("budget -2025"), { terms: ["budget:*"], not: ["2025"], words: ["budget"], simple: null });
eq("snake_case is a sequence", parseQuery("user_id").terms, ["user <-> id:*"]);
eq("single letter exact", parseQuery("a").terms, ["a"]);
eq("number exact", parseQuery("2025").terms, ["2025"]);
eq("junk only", parseQuery("!!! ??? :*").terms, []);
eq("injection-proof", parseQuery("a' | b & !c:*").terms.every((t) => /^[a-z0-9:*<>()| -]+$/.test(t)), true);
eq("simple words for typo fix", parseQuery("presupesto clase").simple, ["presupesto", "clase"]);
eq("leading OR ignored", parseQuery("OR clase").terms, ["clase:*"]);
eq("wordsOf ñ and accents", wordsOf("Niño ÁRBOL-2"), ["nino", "arbol", "2"]);

// ---- Snippets ----
eq("matches whole word from prefix", findMatches("La reunión de hoy", ["reun"]), [[3, 10]]);
eq("not inside a word", findMatches("prereunion", ["reun"]), []);
eq("case/accents", findMatches("ÁRBOL arbol", ["arbol"]), [[0, 5], [6, 11]]);
const sn = makeSnippet("x ".repeat(200) + "the budget for May " + "y ".repeat(200), ["budget"]);
ok("snippet has ellipsis", sn.text.startsWith("…") && sn.text.endsWith("…"));
eq("snippet mark is the word", sn.text.slice(sn.marks[0][0], sn.marks[0][1]), "budget");
eq("short snippet unmarked", makeSnippet("hello world", ["zzz"]), { text: "hello world", marks: [] });
eq("split camelCase", splitIdentifiers("getUserName HTTPServer2 plain"), "get user name http server 2");
eq("plain numbers", plainNumbers("cost 1.500 and 2,000,000"), "1500 2000000");

// ---- Every block type → chunks ----
const md = [
  "Intro with **bold** and <span color=\"red\">red text</span> {color=\"blue_bg\"}",
  "# Big plan",
  "- [x] done task",
  "1. first item",
  "> a quote",
  '<callout icon="💡" color="gray_bg">',
  "Callout words",
  "</callout>",
  "<columns>",
  '<column width="0.5">',
  "Left column words",
  "</column>",
  "</columns>",
  '<details heading="2">',
  "<summary>Toggle title</summary>",
  "Hidden toggle body",
  "</details>",
  "| Name | Price |",
  "| --- | --- |",
  "| Apple | 1.500 |",
  "```python",
  "def getUserName(user_id):",
  "    return 1",
  "```",
  "Equation $E = mc^2$ and \\frac too",
  "See [the docs](https://docs.example.com/guide/start) now",
  'Ask <mention-page url="/notes/abc">Trip plan</mention-page> on <mention-date start="2026-11-06"/>',
  '<pdf src="/api/files/u1/Budget%20Q3.pdf" name="Budget Q3.pdf">Quarter budget</pdf>',
  '<bookmark url="https://example.com/x" title="Great article" description="About search"/>',
  '<page url="/notes/sub">Sub page title</page>',
  '<button label="New to-do">',
  "- [ ] inside button",
  "</button>",
  "![A cat photo](/api/files/u1/cat.png)",
  "<table_of_contents/>",
  "---",
].join("\n");
const { chunks, files } = noteToChunks({ title: "My note", blockName: null, seq: 12, content: md, props: ["Type: Idea", "Tags: ielts, work"] });
const all = chunks.map((c) => `${c.body} ${c.extra}`).join("\n");
const has = (w: string) => all.toLowerCase().includes(w.toLowerCase());
eq("title chunk", chunks[0], { kind: "title", weight: "A", label: null, anchor: null, body: "My note · NOTE-12", extra: "note12 12" });
eq("props chunk", chunks[1].kind + ":" + chunks[1].body, "props:Type: Idea\nTags: ielts, work");
ok("heading chunk B", chunks.some((c) => c.kind === "heading" && c.body === "Big plan" && c.weight === "B"));
ok("toggle title heading", chunks.some((c) => c.kind === "heading" && c.body === "Toggle title"));
for (const w of ["bold", "red text", "done task", "first item", "a quote", "Callout words", "Left column words", "Hidden toggle body", "Apple", "1500", "getUserName", "get user name", "mc^2", "frac", "the docs", "docs example com guide start", "Trip plan", "November 6, 2026", "noviembre", "Quarter budget", "Budget Q3.pdf", "Great article", "About search", "Sub page title", "New to-do", "inside button", "A cat photo", "cat png"])
  ok(`indexed: ${w}`, has(w));
for (const w of ["span", "color=", "callout", "summary", "details", "**", "mention", "table_of_contents", "{"]) ok(`markup dropped: ${w}`, !chunks.some((c) => c.body.includes(w)));
const code = chunks.find((c) => c.kind === "code");
eq("code label", code?.label, "python");
eq("code anchor = last heading", code?.anchor, "Toggle title");
ok("table chunk", chunks.some((c) => c.kind === "table" && c.body.includes("Apple · 1.500")));
ok("media chunk", chunks.some((c) => c.kind === "media" && c.label === "Budget Q3.pdf"));
eq("files", files, [{ path: "u1/Budget Q3.pdf", name: "Budget Q3.pdf" }, { path: "u1/cat.png", name: "cat.png" }]);
eq("file path decode", filePathOf("/api/files/u1/a%20b.pdf?x=1"), "u1/a b.pdf");
eq("not a file path", filePathOf("https://x.com/a.pdf"), null);
eq("readable", [readableFile("a.pdf"), readableFile("b.docx"), readableFile("c.png"), readableFile("d.mp4")], [true, true, false, false]);
const long = noteToChunks({ title: "L", content: "word ".repeat(2000) });
ok("long text split in chunks ≤ 1800", long.chunks.filter((c) => c.kind === "text").length >= 5 && long.chunks.every((c) => c.body.length <= 1800));
eq("empty note", noteToChunks({ title: "", content: "" }).chunks, []);

// ---- Files ----
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text, "utf8");
    const n = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const docx = zip({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> Word &amp; friends</w:t></w:r></w:p><w:p><w:r><w:t>Second para</w:t></w:r></w:p></w:body></w:document>' });
eq("docx", docxText(docx), [{ label: null, text: "Hello Word & friends\nSecond para" }]);
const pptx = zip({ "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>", "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>One</a:t></a:r></a:p></p:sld>", "ppt/notesSlides/notesSlide1.xml": "<a:p><a:t>Speaker note</a:t></a:p>" });
eq("pptx in slide order + notes", pptxText(pptx), [{ label: "slide 1", text: "One\nSpeaker note" }, { label: "slide 2", text: "Two" }]);
const xlsx = zip({
  "xl/workbook.xml": '<workbook><sheets><sheet name="Budget" sheetId="1"/></sheets></workbook>',
  "xl/sharedStrings.xml": "<sst><si><t>Rent</t></si><si><r><t>Fo</t></r><r><t>od</t></r></si></sst>",
  "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1500</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>cheap</t></is></c></row></sheetData></worksheet>',
});
eq("xlsx", xlsxText(xlsx), [{ label: "sheet Budget", text: "Rent · 1500\nFood · cheap" }]);
eq("unzip only wanted", [...unzip(docx, () => false).keys()], []);

const run = async () => {
  eq("txt file", await fileText("notes.TXT", Buffer.from("﻿line 1\r\nline 2")), { status: "done", parts: [{ label: null, text: "line 1\nline 2" }] });
  eq("binary txt", (await fileText("x.txt", Buffer.from([65, 0, 66]))).status, "no_text");
  eq("image skipped", (await fileText("a.png", Buffer.from([1, 2]))).status, "skipped");
  eq("broken docx fails safely", (await fileText("a.docx", Buffer.from("nope"))).status, "failed");
  const pdf = await fileText("a.pdf", Buffer.from("%PDF-1.4"));
  ok("pdf waits or fails without the reader", pdf.status === "wait" || pdf.status === "failed" || pdf.status === "no_text");
  console.log(`\nsearch: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};
void run();
