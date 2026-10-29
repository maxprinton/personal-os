// Round-trip test of the note editor's Markdown (Notion dialect): Markdown → editor JSON → Markdown.
// Run: npm run test:editor
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { MdDetails, MdDetailsContent, MdDetailsSummary } from "@/lib/editor/details";
import { BlockAttrs, NHeading, NParagraph, TextColor } from "@/lib/editor/nodes/text";
import { Callout } from "@/lib/editor/nodes/callout";
import { Column, ColumnList } from "@/lib/editor/nodes/columns";
import { TableOfContents } from "@/lib/editor/nodes/toc";
import { BlockMath, InlineMath } from "@/lib/editor/nodes/math";
import { Breadcrumb, LinkMention, MentionDate, MentionPage, PageLink, parseDateQuery } from "@/lib/editor/nodes/page";
import { NotionButton } from "@/lib/editor/nodes/button";
import { AudioBlock, BookmarkBlock, EmbedBlock, FileBlock, ImageBlock, PdfBlock, VideoBlock } from "@/lib/editor/nodes/media";
import { simplifyNotionMarkdown } from "@/lib/notion-md";
import { noteAsPlainText } from "@/lib/block-notes";

const md = new MarkdownManager({
  markedOptions: { gfm: true },
  extensions: [
    StarterKit.configure({ paragraph: false, heading: false, blockquote: false }),
    NParagraph,
    NHeading,
    BlockAttrs,
    TextColor,
    Blockquote,
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight,
    TableKit,
    MdDetails,
    MdDetailsSummary,
    MdDetailsContent,
    Callout,
    ColumnList,
    Column,
    TableOfContents,
    InlineMath,
    BlockMath,
    PageLink,
    MentionPage,
    MentionDate,
    LinkMention,
    Breadcrumb,
    NotionButton,
    ImageBlock,
    VideoBlock,
    AudioBlock,
    FileBlock,
    PdfBlock,
    EmbedBlock,
    BookmarkBlock,
  ],
});

let failed = 0;
let passed = 0;
const norm = (s: string) => s.replace(/\n{2,}/g, "\n\n").trim();
function roundTrip(name: string, src: string, expect?: string) {
  let out = "";
  try {
    out = md.serialize(md.parse(src));
  } catch (e) {
    failed++;
    console.log(`✗ ${name}: threw ${(e as Error).message}`);
    return;
  }
  const want = norm(expect ?? src);
  if (norm(out) === want) passed++;
  else {
    failed++;
    console.log(`✗ ${name}\n--- expected\n${want}\n--- got\n${norm(out)}\n`);
  }
}
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.log(`✗ ${name} ${detail}`);
  }
}

// --- Old notes keep working
roundTrip("plain", "# Title\n\nSome **bold** and *italic* and `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n- [ ] task\n- [x] done");
roundTrip("toggle (old format)", "<details>\n<summary>Title</summary>\n\nInside **text**\n\n</details>");
roundTrip("highlight + underline", "A ==marked== and ++under++ word.");
roundTrip("table", "| A | B |\n| --- | --- |\n| 1 | 2 |", "| A   | B   |\n| --- | --- |\n| 1   | 2   |");
roundTrip("quote", "> quoted text");
roundTrip("code", "```js\nconst a = 1;\n```");
roundTrip("divider", "one\n\n---\n\ntwo");

// --- Notion blocks
roundTrip("block color", 'Red text {color="red"}\n\n## Blue bg {color="blue_bg"}');
roundTrip("block id", 'Anchored line {id="k3x9ab"}');
roundTrip("list item color", '- item one {color="green"}\n- item two');
roundTrip("inline color", 'Some <span color="red">red words</span> and <span color="yellow_bg">yellow bg</span>.');
roundTrip("bold inside color", 'X <span color="red">**bold red**</span> y', 'X **<span color="red">bold red</span>** y');
roundTrip("callout", '<callout icon="💡" color="gray_bg">\n\nHello **world**\n\n- a list\n\n</callout>');
roundTrip("callout text color", '<callout icon="⚠️" color="red">\n\nCareful\n\n</callout>');
roundTrip("toggle heading", '<details heading="2" color="blue_bg">\n<summary>Section</summary>\n\nBody\n\n</details>');
roundTrip(
  "columns",
  '<columns>\n<column width="0.4">\n\nLeft side\n\n</column>\n<column width="0.6">\n\nRight side\n\n- item\n\n</column>\n</columns>',
);
roundTrip("columns equal", "<columns>\n<column>\n\nA\n\n</column>\n<column>\n\nB\n\n</column>\n<column>\n\nC\n\n</column>\n</columns>");
roundTrip("toc", "<table_of_contents/>\n\n# One\n\n## Two");
roundTrip("block math", "$$\n\\int_0^1 x\\,dx\n$$");
roundTrip("inline math", "Einstein: $E = mc^2$ wow");
check("money is not math", JSON.stringify(md.parse("I paid $20 and then $30 more")).includes("inlineMath") === false);
check("money 2", JSON.stringify(md.parse("Costs $5/$10 per day")).includes("inlineMath") === false);
roundTrip("page block", '<page url="/notes/0b9f5a54-1111-4222-8333-944445555666">My sub-page</page>');
roundTrip("mention page", 'See <mention-page url="/notes/0b9f5a54-1111-4222-8333-944445555666">Plan</mention-page> now');
roundTrip("mention date", 'Due <mention-date start="2026-10-30"/> ok');
roundTrip("mention link", 'Read <mention-link url="https://example.com">Example</mention-link>');
roundTrip("breadcrumb", "<breadcrumb/>\n\nText");
roundTrip("button", '<button label="New to-do">\n\n- [ ] Something\n\n</button>');
roundTrip("image", '![A cat](/api/files/u/2026-10/abc-cat.png) {width="480" align="left"}');
roundTrip("image plain", "![](https://example.com/a.png)");
roundTrip("video", '<video src="https://youtu.be/abc">Talk</video>');
roundTrip("file", '<file src="/api/files/u/x.pdf" name="report.pdf" size="20480">Q3</file>');
roundTrip("pdf", '<pdf src="/api/files/u/x.pdf" height="600"></pdf>');
roundTrip("embed", '<embed src="https://www.figma.com/file/x"></embed>');
roundTrip("audio", '<audio src="/api/files/u/a.mp3"></audio>');
roundTrip("bookmark", '<bookmark url="https://example.com" title="Example &quot;site&quot;" description="Desc"/>');
roundTrip("nested callout in column", '<columns>\n<column>\n\n<callout icon="🔥" color="red_bg">\n\nHot\n\n</callout>\n\n</column>\n<column>\n\nCold\n\n</column>\n</columns>');
roundTrip("notion tabbed callout", '<callout icon="📌" color="blue_bg">\n\tFirst line\n\tSecond\n</callout>', '<callout icon="📌" color="blue_bg">\n\nFirst line\nSecond\n\n</callout>');
roundTrip("unsaved upload dropped", "Before", "Before");

// --- Readers outside the editor
const rich = '<callout icon="💡" color="gray_bg">\n\nRemember **this**\n\n</callout>\n\nSee <mention-page url="/notes/x">Plan</mention-page> {color="red"}\n\n<columns>\n<column>\n\nA\n\n</column>\n<column>\n\nB\n\n</column>\n</columns>\n\n<page url="/notes/0b9f5a54-1111-4222-8333-944445555666">Sub</page>';
const simple = simplifyNotionMarkdown(rich);
check("simplify: callout → quote", simple.includes("> 💡 Remember **this**"), simple);
check("simplify: no tags", !/<(callout|columns|column|mention-page|page)\b/.test(simple), simple);
check("simplify: no attrs", !simple.includes("{color"), simple);
const plain = noteAsPlainText(rich);
check("telegram text", plain.includes("💡 Remember this") && plain.includes("@Plan") && plain.includes("📄 Sub"), plain);

// --- Dates for "@"
const base = new Date(2026, 9, 28); // Wed Oct 28 2026
check("@today", parseDateQuery("today", base) === "2026-10-28");
check("@tomorrow", parseDateQuery("mañana", base) === "2026-10-29");
check("@next monday", parseDateQuery("next monday", base) === "2026-11-02");
check("@friday", parseDateQuery("viernes", base) === "2026-10-30");
check("@30/10", parseDateQuery("30/10", base) === "2026-10-30");
check("@nov 3", parseDateQuery("nov 3", base) === "2026-11-03");
check("@3 de noviembre", parseDateQuery("3 de noviembre", base) === "2026-11-03");
check("@random text", parseDateQuery("plan de viaje", base) === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
