// Notes as a Word file (.docx), written by hand: real headings, bullet and numbered lists, checkboxes,
// tables, quotes, code, toggles, highlight and links. Opens in Word, Google Docs, Pages and LibreOffice.
import { createZip } from "@/lib/zip";
import { noteBlocks, noteMeta, noteTitle, safeHref, type Block, type ExportNote, type Run } from "./model";

const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PAGE_W = 11906; // A4, twips
const MARGIN = 1300;
const TEXT_W = PAGE_W - 2 * MARGIN;
const STEP = 360; // indent per list level

type RunOpts = { color?: string; strike?: boolean; bold?: boolean };
type ParaOpts = { style?: string; keepNext?: boolean; pageBreak?: boolean; numId?: number; ilvl?: number; left?: number; hanging?: number; jc?: string };
type Ctx = { left: number; depth: number; style?: string };

class DocxWriter {
  body: string[] = [];
  rels: string[] = [];
  nums: string[] = [];
  nextNum = 3; // 1 = bullets, 2 = numbers; ordered lists get their own (so they restart at their start)

  link(href: string) {
    const id = `rIdL${this.rels.length + 1}`;
    this.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(href)}" TargetMode="External"/>`);
    return id;
  }

  runs(runs: Run[], o: RunOpts = {}) {
    return runs
      .map((r) => {
        const href = safeHref(r.href);
        // Element order follows the Word schema (rStyle, b, i, strike, color, highlight, u)
        const pr = [
          r.code ? '<w:rStyle w:val="InlineCode"/>' : href ? '<w:rStyle w:val="Hyperlink"/>' : "",
          r.b || o.bold ? "<w:b/>" : "",
          r.i ? "<w:i/>" : "",
          r.s || o.strike ? "<w:strike/>" : "",
          o.color && !href ? `<w:color w:val="${o.color}"/>` : "",
          r.hl ? '<w:highlight w:val="yellow"/>' : "",
          r.u ? '<w:u w:val="single"/>' : "",
        ].join("");
        const text = r.text
          .replace(/ /g, " ")
          .split("\n")
          .map((t) => `<w:t xml:space="preserve">${xml(t)}</w:t>`)
          .join("<w:br/>");
        const run = `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${text}</w:r>`;
        return href ? `<w:hyperlink r:id="${this.link(href)}">${run}</w:hyperlink>` : run;
      })
      .join("");
  }

  pPr(o: ParaOpts) {
    // Element order follows the Word schema (pStyle, keepNext, pageBreakBefore, numPr, ind, jc)
    const parts = [
      o.style ? `<w:pStyle w:val="${o.style}"/>` : "",
      o.keepNext ? "<w:keepNext/>" : "",
      o.pageBreak ? "<w:pageBreakBefore/>" : "",
      o.numId ? `<w:numPr><w:ilvl w:val="${o.ilvl ?? 0}"/><w:numId w:val="${o.numId}"/></w:numPr>` : "",
      o.left || o.hanging ? `<w:ind w:left="${o.left ?? 0}"${o.hanging ? ` w:hanging="${o.hanging}"` : ""}/>` : "",
      o.jc ? `<w:jc w:val="${o.jc}"/>` : "",
    ].join("");
    return parts ? `<w:pPr>${parts}</w:pPr>` : "";
  }

  p(content: string, o: ParaOpts = {}) {
    this.body.push(`<w:p>${this.pPr(o)}${content}</w:p>`);
  }

  blocks(list: Block[], ctx: Ctx) {
    for (const b of list) this.block(b, ctx);
  }

  block(b: Block, ctx: Ctx) {
    const base = { style: ctx.style, left: ctx.left || undefined };
    switch (b.t) {
      case "h":
        this.p(this.runs(b.runs), { style: `Heading${Math.min(3, b.level)}`, left: ctx.left || undefined });
        return;
      case "p":
        this.p(this.runs(b.runs), base);
        return;
      case "list": {
        const numId = b.ordered ? this.nextNum++ : 1;
        if (b.ordered)
          this.nums.push(
            `<w:num w:numId="${numId}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${ctx.depth}"><w:startOverride w:val="${b.start}"/></w:lvlOverride></w:num>`,
          );
        const left = ctx.left + STEP;
        for (const it of b.items) {
          if (it.checked === null) this.p(this.runs(it.runs), { style: ctx.style ?? "ListItem", numId, ilvl: Math.min(8, ctx.depth), left, hanging: STEP });
          else {
            const box = `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:cs="Segoe UI Symbol"/>${it.checked ? '<w:color w:val="4F46E5"/>' : ""}</w:rPr><w:t xml:space="preserve">${it.checked ? "☑" : "☐"} </w:t></w:r>`;
            this.p(box + this.runs(it.runs, it.checked ? { strike: true, color: "9CA3AF" } : {}), { style: ctx.style ?? "ListItem", left, hanging: STEP });
          }
          if (it.blocks.length) this.blocks(it.blocks, { ...ctx, left, depth: ctx.depth + 1 });
        }
        return;
      }
      case "quote":
        this.blocks(b.blocks, { ...ctx, style: "Quote", left: ctx.left + 240 });
        return;
      case "code":
        for (const line of b.text.replace(/\t/g, "    ").split("\n"))
          this.p(line ? `<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>` : "", { style: "CodeBlock", left: ctx.left || undefined });
        this.p("", { style: "Spacer" });
        return;
      case "hr":
        this.p("", { style: "Rule" });
        return;
      case "table":
        this.table(b, ctx);
        return;
      case "details":
        this.p(
          `<w:r><w:rPr><w:color w:val="6B7280"/></w:rPr><w:t xml:space="preserve">▸ </w:t></w:r>${this.runs(b.summary, { bold: true })}`,
          { ...base, keepNext: true },
        );
        this.blocks(b.blocks, { ...ctx, left: ctx.left + STEP });
        return;
    }
  }

  table(b: Extract<Block, { t: "table" }>, ctx: Ctx) {
    const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
    if (!cols) return;
    const len = (rs?: Run[]) => (rs ? rs.map((r) => r.text).join("").length : 0);
    const natural = Array.from({ length: cols }, (_, i) => Math.max(4, ...[b.head, ...b.rows].map((r) => Math.min(40, len(r[i])))));
    const avail = TEXT_W - ctx.left;
    const total = natural.reduce((a, v) => a + v, 0);
    const widths = natural.map((v) => Math.round((v / total) * avail));
    const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>`;
    const cell = (rs: Run[] | undefined, i: number, header: boolean) => {
      const shd = header ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>' : "";
      const jc = b.align[i] === "center" ? "center" : b.align[i] === "right" ? "right" : undefined;
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${shd}</w:tcPr><w:p>${this.pPr({ style: "TableText", jc })}${this.runs(rs ?? [], { bold: header })}</w:p></w:tc>`;
    };
    const rows = [
      ...(b.head.length ? [`<w:tr><w:trPr><w:tblHeader/></w:trPr>${widths.map((_, i) => cell(b.head[i], i, true)).join("")}</w:tr>`] : []),
      ...b.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${widths.map((_, i) => cell(r[i], i, false)).join("")}</w:tr>`),
    ];
    this.body.push(
      `<w:tbl><w:tblPr><w:tblW w:w="${avail}" w:type="dxa"/>${ctx.left ? `<w:tblInd w:w="${ctx.left}" w:type="dxa"/>` : ""}` +
        `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
        `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
        `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`,
    );
    this.p("", { style: "Spacer" }); // Word needs a paragraph between two tables
  }

  note(n: ExportNote, first: boolean) {
    this.p(this.runs([{ text: noteTitle(n) }]), { style: "Title", pageBreak: !first });
    const meta = noteMeta(n);
    if (meta) this.p(this.runs([{ text: meta }]), { style: "Meta" });
    const blocks = noteBlocks(n);
    if (!blocks.length) this.p(this.runs([{ text: "Empty note", i: true }], { color: "9CA3AF" }));
    this.blocks(blocks, { left: 0, depth: 0 });
  }
}

const LEVELS = (fmt: (l: number) => { numFmt: string; text: string }) =>
  Array.from({ length: 9 }, (_, l) => {
    const f = fmt(l);
    return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${f.numFmt}"/><w:lvlText w:val="${f.text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${STEP * (l + 1)}" w:hanging="${STEP}"/></w:pPr></w:lvl>`;
  }).join("");

function numberingXml(extra: string[]) {
  const bullets = LEVELS((l) => ({ numFmt: "bullet", text: ["•", "◦", "▪"][l % 3] }));
  const numbers = LEVELS((l) => ({ numFmt: ["decimal", "lowerLetter", "lowerRoman"][l % 3], text: `%${l + 1}.` }));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${W_NS}>` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bullets}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numbers}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>${extra.join("")}</w:numbering>`
  );
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:color w:val="1F2330"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Note info"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="8" w:color="E5E7EB"/></w:pBdr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="27"/><w:szCs w:val="27"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:color w:val="374151"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListItem"><w:name w:val="List item"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="50"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C7D2FE"/></w:pBdr></w:pPr><w:rPr><w:color w:val="4B5563"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="1F2937"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Spacer"><w:name w:val="Spacer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="160" w:lineRule="exact"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Rule"><w:name w:val="Divider"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr><w:spacing w:after="200"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="InlineCode"><w:name w:val="Inline code"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="9F1239"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="4F46E5"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

export function notesDocx(notes: ExportNote[]): Uint8Array {
  const w = new DocxWriter();
  notes.forEach((n, i) => w.note(n, i === 0));
  const title = notes.length === 1 ? noteTitle(notes[0]) : `Notes (${notes.length})`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS} ${R_NS}><w:body>${w.body.join("")}` +
    `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="16838"/><w:pgMar w:top="1300" w:right="${MARGIN}" w:bottom="1300" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  return createZip([
    {
      name: "[Content_Types].xml",
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${xml(title)}</dc:title><dc:creator>Personal OS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${w.rels.join("")}</Relationships>`,
    },
    { name: "word/document.xml", content: document },
    { name: "word/styles.xml", content: STYLES },
    { name: "word/numbering.xml", content: numberingXml(w.nums) },
  ]);
}
