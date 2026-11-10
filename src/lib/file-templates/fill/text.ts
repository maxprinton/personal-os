// Template Manager, phase 3 — plain text files (.md .txt .csv .mmd): blanks in the text, Markdown sections with an
// italic hint under the heading, Markdown tables and CSV tables whose headers match a profile list.
import { fieldsForHeading } from "../fields";
import type { Values } from "../fields";
import { fillText, mapHeaders, scanText, sectionValue, tableRows, type FillReport, type MapItem } from "./common";

export type TextKind = "md" | "txt" | "csv" | "mmd";

export function textKindOf(name: string): TextKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt") return "txt";
  if (ext === "csv") return "csv";
  if (ext === "mmd" || ext === "mermaid") return "mmd";
  return null;
}

// ------------------------------------------------------------------------------------------ CSV

function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// ------------------------------------------------------------------------------------------ Markdown

type MdTable = { start: number; end: number; headers: string[]; rows: { line: number; cells: string[] }[] };

const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function mdTables(lines: string[]): MdTable[] {
  const out: MdTable[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1])) continue;
    const t: MdTable = { start: i, end: i + 1, headers: splitRow(lines[i]), rows: [] };
    let j = i + 2;
    while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
      t.rows.push({ line: j, cells: splitRow(lines[j]) });
      j++;
    }
    t.end = j - 1;
    out.push(t);
    i = j - 1;
  }
  return out;
}

type MdSection = { heading: string; fields: string[]; a: number; b: number };

function mdSections(lines: string[]): MdSection[] {
  const out: MdSection[] = [];
  const tables = mdTables(lines);
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!h) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const a = j;
    while (j < lines.length && /^\s*(?:\*[^*\s][^*]*\*|_[^_\s][^_]*_)\s*$/.test(lines[j]) && !/\{\{/.test(lines[j])) j++;
    if (j === a) continue;
    let fields = fieldsForHeading(h[1]);
    let next = lines.findIndex((l, k) => k > i && /^#{1,6}\s/.test(l));
    if (next < 0) next = lines.length;
    for (const t of tables) {
      if (t.start < j || t.start > next || !fields) continue;
      const m = mapHeaders(t.headers, h[1]);
      if (m) fields = fields.filter((f) => !m.cols.some((c) => c.field === f));
    }
    if (fields && !fields.length) continue;
    out.push({ heading: h[1], fields: fields ?? [], a, b: j - 1 });
  }
  return out;
}

const mdText = (s: string) => s.split("\n").map((l) => l.replace(/^• /, "- ")).join("\n");

// ------------------------------------------------------------------------------------------ scan / fill

export function scanTextFile(text: string, kind: TextKind): MapItem[] {
  const items: MapItem[] = [];
  const seen = new Set<string>();
  const brackets = kind === "md" || kind === "txt" ? "all" : "known";
  for (const it of scanText(text, { brackets })) if (!seen.has(it.token)) { seen.add(it.token); items.push(it); }
  if (kind === "csv") {
    const rows = csvParse(text);
    const m = rows.length ? mapHeaders(rows[0], "") : null;
    if (m) items.push({ kind: "table", part: "csv", table: 0, header: 0, field: m.field, cols: m.cols, label: m.cols.map((c) => c.header).join(" | "), sure: true });
  }
  if (kind === "md") {
    const lines = text.split("\n");
    for (const s of mdSections(lines)) {
      const sure = s.fields.length > 0;
      items.push({ kind: "section", part: "md", heading: s.heading, fields: s.fields, field: sure ? s.fields[0] : null, label: s.heading.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""), sure });
    }
    mdTables(lines).forEach((t, ti) => {
      const ctx = lines.slice(Math.max(0, t.start - 4), t.start).join(" ");
      const m = mapHeaders(t.headers, ctx);
      if (m) items.push({ kind: "table", part: "md", table: ti, header: 0, field: m.field, cols: m.cols, label: m.cols.map((c) => c.header).join(" | "), sure: true });
    });
  }
  return items;
}

export function fillTextFile(text: string, kind: TextKind, items: MapItem[], v: Values, report: FillReport): string {
  let out = text;
  const tables = items.filter((it) => it.kind === "table" && it.field) as Extract<MapItem, { kind: "table" }>[];
  if (kind === "csv" && tables.length) {
    const it = tables[0];
    const data = tableRows(it, v);
    const rows = csvParse(out);
    const nl = out.includes("\r\n") ? "\r\n" : "\n";
    if (data.length && rows.length) {
      const width = rows[0].length;
      const make = (d: string[]) => {
        const r = Array(width).fill("");
        it.cols.forEach((c, k) => { if (c.col < width) r[c.col] = d[k] ?? ""; });
        return r;
      };
      const body = rows.slice(1).filter((r) => r.some((c) => c.trim()));
      out = [rows[0], ...data.map(make), ...body].map((r) => r.map(csvCell).join(",")).join(nl) + nl;
      report.filled += data.length;
    } else if (!data.length) report.skipped.push(it.label);
  }
  if (kind === "md") {
    let lines = out.split("\n");
    // tables first (from the bottom, so line numbers above stay right)
    const found = mdTables(lines);
    for (const it of [...tables].sort((a, b) => b.table - a.table)) {
      const t = found[it.table];
      if (!t) continue;
      const data = tableRows(it, v);
      if (!data.length) {
        if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
        continue;
      }
      const width = t.headers.length;
      const make = (d: string[]) => {
        const r = Array(width).fill("");
        it.cols.forEach((c, k) => { if (c.col < width) r[c.col] = (d[k] ?? "").replace(/\|/g, "/").replace(/\n/g, " "); });
        return `| ${r.join(" | ")} |`;
      };
      const empty = t.rows.filter((r) => r.cells.every((c) => !c || /^_{2,}$/.test(c)));
      const writes = data.slice(0, empty.length);
      writes.forEach((d, k) => { lines[empty[k].line] = make(d); });
      const extra = data.slice(empty.length).map(make);
      if (extra.length) lines = [...lines.slice(0, t.end + 1), ...extra, ...lines.slice(t.end + 1)];
      report.filled += data.length;
    }
    const secs = items.filter((it) => it.kind === "section" && it.field) as Extract<MapItem, { kind: "section" }>[];
    for (const s of mdSections(lines).sort((a, b) => b.a - a.a)) {
      const it = secs.find((x) => x.heading === s.heading);
      if (!it) continue;
      const val = sectionValue(it, v);
      if (!val) {
        if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
        continue;
      }
      lines = [...lines.slice(0, s.a), ...mdText(val).split("\n"), ...lines.slice(s.b + 1)];
      report.filled++;
    }
    out = lines.join("\n");
  }
  const tokens = items.filter((it) => it.kind === "token" && it.field);
  if (tokens.length) {
    if (kind === "csv") {
      out = csvParse(out).map((r) => r.map((c) => csvCell(fillText(c, tokens, v, report))).join(",")).join(out.includes("\r\n") ? "\r\n" : "\n") + "\n";
    } else if (kind === "mmd") {
      // keep Mermaid valid: one line per value, no quotes or brackets that would end a node label
      const safe: Values = { ...v, scalars: Object.fromEntries(Object.entries(v.scalars).map(([k, x]) => [k, x.replace(/["[\]{}()<>]/g, " ").replace(/\s*\n\s*/g, " / ")])) };
      out = fillText(out, tokens, safe, report);
    } else out = fillText(out, tokens, v, report);
  }
  return out;
}
