// Template Manager, phase 3 — Excel (.xlsx): find blanks and fill them in place, keeping the workbook's look.
// Text blanks inside cells ({{field}}, [Label]...) are replaced in the shared strings; a header row that matches a
// profile list (risks, milestones, team...) gets one row per item, written into the empty rows under it (the grey
// example row is overwritten and takes the look of the row below); "Label: | (empty cell)" gets the value.
// Formulas are never touched, and Excel recalculates them on open.
import { fieldForLabel } from "../fields";
import type { Values } from "../fields";
import { fillText, mapHeaders, scanText, tableRows, valueFor, xmlDecode, xmlEscape, type FillReport, type MapItem } from "./common";
import { openZip, readPart, saveZip, writePart, type Parts } from "./ooxml";

const SHEET_RE = /^xl\/worksheets\/sheet\d+\.xml$/;
const ROW_RE = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
const CELL_RE = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;

export const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export function colName(n: number) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// ------------------------------------------------------------------------------------------ reading

type SharedStrings = { xml: string; items: { a: number; b: number; text: string }[] };

function readShared(xml: string | null): SharedStrings {
  if (!xml) return { xml: "", items: [] };
  const items: SharedStrings["items"] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    const inner = (m[1] ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let text = "";
    for (const t of inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += xmlDecode(t[1]);
    items.push({ a: m.index ?? 0, b: (m.index ?? 0) + m[0].length, text });
  }
  return { xml, items };
}

type Cell = { ref: string; col: number; a: number; b: number; xml: string; s: string | undefined; text: string; formula: boolean };
type Row = { r: number; a: number; b: number; xml: string; cells: Cell[] };

function cellText(c: string, sst: SharedStrings) {
  const t = attr(c.slice(0, c.indexOf(">") + 1), "t");
  if (t === "s") {
    const i = Number(/<v>(\d+)<\/v>/.exec(c)?.[1]);
    return Number.isFinite(i) ? sst.items[i]?.text ?? "" : "";
  }
  if (t === "inlineStr") {
    let s = "";
    for (const m of c.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += xmlDecode(m[1]);
    return s;
  }
  return xmlDecode(/<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? "");
}

function readRows(xml: string, sst: SharedStrings): Row[] {
  const rows: Row[] = [];
  for (const m of xml.matchAll(ROW_RE)) {
    const rowXml = m[0];
    const r = Number(attr(rowXml.slice(0, rowXml.indexOf(">") + 1), "r"));
    const cells: Cell[] = [];
    for (const c of rowXml.matchAll(CELL_RE)) {
      const open = c[0].slice(0, c[0].indexOf(">") + 1);
      const ref = attr(open, "r") ?? "";
      const col = colNum(ref.replace(/\d+/g, ""));
      cells.push({ ref, col, a: c.index ?? 0, b: (c.index ?? 0) + c[0].length, xml: c[0], s: attr(open, "s"), text: cellText(c[0], sst), formula: /<f[\s>/]/.test(c[0]) });
    }
    rows.push({ r, a: m.index ?? 0, b: (m.index ?? 0) + rowXml.length, xml: rowXml, cells });
  }
  return rows;
}

/** Which cell styles are dates and which are italic (example rows), from styles.xml. */
function readStyles(xml: string | null) {
  const dates = new Set<number>();
  const italic = new Set<number>();
  if (!xml) return { dates, italic };
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\/>/g)) custom.set(Number(attr(m[0], "numFmtId")), xmlDecode(attr(m[0], "formatCode") ?? ""));
  const fontsXml = /<fonts\b[\s\S]*?<\/fonts>/.exec(xml)?.[0] ?? "";
  const fonts = [...fontsXml.matchAll(/<font\b[\s\S]*?<\/font>|<font\s*\/>/g)].map((m) => /<i\/>|<i val="(?:1|true)"\/>/.test(m[0]));
  const xfsXml = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  [...xfsXml.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].forEach((m, i) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "") ?? "";
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && /[dy]/i.test(code) && !/^general$/i.test(code))) dates.add(i);
    if (fonts[Number(attr(m[0], "fontId") ?? 0)]) italic.add(i);
  });
  return { dates, italic };
}

function sheetNames(z: Parts): Map<string, string> {
  const wb = readPart(z, "xl/workbook.xml") ?? "";
  const rels = readPart(z, "xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const t = attr(m[0], "Target") ?? "";
    target.set(attr(m[0], "Id") ?? "", t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`);
  }
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*\/>/g)) {
    const part = target.get(attr(m[0], "r:id") ?? "");
    if (part) out.set(part, xmlDecode(attr(m[0], "name") ?? ""));
  }
  return out;
}

const partsOf = (z: Parts) => z.order.filter((n) => SHEET_RE.test(n));
const isEmpty = (c: Cell | undefined) => !c || (!c.formula && (!c.text.trim() || /^_{2,}$/.test(c.text.trim())));

// ------------------------------------------------------------------------------------------ scan

export function scanXlsx(bytes: Uint8Array): MapItem[] {
  const z = openZip(bytes);
  const sst = readShared(readPart(z, "xl/sharedStrings.xml"));
  const names = sheetNames(z);
  const items: MapItem[] = [];
  const seen = new Set<string>();
  for (const part of partsOf(z)) {
    const sheet = names.get(part) ?? part;
    const rows = readRows(readPart(z, part)!, sst);
    for (const row of rows) for (const c of row.cells) {
      if (c.formula || !c.text) continue;
      for (const it of scanText(c.text)) {
        if (seen.has(it.token)) continue;
        seen.add(it.token);
        items.push(it);
      }
    }
    if (/^(guide|gu[ií]a)$/i.test(sheet.trim())) continue; // instructions sheet: no label cells or tables to fill
    let tableFrom = Infinity;
    rows.forEach((row, ri) => {
      const texts = row.cells.filter((c) => !c.formula).map((c) => c.text);
      if (texts.filter((t) => t.trim()).length < 2) return;
      const width = Math.max(...row.cells.map((c) => c.col));
      const headers = Array.from({ length: width }, (_, i) => row.cells.find((c) => c.col === i + 1)?.text ?? "");
      const ctx = rows.slice(Math.max(0, ri - 2), ri).flatMap((r) => r.cells.map((c) => c.text)).join(" ") + " " + sheet;
      const mapped = mapHeaders(headers, ctx);
      if (!mapped) return;
      tableFrom = Math.min(tableFrom, row.r);
      items.push({ kind: "table", part, table: 0, header: row.r, field: mapped.field, cols: mapped.cols, label: `${sheet}: ${mapped.cols.map((c) => c.header).join(" | ")}`, sure: true });
    });
    for (const row of rows) {
      if (row.r >= tableFrom) continue;
      for (const c of row.cells) {
        const label = c.text.trim();
        if (!label || c.formula || /\{\{|\[|<</.test(label) || label.length > 40) continue;
        const next = row.cells.find((x) => x.col === c.col + 1);
        if (!next || !isEmpty(next)) continue;
        const f = fieldForLabel(label);
        const clean = label.replace(/[:：]\s*$/, "");
        if (f) items.push({ kind: "cell", part, table: 0, row: row.r, col: c.col + 1, field: f, label: clean, sure: true });
        else if (/[:：]\s*$/.test(label)) items.push({ kind: "cell", part, table: 0, row: row.r, col: c.col + 1, field: `ask:${clean}`, label: clean, sure: false });
      }
    }
  }
  return items;
}

// ------------------------------------------------------------------------------------------ fill

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const serial = (iso: string) => {
  const m = ISO.exec(iso)!;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
};

type Styles = ReturnType<typeof readStyles>;

/** A cell holding `value` with style `s`: a date serial in date cells, a plain number in number cells, else text. */
function newCell(ref: string, s: string | undefined, value: string, st: Styles) {
  const sa = s !== undefined ? ` s="${s}"` : "";
  if (!value) return `<c r="${ref}"${sa}/>`;
  if (s !== undefined && st.dates.has(+s) && ISO.test(value)) return `<c r="${ref}"${sa}><v>${serial(value)}</v></c>`;
  const lines = xmlEscape(value);
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${lines}</t></is></c>`;
}

/** Rewrites some cells of a row (adding missing ones in column order). `set` maps column -> new cell XML or null (= keep). */
function editRow(row: Row, set: Map<number, (c: Cell | undefined) => string | null>, newR?: number) {
  const r = newR ?? row.r;
  const cols = new Set([...row.cells.map((c) => c.col), ...set.keys()]);
  const ordered = [...cols].sort((a, b) => a - b);
  const open = row.xml.slice(0, row.xml.indexOf(">") + 1).replace(/\/>$/, ">").replace(/\sr="\d+"/, ` r="${r}"`).replace(/\sspans="[^"]*"/, "");
  const body = ordered
    .map((col) => {
      const c = row.cells.find((x) => x.col === col);
      const f = set.get(col);
      const out = f ? f(c) : null;
      if (out !== null) return out;
      if (!c) return "";
      return newR !== undefined ? c.xml.replace(/\sr="[A-Z]+\d+"/, ` r="${colName(col)}${r}"`) : c.xml;
    })
    .join("");
  return `${open}${body}</row>`;
}

/** Clears a cell's value but keeps its look (and its formula, moved to the new row if needed). */
function clearCell(c: Cell, ref: string, s?: string) {
  const sa = (s ?? c.s) !== undefined ? ` s="${s ?? c.s}"` : "";
  if (c.formula) {
    const f = /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(c.xml)?.[0] ?? "";
    return `<c r="${ref}"${sa}>${f}</c>`;
  }
  return `<c r="${ref}"${sa}/>`;
}

function fillSheet(xml: string, part: string, items: MapItem[], v: Values, sst: SharedStrings, st: Styles, report: FillReport) {
  let rows = readRows(xml, sst);
  const edits = new Map<number, string>(); // row number -> new row xml
  const added: string[] = [];
  const rowAt = (r: number) => rows.find((x) => x.r === r);

  for (const it of items) {
    if (it.kind !== "cell" || it.part !== part || !it.field) continue;
    const val = valueFor(v, it.field);
    if (!val) {
      if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
      continue;
    }
    const row = rowAt(it.row);
    if (!row) continue;
    const ref = `${colName(it.col)}${it.row}`;
    const cur = row.cells.find((c) => c.col === it.col);
    if (cur?.formula) continue;
    const base = edits.has(it.row) ? readRows(edits.get(it.row)!, sst)[0] : row;
    edits.set(it.row, editRow(base, new Map([[it.col, () => newCell(ref, cur?.s ?? base.cells.find((c) => c.col === it.col - 1)?.s, val, st)]])));
    report.filled++;
  }

  for (const it of items) {
    if (it.kind !== "table" || it.part !== part || !it.field) continue;
    const data = tableRows(it, v);
    if (!data.length) {
      if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
      continue;
    }
    const mappedCols = it.cols.map((c) => c.col + 1);
    const after = rows.filter((r) => r.r > it.header).sort((a, b) => a.r - b.r);
    const slots: Row[] = [];
    let exampleRow: Row | null = null;
    for (const r of after) {
      const empty = mappedCols.every((col) => isEmpty(r.cells.find((c) => c.col === col)));
      const first = r.r === it.header + 1;
      const example = first && !empty && r.cells.some((c) => c.s !== undefined && st.italic.has(+c.s) && c.text.trim());
      if (empty || example) {
        if (example) exampleRow = r;
        slots.push(r);
      } else if (slots.length) break; // a filled row after empty ones: the table ends here
    }
    const styleBelow = exampleRow ? rows.find((r) => r.r === exampleRow!.r + 1) : undefined;
    const write = (row: Row, d: string[], newR?: number) => {
      const r = newR ?? row.r;
      const set = new Map<number, (c: Cell | undefined) => string | null>();
      const isExample = row === exampleRow;
      const restyle = (col: number, c: Cell | undefined) => (isExample ? styleBelow?.cells.find((x) => x.col === col)?.s ?? c?.s : c?.s);
      if (isExample || newR !== undefined) for (const c of row.cells) if (!mappedCols.includes(c.col)) set.set(c.col, (cur) => (cur ? clearCell(cur, `${colName(cur.col)}${r}`, restyle(cur.col, cur)) : null));
      it.cols.forEach((col, k) => {
        const n = col.col + 1;
        set.set(n, (cur) => (cur?.formula ? null : newCell(`${colName(n)}${r}`, restyle(n, cur), d[k] ?? "", st)));
      });
      return editRow(row, set, newR);
    };
    data.slice(0, slots.length).forEach((d, k) => edits.set(slots[k].r, write(slots[k], d)));
    const extra = data.slice(slots.length);
    if (extra.length) {
      const model = slots[slots.length - 1] ?? rowAt(it.header)!;
      let r = model.r + 1;
      let n = 0;
      for (const d of extra) {
        if (rowAt(r) || edits.has(r)) break; // never push other content down
        added.push(write(model === exampleRow ? styleBelow ?? model : model, d, r));
        r++;
        n++;
      }
      if (n < extra.length) report.skipped.push(`${it.label} (${extra.length - n} more rows did not fit)`);
    }
    report.filled += data.length;
  }

  if (!edits.size && !added.length) return xml;
  let out = xml;
  for (const row of [...rows].sort((a, b) => b.a - a.a)) if (edits.has(row.r)) out = out.slice(0, row.a) + edits.get(row.r)! + out.slice(row.b);
  if (added.length) {
    // new rows go in row order, before the first existing row with a higher number (or at the end of sheetData)
    for (const rowXml of added) {
      const r = Number(attr(rowXml.slice(0, rowXml.indexOf(">") + 1), "r"));
      const nextRow = readRows(out, sst).find((x) => x.r > r);
      const at = nextRow ? nextRow.a : out.indexOf("</sheetData>");
      out = out.slice(0, at) + rowXml + out.slice(at);
    }
    out = out.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (m, c1, r1, c2, r2) => {
      const last = Math.max(+r2, ...readRows(out, sst).map((x) => x.r));
      return `<dimension ref="${c1}${r1}:${c2}${last}"/>`;
    });
  }
  return out;
}

export function fillXlsx(bytes: Uint8Array, items: MapItem[], v: Values, report: FillReport): Uint8Array {
  const z = openZip(bytes);
  const sstXml = readPart(z, "xl/sharedStrings.xml");
  const sst = readShared(sstXml);
  const st = readStyles(readPart(z, "xl/styles.xml"));
  for (const part of partsOf(z)) {
    const xml = readPart(z, part)!;
    const next = fillSheet(xml, part, items, v, sst, st, report);
    if (next !== xml) writePart(z, part, next);
  }
  // text blanks: rewrite only the shared strings (and inline strings) that contain one
  const tokens = items.filter((it) => it.kind === "token" && it.field);
  if (tokens.length && sstXml) {
    let out = "";
    let last = 0;
    for (const si of sst.items) {
      if (!tokens.some((t) => t.kind === "token" && si.text.includes(t.token))) continue;
      const next = fillText(si.text, tokens, v, report);
      if (next === si.text) continue;
      out += sstXml.slice(last, si.a) + `<si><t xml:space="preserve">${xmlEscape(next)}</t></si>`;
      last = si.b;
    }
    if (last) writePart(z, "xl/sharedStrings.xml", out + sstXml.slice(last));
  }
  if (tokens.length) {
    for (const part of partsOf(z)) {
      const xml = readPart(z, part)!;
      const next = xml.replace(/<is>([\s\S]*?)<\/is>/g, (m, inner: string) => {
        let text = "";
        for (const t of inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += xmlDecode(t[1]);
        if (!tokens.some((t) => t.kind === "token" && text.includes(t.token))) return m;
        const filled = fillText(text, tokens, v, report);
        return filled === text ? m : `<is><t xml:space="preserve">${xmlEscape(filled)}</t></is>`;
      });
      if (next !== xml) writePart(z, part, next);
    }
  }
  // formulas recalculate when the file is opened
  const wb = readPart(z, "xl/workbook.xml");
  if (wb && !/fullCalcOnLoad="(?:1|true)"/.test(wb)) {
    const next = /<calcPr\b/.test(wb)
      ? wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"').replace(/(<calcPr fullCalcOnLoad="1"[^>]*?)\sfullCalcOnLoad="[^"]*"/, "$1")
      : wb.replace(wb.includes("</definedNames>") ? "</definedNames>" : "</sheets>", (m) => `${m}<calcPr fullCalcOnLoad="1"/>`);
    writePart(z, "xl/workbook.xml", next);
  }
  return saveZip(z);
}
