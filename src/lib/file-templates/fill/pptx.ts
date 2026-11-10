// Template Manager, phase 3 — PowerPoint (.pptx): find blanks and fill them in place, keeping the slides' look.
// Text blanks are replaced inside their paragraph; a box whose bold first line names a field ("Top risks",
// "Milestones") gets that field instead of its hint text; tables whose headers match a profile list get one row per item.
import { fieldsForHeading } from "../fields";
import type { Values } from "../fields";
import { fillText, mapHeaders, scanText, sectionValue, tableRows, xmlDecode, xmlEscape, type FillReport, type MapItem } from "./common";
import { openZip, readPart, saveZip, spliceRanges, topLevel, writePart, type Parts } from "./ooxml";

const PART_RE = /^ppt\/slides\/slide\d+\.xml$/;
const PARA_RE = /<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g;
const RUNS_RE = /<a:r>[\s\S]*?<\/a:r>|<a:br\b[^>]*?(?:\/>|>[\s\S]*?<\/a:br>)|<a:fld\b[\s\S]*?<\/a:fld>/g;

const partsOf = (z: Parts) => z.order.filter((n) => PART_RE.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));

export function paraText(p: string) {
  let s = "";
  for (const m of p.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\b/g)) s += m[0].startsWith("<a:br") ? "\n" : xmlDecode(m[1] ?? "");
  return s;
}

/** The look of a paragraph's first run, without italics (hint text is often italic). */
function runProps(p: string) {
  const rPr = /<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>)/.exec(p)?.[0] ?? /<a:endParaRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/.exec(p)?.[0]?.replace(/^<a:endParaRPr/, "<a:rPr").replace(/<\/a:endParaRPr>$/, "</a:rPr>") ?? "";
  return rPr.replace(/\si="1"/, "").replace(/\sdirty="0"/, "");
}

function runsFor(text: string, rPr: string) {
  return text
    .split("\n")
    .map((line) => `<a:r>${rPr}<a:t>${xmlEscape(line)}</a:t></a:r>`)
    .join("<a:br/>");
}

/** Puts new text into a paragraph: its runs are replaced by runs in the look of the first one. */
function setParaText(p: string, text: string) {
  if (p === "<a:p/>") return `<a:p>${runsFor(text, "")}</a:p>`;
  const rPr = runProps(p);
  const stripped = p.replace(RUNS_RE, "");
  const at = stripped.search(/<a:endParaRPr\b|<\/a:p>$/);
  return stripped.slice(0, at) + runsFor(text, rPr) + stripped.slice(at);
}

/** New paragraphs (one per line) in the look of a model paragraph. */
function parasLike(model: string, text: string) {
  const pPr = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(model)?.[0] ?? "";
  const rPr = runProps(model);
  return text
    .split("\n")
    .map((line) => `<a:p>${pPr}<a:r>${rPr}<a:t>${xmlEscape(line)}</a:t></a:r></a:p>`)
    .join("");
}

// ------------------------------------------------------------------------------------------ sections (boxes)

type Box = { heading: string; fields: string[]; a: number; b: number; model: string };

function boxesOf(xml: string): Box[] {
  const out: Box[] = [];
  for (const m of xml.matchAll(/<p:txBody>[\s\S]*?<\/p:txBody>/g)) {
    if (/<a:tbl>/.test(xml.slice(Math.max(0, (m.index ?? 0) - 300), m.index))) continue;
    const body = m[0];
    const paras = [...body.matchAll(PARA_RE)];
    if (paras.length < 2) continue;
    const head = paras[0][0];
    const heading = paraText(head).trim();
    const bold = /<a:rPr\b[^>]*\sb="1"/.test(head);
    if (!heading || heading.length > 60 || !bold || /\{\{/.test(heading)) continue;
    const rest = paras.slice(1).filter((p) => paraText(p[0]).trim());
    if (!rest.length || rest.some((p) => /\{\{|\[|<</.test(paraText(p[0])))) continue;
    const first = paras[1];
    const last = paras[paras.length - 1];
    const base = (m.index ?? 0);
    out.push({ heading, fields: fieldsForHeading(heading) ?? [], a: base + (first.index ?? 0), b: base + (last.index ?? 0) + last[0].length, model: rest[0][0] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ tables

const cellText = (tc: string) => [...tc.matchAll(PARA_RE)].map((m) => paraText(m[0])).join("\n").trim();
const isEmpty = (s: string) => !s.trim() || /^_{2,}$/.test(s.trim());

function setCell(tc: string, text: string) {
  const body = /<a:txBody>[\s\S]*?<\/a:txBody>/.exec(tc);
  if (!body) return tc.replace(/<a:tcPr\b/, `<a:txBody><a:bodyPr/><a:lstStyle/>${parasLike("<a:p/>", text)}</a:txBody><a:tcPr`);
  const first = body[0].match(PARA_RE)?.[0] ?? "<a:p/>";
  const keep = body[0].replace(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g, "").replace(/<\/a:txBody>$/, "");
  return tc.replace(body[0], `${keep}${text ? parasLike(first, text) : first.replace(RUNS_RE, "")}</a:txBody>`);
}

function setRow(tr: string, values: (string | null)[]) {
  return spliceRanges(tr, topLevel(tr, "a:tc"), (i, tc) => (values[i] === null || values[i] === undefined ? null : setCell(tc, values[i]!)));
}

// ------------------------------------------------------------------------------------------ scan

export function scanPptx(bytes: Uint8Array): MapItem[] {
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
    for (const box of boxesOf(xml)) {
      const sure = box.fields.length > 0;
      items.push({ kind: "section", part, heading: box.heading, fields: box.fields, field: sure ? box.fields[0] : null, label: box.heading, sure });
    }
    topLevel(xml, "a:tbl").forEach(([a, b], ti) => {
      const tbl = xml.slice(a, b);
      const rows = topLevel(tbl, "a:tr").map(([x, y]) => topLevel(tbl.slice(x, y), "a:tc").map(([c, d]) => cellText(tbl.slice(x, y).slice(c, d))));
      if (!rows.length) return;
      const mapped = mapHeaders(rows[0], "");
      if (mapped) items.push({ kind: "table", part, table: ti, header: 0, field: mapped.field, cols: mapped.cols, label: mapped.cols.map((c) => c.header).join(" | "), sure: true });
    });
  }
  return items;
}

// ------------------------------------------------------------------------------------------ fill

export function fillPptx(bytes: Uint8Array, items: MapItem[], v: Values, report: FillReport): Uint8Array {
  const z = openZip(bytes);
  const tokens = items.filter((it) => it.kind === "token" && it.field);
  for (const part of partsOf(z)) {
    const orig = readPart(z, part)!;
    let xml = orig;
    // tables
    const tables = items.filter((it) => it.kind === "table" && it.part === part && it.field) as Extract<MapItem, { kind: "table" }>[];
    if (tables.length) {
      xml = spliceRanges(xml, topLevel(xml, "a:tbl"), (ti, tbl) => {
        const it = tables.find((t) => t.table === ti);
        if (!it) return null;
        const data = tableRows(it, v);
        if (!data.length) {
          if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
          return null;
        }
        const rows = topLevel(tbl, "a:tr");
        const width = topLevel(tbl.slice(rows[0][0], rows[0][1]), "a:tc").length;
        const slots: number[] = [];
        for (let r = 1; r < rows.length; r++) {
          const tr = tbl.slice(rows[r][0], rows[r][1]);
          if (topLevel(tr, "a:tc").every(([c, d]) => isEmpty(cellText(tr.slice(c, d))))) slots.push(r);
        }
        const vals = (d: string[]) => {
          const out: (string | null)[] = Array(width).fill(null);
          it.cols.forEach((c, k) => { if (c.col < width) out[c.col] = d[k] ?? ""; });
          return out;
        };
        const writes = new Map<number, string[]>();
        data.slice(0, slots.length).forEach((d, k) => writes.set(slots[k], d));
        let out = spliceRanges(tbl, rows, (i, tr) => (writes.has(i) ? setRow(tr, vals(writes.get(i)!)) : null));
        const extra = data.slice(slots.length);
        if (extra.length) {
          const last = rows[slots.length ? slots[slots.length - 1] : rows.length - 1];
          const model = tbl.slice(last[0], last[1]);
          const end = out.lastIndexOf("</a:tbl>");
          out = out.slice(0, end) + extra.map((d) => setRow(model, vals(d).map((x) => x ?? ""))).join("") + out.slice(end);
        }
        report.filled += data.length;
        return out;
      });
    }
    // boxes
    const secs = items.filter((it) => it.kind === "section" && it.part === part && it.field) as Extract<MapItem, { kind: "section" }>[];
    if (secs.length) {
      const found = boxesOf(xml);
      const edits: [number, number, string][] = [];
      for (const it of secs) {
        const box = found.find((b) => b.heading === it.heading);
        if (!box) continue;
        const text = sectionValue(it, v);
        if (!text) {
          if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
          continue;
        }
        edits.push([box.a, box.b, parasLike(box.model, text)]);
        report.filled++;
      }
      for (const [a, b, r] of edits.sort((x, y) => y[0] - x[0])) xml = xml.slice(0, a) + r + xml.slice(b);
    }
    // text blanks
    if (tokens.length) {
      xml = xml.replace(PARA_RE, (p) => {
        const text = paraText(p);
        if (!tokens.some((it) => it.kind === "token" && text.includes(it.token))) return p;
        const next = fillText(text, tokens, v, report);
        return next === text ? p : setParaText(p, next);
      });
    }
    if (xml !== orig) writePart(z, part, xml);
  }
  return saveZip(z);
}

