// Template Manager, phase 3 — Word (.docx): find blanks and fill them in place, keeping the document's look.
// Text blanks ({{field}}, [Label], "Label: ____") are replaced inside their paragraph; tables whose headers match a
// profile list (milestones, risks, stakeholders, team, objectives, scope) get one row per item; label/value tables
// ("Sponsor | (empty)") get the value next to the label. Only the paragraphs and cells that change are rewritten.
import { fieldForLabel, fieldsForHeading } from "../fields";
import type { Values } from "../fields";
import { fillText, mapHeaders, sectionValue, scanText, tableRows, xmlDecode, xmlEscape, type FillReport, type MapItem } from "./common";
import { openZip, readPart, saveZip, spliceRanges, topLevel, writePart, type Parts } from "./ooxml";

const PART_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Innermost paragraphs (a paragraph inside a text box is handled on its own). */
const PARA_RE = /<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>|<w:p\b[^>]*\/>/g;
const T_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g;

export function paraText(p: string) {
  let s = "";
  for (const m of p.matchAll(T_RE)) s += xmlDecode(m[1] ?? "");
  return s;
}

function cellText(tc: string) {
  return [...tc.matchAll(PARA_RE)].map((m) => paraText(m[0])).join("\n").trim();
}

/** Writes new text into a paragraph: everything goes into its first text run, the other runs are emptied. */
function setParaText(p: string, text: string) {
  let first = true;
  const lines = text.split("\n").map(xmlEscape);
  const body = lines.join('</w:t><w:br/><w:t xml:space="preserve">');
  const out = p.replace(T_RE, () => {
    if (first) {
      first = false;
      return `<w:t xml:space="preserve">${body}</w:t>`;
    }
    return "<w:t></w:t>";
  });
  return first ? p : out;
}

function partsOf(z: Parts) {
  return z.order.filter((n) => PART_RE.test(n));
}

function tableContext(xml: string, start: number) {
  const before = xml.slice(Math.max(0, start - 6000), start);
  const paras = [...before.matchAll(PARA_RE)].map((m) => paraText(m[0]).trim()).filter(Boolean);
  return paras.slice(-2).join(" ");
}

const isEmpty = (s: string) => !s.trim() || /^_{2,}$/.test(s.trim());
const isExampleRow = (tr: string) => /<w:i\/>|<w:i\s+w:val="(?:1|true)"/.test(tr) && /<w:t[\s>]/.test(tr);

// ------------------------------------------------------------------------------------------ sections
// A heading ("9. High-level risks") followed by grey italic guidance is a blank for a whole section: the guidance
// is replaced by the profile's text. If a table right under the heading already takes a field, that field is left out.

type Block = { kind: "p" | "tbl"; a: number; b: number };

/** The body in reading order: top-level paragraphs and tables. */
function blocks(xml: string): Block[] {
  const tbls = topLevel(xml, "w:tbl");
  const inTable = (i: number) => tbls.some(([a, b]) => i >= a && i < b);
  const out: Block[] = tbls.map(([a, b]) => ({ kind: "tbl" as const, a, b }));
  for (const m of xml.matchAll(PARA_RE)) {
    const i = m.index ?? 0;
    if (!inTable(i) && !/<w:txbxContent/.test(xml.slice(Math.max(0, i - 400), i))) out.push({ kind: "p", a: i, b: i + m[0].length });
  }
  return out.sort((x, y) => x.a - y.a);
}

const isHeading = (p: string) => {
  const text = paraText(p).trim();
  if (!text || text.length > 80) return false;
  if (/<w:pStyle w:val="(?:Heading|Title|Titulo|Ttulo|Subtitle)[^"]*"/i.test(p)) return true;
  const runs = [...p.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].filter((r) => /<w:t[\s>]/.test(r[0]));
  return runs.length > 0 && runs.every((r) => /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r[0]));
};
const isGuidance = (p: string) => !!paraText(p).trim() && /<w:i\/>|<w:i w:val="(?:1|true)"\/>/.test(p) && !/\{\{/.test(paraText(p).replace(/Example:.*|Ejemplo:.*/, ""));

type Section = { heading: string; fields: string[]; guide: [number, number] };

function sectionsOf(xml: string): Section[] {
  const bl = blocks(xml);
  const out: Section[] = [];
  for (let i = 0; i < bl.length; i++) {
    const h = bl[i];
    if (h.kind !== "p" || !isHeading(xml.slice(h.a, h.b))) continue;
    const heading = paraText(xml.slice(h.a, h.b)).trim();
    let j = i + 1;
    while (j < bl.length && bl[j].kind === "p" && !paraText(xml.slice(bl[j].a, bl[j].b)).trim()) j++;
    const first = j;
    while (j < bl.length && bl[j].kind === "p" && isGuidance(xml.slice(bl[j].a, bl[j].b))) j++;
    if (j === first) continue;
    let fields = fieldsForHeading(heading);
    // a table before the next heading that already takes some of these fields
    for (let k = j; k < bl.length; k++) {
      if (bl[k].kind === "p" && isHeading(xml.slice(bl[k].a, bl[k].b))) break;
      if (bl[k].kind !== "tbl" || !fields) continue;
      const tbl = xml.slice(bl[k].a, bl[k].b);
      const head = topLevel(tbl, "w:tr")[0];
      if (!head) continue;
      const tr = tbl.slice(head[0], head[1]);
      const mapped = mapHeaders(topLevel(tr, "w:tc").map(([c, d]) => cellText(tr.slice(c, d))), heading);
      if (mapped) fields = fields.filter((f) => !mapped.cols.some((c) => c.field === f));
    }
    if (fields && !fields.length) continue;
    out.push({ heading, fields: fields ?? [], guide: [bl[first].a, bl[j - 1].b] });
  }
  return out;
}

/** New paragraphs (one per line) in the look of the guidance paragraph, without its italics and grey. */
function plainParas(model: string, text: string) {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(model)?.[0] ?? "";
  let rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(model.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ""))?.[0] ?? "";
  rPr = rPr.replace(/<w:i\/>|<w:iCs\/>|<w:i\s[^>]*\/>|<w:iCs\s[^>]*\/>|<w:color\b[^>]*\/>/g, "");
  return text
    .split("\n")
    .map((line) => `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`)
    .join("");
}

// ------------------------------------------------------------------------------------------ scan

export function scanDocx(bytes: Uint8Array): MapItem[] {
  const z = openZip(bytes);
  const items: MapItem[] = [];
  const seen = new Set<string>();
  for (const part of partsOf(z)) {
    const xml = readPart(z, part)!;
    for (const m of xml.matchAll(PARA_RE)) {
      for (const it of scanText(paraText(m[0]))) {
        if (seen.has(it.token)) continue;
        seen.add(it.token);
        items.push(it);
      }
    }
    for (const sec of sectionsOf(xml)) {
      const sure = sec.fields.length > 0;
      items.push({ kind: "section", part, heading: sec.heading, fields: sec.fields, field: sure ? sec.fields[0] : null, label: sec.heading.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""), sure });
    }
    topLevel(xml, "w:tbl").forEach(([a, b], ti) => {
      const tbl = xml.slice(a, b);
      const rows = topLevel(tbl, "w:tr").map(([x, y]) => topLevel(tbl.slice(x, y), "w:tc").map(([c, d]) => cellText(tbl.slice(x, y).slice(c, d))));
      if (!rows.length) return;
      const mapped = mapHeaders(rows[0], tableContext(xml, a));
      if (mapped) {
        items.push({ kind: "table", part, table: ti, header: 0, field: mapped.field, cols: mapped.cols, label: mapped.cols.map((c) => c.header).join(" | "), sure: true });
        return;
      }
      rows.forEach((cells, ri) => {
        for (let ci = 0; ci < cells.length - 1; ci++) {
          const label = cells[ci];
          if (!label || !isEmpty(cells[ci + 1]) || /\{\{|\[|<</.test(label)) continue;
          const f = fieldForLabel(label);
          if (f) items.push({ kind: "cell", part, table: ti, row: ri, col: ci + 1, field: f, label: label.replace(/[:：]\s*$/, ""), sure: true });
          else if (/[:：]\s*$/.test(label) && label.length <= 40) items.push({ kind: "cell", part, table: ti, row: ri, col: ci + 1, field: `ask:${label.replace(/[:：]\s*$/, "")}`, label: label.replace(/[:：]\s*$/, ""), sure: false });
        }
      });
    });
  }
  return items;
}

// ------------------------------------------------------------------------------------------ fill

/** Rewrites one table cell with plain text, keeping its paragraph and run formatting (minus example italics/grey). */
function setCell(tc: string, text: string) {
  const open = /^<w:tc\b[^>]*>/.exec(tc)?.[0] ?? "<w:tc>";
  let tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>|<w:tcPr\/>/.exec(tc)?.[0] ?? "";
  tcPr = tcPr.replace(/<w:shd\b[^>]*w:fill="F3F4F8"[^>]*\/>/i, "");
  const firstP = tc.match(PARA_RE)?.[0] ?? "<w:p></w:p>";
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(firstP)?.[0] ?? "";
  let rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(firstP.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ""))?.[0] ?? "";
  rPr = rPr.replace(/<w:i\/>|<w:iCs\/>|<w:i\s[^>]*\/>|<w:iCs\s[^>]*\/>|<w:color\b[^>]*\/>/g, "");
  const run = text ? `<w:r>${rPr}<w:t xml:space="preserve">${text.split("\n").map(xmlEscape).join('</w:t><w:br/><w:t xml:space="preserve">')}</w:t></w:r>` : "";
  return `${open}${tcPr}<w:p>${pPr}${run}</w:p></w:tc>`;
}

function setRow(tr: string, values: (string | null)[], clearOthers: boolean) {
  const cells = topLevel(tr, "w:tc");
  return spliceRanges(tr, cells, (i, tc) => {
    const v = values[i];
    if (v !== null && v !== undefined) return setCell(tc, v);
    return clearOthers ? setCell(tc, "") : null;
  });
}

function fillTable(tbl: string, it: Extract<MapItem, { kind: "table" }>, v: Values, report: FillReport) {
  const data = tableRows(it, v);
  if (!data.length) {
    if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
    return tbl;
  }
  const rows = topLevel(tbl, "w:tr");
  const slots: number[] = [];
  for (let r = it.header + 1; r < rows.length; r++) {
    const tr = tbl.slice(rows[r][0], rows[r][1]);
    const texts = topLevel(tr, "w:tc").map(([a, b]) => cellText(tr.slice(a, b)));
    if (texts.every(isEmpty) || (r === it.header + 1 && isExampleRow(tr))) slots.push(r);
  }
  const width = rows.length ? topLevel(tbl.slice(rows[0][0], rows[0][1]), "w:tc").length : 0;
  const rowValues = (d: string[]) => {
    const vals: (string | null)[] = Array(width).fill(null);
    it.cols.forEach((c, k) => { if (c.col < width) vals[c.col] = d[k] ?? ""; });
    return vals;
  };
  const writes = new Map<number, string[]>();
  data.slice(0, slots.length).forEach((d, k) => writes.set(slots[k], d));
  let out = spliceRanges(tbl, rows, (i, tr) => (writes.has(i) ? setRow(tr, rowValues(writes.get(i)!), true) : null));
  const extra = data.slice(slots.length);
  if (extra.length) {
    const model = slots.length ? tbl.slice(rows[slots[slots.length - 1]][0], rows[slots[slots.length - 1]][1]) : tbl.slice(rows[rows.length - 1][0], rows[rows.length - 1][1]);
    const added = extra.map((d) => setRow(model, rowValues(d), true)).join("");
    const end = out.lastIndexOf("</w:tbl>");
    out = out.slice(0, end) + added + out.slice(end);
  }
  report.filled += data.length;
  return out;
}

export function fillDocx(bytes: Uint8Array, items: MapItem[], v: Values, report: FillReport): Uint8Array {
  const z = openZip(bytes);
  for (const part of partsOf(z)) {
    let xml = readPart(z, part)!;
    const mine = items.filter((it) => (it.kind === "table" || it.kind === "cell") && it.part === part && it.field) as Extract<MapItem, { kind: "table" | "cell" }>[];
    if (mine.length) {
      const tables = topLevel(xml, "w:tbl");
      xml = spliceRanges(xml, tables, (ti, tbl) => {
        let t = tbl;
        let changed = false;
        for (const it of mine.filter((x) => x.table === ti && x.kind === "cell") as Extract<MapItem, { kind: "cell" }>[]) {
          const val = it.field!.startsWith("ask:") ? v.scalars[it.field!] ?? "" : (v.scalars[it.field!] ?? "");
          if (!val) {
            if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
            continue;
          }
          const rows = topLevel(t, "w:tr");
          if (!rows[it.row]) continue;
          t = spliceRanges(t, rows, (ri, tr) => (ri === it.row ? setRow(tr, topLevel(tr, "w:tc").map((_, ci) => (ci === it.col ? val : null)), false) : null));
          report.filled++;
          changed = true;
        }
        for (const it of mine.filter((x) => x.table === ti && x.kind === "table") as Extract<MapItem, { kind: "table" }>[]) {
          t = fillTable(t, it, v, report);
          changed = true;
        }
        return changed ? t : null;
      });
    }
    const secs = items.filter((it) => it.kind === "section" && it.part === part && it.field) as Extract<MapItem, { kind: "section" }>[];
    if (secs.length) {
      const found = sectionsOf(xml);
      const edits: [number, number, string][] = [];
      for (const it of secs) {
        const sec = found.find((s) => s.heading === it.heading);
        if (!sec) continue;
        const text = sectionValue(it, v);
        if (!text) {
          if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
          continue;
        }
        edits.push([sec.guide[0], sec.guide[1], plainParas(xml.slice(sec.guide[0], sec.guide[1]), text)]);
        report.filled++;
      }
      for (const [a, b, r] of edits.sort((x, y) => y[0] - x[0])) xml = xml.slice(0, a) + r + xml.slice(b);
    }
    const tokens = items.filter((it) => it.kind === "token" && it.field);
    if (tokens.length) {
      xml = xml.replace(PARA_RE, (p) => {
        const text = paraText(p);
        if (!tokens.some((it) => it.kind === "token" && text.includes(it.token))) return p;
        const next = fillText(text, tokens, v, report);
        return next === text ? p : setParaText(p, next);
      });
    }
    writePart(z, part, xml);
  }
  return saveZip(z);
}
