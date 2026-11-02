// Fills the company's monthly .xlsx ("Formato Reporte de Horas Extra") with your classes, keeping the file's own look:
// colors, table, column widths, banded rows. No libraries: an .xlsx is a zip of XML files, so it is opened with Node's
// zlib, only the cells that need to change are rewritten, and everything else is copied byte for byte.
// Server only (uses node:zlib).
import { inflateRawSync } from "node:zlib";
import { createZip, type ZipEntry } from "@/lib/zip";

export type FillRow = {
  date: string; // YYYY-MM-DD
  time: string; // "De 8 a 9 PM"
  group: string;
  type: string; // "Hora Extra"
  requested: string;
  evidence: string; // Drive link
  info: string;
};
export type FillSummary = { teacher: string; month: string; lost: number; recovered: number; extra: number; collaborations: number };
export type FillResult = { bytes: Uint8Array; notes: string[] };

// ---- zip --------------------------------------------------------------------------------------------------------

export function readZip(input: Uint8Array): ZipEntry[] {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file is not an .xlsx (it is not a zip file).");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("The .xlsx file is damaged.");
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + csize);
    if (method === 0) out.push({ name, content: new Uint8Array(raw) });
    else if (method === 8) out.push({ name, content: new Uint8Array(inflateRawSync(raw)) });
    else throw new Error("The .xlsx file uses a compression I can't read.");
  }
  return out;
}

// ---- small XML helpers -------------------------------------------------------------------------------------------

const dec = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

export const colToNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export function numToCol(n: number) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    out.push([...(m[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => dec(t[1])).join(""));
  }
  return out;
}

/** Style index → "is a date format", from styles.xml. */
function dateStyles(xml: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!xml) return out;
  const custom = new Map<string, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = attr(m[0], "numFmtId");
    const code = attr(m[0], "formatCode");
    if (id && code) custom.set(id, dec(code));
  }
  const isDate = (id: string) => {
    const n = +id;
    if ((n >= 14 && n <= 22) || (n >= 27 && n <= 36) || (n >= 45 && n <= 47) || (n >= 50 && n <= 58)) return true;
    const code = custom.get(id);
    if (!code) return false;
    const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
    return /[ymdhs]/i.test(bare) && !/general/i.test(bare);
  };
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  let i = 0;
  for (const m of block.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = attr(m[0], "numFmtId");
    if (id && isDate(id)) out.add(String(i));
    i++;
  }
  return out;
}

// ---- a worksheet as rows and cells -------------------------------------------------------------------------------

type Cell = { col: number; raw: string; s?: string; t?: string; inner: string };
type Row = { n: number; attrs: string; raw: string; cells: Map<number, Cell>; dirty: boolean };

type Value = { kind: "text"; v: string } | { kind: "num"; v: number } | { kind: "link"; v: string } | { kind: "empty" };

class Sheet {
  readonly rows = new Map<number, Row>();
  private before: string;
  private after: string;

  constructor(readonly path: string, xml: string) {
    const m = /<sheetData\s*\/>|<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
    if (!m) throw new Error("A sheet in that file has no data section.");
    this.before = xml.slice(0, m.index);
    this.after = xml.slice(m.index + m[0].length);
    for (const rm of (m[1] ?? "").matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const n = Number(attr(rm[1], "r"));
      if (!n) continue;
      const cells = new Map<number, Cell>();
      for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /^([A-Z]+)\d+$/.exec(attr(cm[1], "r") ?? "");
        if (!ref) continue;
        const col = colToNum(ref[1]);
        cells.set(col, { col, raw: cm[0], s: attr(cm[1], "s"), t: attr(cm[1], "t"), inner: cm[2] ?? "" });
      }
      this.rows.set(n, { n, attrs: rm[1], raw: rm[0], cells, dirty: false });
    }
  }

  cell(r: number, c: number) {
    return this.rows.get(r)?.cells.get(c);
  }

  text(r: number, c: number, shared: string[]) {
    const cell = this.cell(r, c);
    if (!cell) return "";
    const v = /<v>([\s\S]*?)<\/v>/.exec(cell.inner)?.[1] ?? "";
    if (cell.t === "s") return shared[Number(v)] ?? "";
    if (cell.t === "inlineStr") return [...cell.inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => dec(t[1])).join("");
    return dec(v);
  }

  hasFormula(r: number, c: number) {
    const cell = this.cell(r, c);
    return !!cell && /<f[\s>/]/.test(cell.inner);
  }

  hasValue(r: number, c: number, shared: string[]) {
    return this.text(r, c, shared).trim() !== "";
  }

  /** Writes a value, keeping the cell's own style (or the one given when the cell does not exist yet). */
  set(r: number, c: number, value: Value, styleHint?: string) {
    let row = this.rows.get(r);
    if (!row) {
      row = { n: r, attrs: ` r="${r}"`, raw: "", cells: new Map(), dirty: true };
      this.rows.set(r, row);
    }
    const ref = `${numToCol(c)}${r}`;
    const s = row.cells.get(c)?.s ?? styleHint;
    const sa = s !== undefined ? ` s="${s}"` : "";
    if (value.kind === "text" && value.v === "") value = { kind: "empty" };
    let raw: string;
    let t: string | undefined;
    switch (value.kind) {
      case "text":
        t = "inlineStr";
        raw = `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(value.v)}</t></is></c>`;
        break;
      case "num":
        raw = `<c r="${ref}"${sa}><v>${value.v}</v></c>`;
        break;
      case "link": {
        t = "str";
        const f = esc(value.v.replace(/"/g, "%22"));
        raw = `<c r="${ref}"${sa} t="str"><f>HYPERLINK("${f}","${f}")</f><v>${esc(value.v)}</v></c>`;
        break;
      }
      default:
        raw = `<c r="${ref}"${sa}/>`;
    }
    row.cells.set(c, { col: c, raw, s, t, inner: "" });
    row.dirty = true;
  }

  styleOf(r: number, c: number) {
    return this.cell(r, c)?.s;
  }

  /** Removes the links the file had on cells we rewrite (otherwise clicking would open the old link). */
  dropHyperlinks(inRange: (col: number, row: number) => boolean) {
    this.after = this.after
      .replace(/<hyperlink\b[^>]*?\/>/g, (tag) => {
        const m = /^([A-Z]+)(\d+)/.exec(attr(tag, "ref") ?? "");
        return m && inRange(colToNum(m[1]), Number(m[2])) ? "" : tag;
      })
      .replace(/<hyperlinks>\s*<\/hyperlinks>/g, "");
  }

  toXml() {
    const out: string[] = [];
    for (const n of [...this.rows.keys()].sort((a, b) => a - b)) {
      const row = this.rows.get(n)!;
      if (!row.dirty) {
        out.push(row.raw);
        continue;
      }
      const attrs = row.attrs.replace(/\s*spans="[^"]*"/, "");
      const cells = [...row.cells.keys()].sort((a, b) => a - b).map((k) => row.cells.get(k)!.raw);
      out.push(cells.length ? `<row${attrs}>${cells.join("")}</row>` : `<row${attrs}/>`);
    }
    return `${this.before}<sheetData>${out.join("")}</sheetData>${this.after}`;
  }
}

// ---- locating things in the workbook ---------------------------------------------------------------------------------

function resolve(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relationships(xml: string | undefined, base: string) {
  const out: { id: string; type: string; path: string }[] = [];
  for (const m of (xml ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) out.push({ id, type: attr(m[0], "Type") ?? "", path: resolve(base, target) });
  }
  return out;
}

/** Header row + which column each header is in, found by the header texts (so a moved column still works). */
function findHeader(sheet: Sheet, shared: string[], mustHave: string[]) {
  for (const [n, row] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    const cols = new Map<string, number>();
    for (const c of row.cells.keys()) {
      const t = fold(sheet.text(n, c, shared));
      if (t) cols.set(t, c);
    }
    if (mustHave.every((h) => [...cols.keys()].some((k) => k === h || k.startsWith(`${h} `)))) return { row: n, cols };
  }
  return null;
}

const colFor = (cols: Map<string, number>, key: string) => {
  for (const [k, c] of cols) if (k === key || k.startsWith(`${key} `)) return c;
  return undefined;
};

const serial = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};
const sheetDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}-${String(y).slice(-2)}`;
};

// ---- the fill ---------------------------------------------------------------------------------------------------------

export function fillWorkbook(xlsx: Uint8Array, rows: FillRow[], summary: FillSummary): FillResult {
  const entries = readZip(xlsx);
  const files = new Map(entries.map((e) => [e.name, e]));
  const text = (name: string) => {
    const e = files.get(name);
    return e ? Buffer.from(e.content).toString("utf8") : undefined;
  };
  const wb = text("xl/workbook.xml");
  if (!wb) throw new Error("That file is not an .xlsx workbook.");
  const rels = relationships(text("xl/_rels/workbook.xml.rels"), "xl/_rels/workbook.xml.rels");
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const rid = attr(m[0], "r:id");
    return { name: dec(attr(m[0], "name") ?? ""), path: rels.find((r) => r.id === rid)?.path ?? "" };
  });
  const pick = (...words: string[]) => sheets.find((s) => words.every((w) => fold(s.name).includes(w)));
  const detail = pick("reporte", "detall");
  const resumen = pick("resumen");
  if (!detail || !resumen) {
    throw new Error(
      `I need the tabs “Resumen” and “Reporte detallado”. This file has: ${sheets.map((s) => `“${s.name}”`).join(", ") || "none"}.`,
    );
  }
  const shared = sharedStrings(text("xl/sharedStrings.xml"));
  const dates = dateStyles(text("xl/styles.xml"));
  const notes: string[] = [];
  const out = new Map<string, string>();

  // ---------- Reporte detallado
  const dxml = text(detail.path);
  if (!dxml) throw new Error("Couldn't open the “Reporte detallado” tab.");
  const ds = new Sheet(detail.path, dxml);
  const dh = findHeader(ds, shared, ["fecha", "horario"]);
  if (!dh) throw new Error("In “Reporte detallado” I couldn't find the header row (Fecha, Horario, …).");
  const c = {
    date: colFor(dh.cols, "fecha"),
    time: colFor(dh.cols, "horario"),
    group: colFor(dh.cols, "grupo"),
    type: colFor(dh.cols, "tipo"),
    requested: colFor(dh.cols, "solicitud"),
    evidence: colFor(dh.cols, "evidencia"),
    info: colFor(dh.cols, "informacion"),
  };
  const used = Object.entries(c).filter(([, v]) => v !== undefined) as [keyof typeof c, number][];
  for (const [k, v] of Object.entries(c)) if (v === undefined) notes.push(`The “${k}” column was not found in “Reporte detallado”, so it was left empty.`);

  const first = dh.row + 1;
  let last = dh.row;
  for (const n of ds.rows.keys()) if (n > dh.row && used.some(([, col]) => ds.hasValue(n, col, shared))) last = Math.max(last, n);
  // old example rows out (keeping each cell's look)
  for (let r = first; r <= last; r++) {
    for (const [, col] of used) {
      if (!ds.cell(r, col)) continue;
      if (ds.hasFormula(r, col)) notes.push(`Kept the formula in ${numToCol(col)}${r} of “Reporte detallado”.`);
      else ds.set(r, col, { kind: "empty" });
    }
  }
  rows.forEach((row, i) => {
    const r = first + i;
    for (const [key, col] of used) {
      if (ds.hasFormula(r, col)) continue;
      // a row that does not exist yet copies the look of the row two above (keeps banded colors), else the one above
      const hint = ds.styleOf(r - 2, col) ?? ds.styleOf(r - 1, col) ?? ds.styleOf(first, col);
      const style = ds.styleOf(r, col) ?? hint;
      switch (key) {
        case "date":
          ds.set(r, col, style !== undefined && dates.has(style) ? { kind: "num", v: serial(row.date) } : { kind: "text", v: sheetDate(row.date) }, style);
          break;
        case "time":
          ds.set(r, col, { kind: "text", v: row.time }, style);
          break;
        case "group":
          ds.set(r, col, { kind: "text", v: row.group }, style);
          break;
        case "type":
          ds.set(r, col, { kind: "text", v: row.type }, style);
          break;
        case "requested":
          ds.set(r, col, { kind: "text", v: row.requested }, style);
          break;
        case "evidence":
          ds.set(r, col, /^https?:\/\//i.test(row.evidence) ? { kind: "link", v: row.evidence } : row.evidence ? { kind: "text", v: row.evidence } : { kind: "empty" }, style);
          break;
        case "info":
          ds.set(r, col, { kind: "text", v: row.info }, style);
          break;
      }
    }
  });
  const lastWritten = rows.length ? first + rows.length - 1 : first - 1;
  ds.dropHyperlinks((col, row) => row >= first && row <= Math.max(last, lastWritten) && used.some(([, u]) => u === col));
  let dxmlOut = ds.toXml();
  // the sheet's "used range" must include the new rows
  dxmlOut = dxmlOut.replace(/<dimension ref="([A-Z]+\d+)(?::([A-Z]+)(\d+))?"\s*\/>/, (whole, a: string, endCol: string | undefined, endRow: string | undefined) =>
    endRow && lastWritten > Number(endRow) ? `<dimension ref="${a}:${endCol}${lastWritten}"/>` : whole,
  );
  out.set(detail.path, dxmlOut);

  // the table (Tabla2) must grow with the rows, otherwise the new ones fall outside it
  const dRels = relationships(text(`${detail.path.replace(/[^/]+$/, "_rels/")}${detail.path.split("/").pop()}.rels`), detail.path);
  for (const rel of dRels.filter((x) => /\/table$/.test(x.type))) {
    const txml = text(rel.path);
    const ref = txml && /<table\b[^>]*?\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(txml);
    if (!txml || !ref || Number(ref[2]) !== dh.row || lastWritten <= Number(ref[4])) continue;
    const oldRef = `${ref[1]}${ref[2]}:${ref[3]}${ref[4]}`;
    out.set(rel.path, txml.split(`ref="${oldRef}"`).join(`ref="${ref[1]}${ref[2]}:${ref[3]}${lastWritten}"`));
  }

  // ---------- Resumen
  const rxml = text(resumen.path);
  if (!rxml) throw new Error("Couldn't open the “Resumen” tab.");
  const rs = new Sheet(resumen.path, rxml);
  const rh = findHeader(rs, shared, ["docente"]);
  if (!rh) throw new Error("In “Resumen” I couldn't find the header row (Docente, Mes-Año, …).");
  const target = rh.row + 1;
  const put = (label: string, key: string, v: Value) => {
    const col = colFor(rh.cols, key);
    if (col === undefined) return void notes.push(`The “${label}” column was not found in “Resumen”.`);
    if (rs.hasFormula(target, col)) return void notes.push(`“${label}” in Resumen is a formula in your file, so I left it as it is.`);
    rs.set(target, col, v, rs.styleOf(target, col) ?? rs.styleOf(target + 1, col));
  };
  put("Docente", "docente", { kind: "text", v: summary.teacher });
  put("Mes-Año", "mes ano", { kind: "text", v: summary.month });
  put("Horas Perdidas", "horas perdidas", { kind: "num", v: summary.lost });
  put("Horas Recuperadas", "horas recuperadas", { kind: "num", v: summary.recovered });
  put("Horas Extra", "horas extra", { kind: "num", v: summary.extra });
  put("Colaboraciones", "colaboraciones", { kind: "num", v: summary.collaborations });
  out.set(resumen.path, rs.toXml());

  const bytes = createZip(entries.map((e) => (out.has(e.name) ? { name: e.name, content: new TextEncoder().encode(out.get(e.name)!) } : e)));
  return { bytes, notes };
}
