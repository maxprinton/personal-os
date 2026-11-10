// Template Manager, phase 3 — the shared part of the fill engine: what a "blank" is, how blanks are found in
// text, how a table header is matched to a profile field, and how a found blank becomes text. Pure.
import { FIELD, FIELD_DEFS, LIST_KEYS, cleanLabel, fieldForLabel, isScaleHeader, sectionText, valueText, type Values } from "../fields";

/** One blank of one file, as found by the scan and confirmed (or changed) by you. field null = leave it alone;
 *  "ask:<label>" = ask me each time. */
export type MapItem =
  | { kind: "token"; token: string; keep?: string; field: string | null; label: string; sure?: boolean }
  | { kind: "cell"; part: string; table: number; row: number; col: number; field: string | null; label: string; sure?: boolean }
  | { kind: "table"; part: string; table: number; header: number; field: string | null; label: string; cols: TableCol[]; sure?: boolean }
  | { kind: "section"; part: string; heading: string; fields: string[]; field: string | null; label: string; sure?: boolean }
  | { kind: "pdf_field"; name: string; field: string | null; label: string; sure?: boolean }
  | { kind: "pdf_spot"; page: number; x: number; y: number; size: number; field: string | null; label: string; sure?: boolean };

/** A column of a table blank: a column of a table field (sub = its column key) or a list field (no sub). */
export type TableCol = { col: number; field: string; sub?: string; header: string };

export type FillReport = { filled: number; skipped: string[] };

// ------------------------------------------------------------------------------------------ XML text

export const xmlDecode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
export const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// ------------------------------------------------------------------------------------------ finding blanks in text

const BRACKETS: RegExp[] = [/\[([^[\]\n]{2,48})\]/g, /<<([^<>\n]{2,48})>>/g, /«([^«»\n]{2,48})»/g, /<([^<>\n]{2,48})>/g];
const CURLY = /\{\{\s*([A-Za-z_][\w ]{0,40}?)\s*\}\}/g;
const UNDERSCORE = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ /().'-]{1,40}?)\s*[:：]\s*(_{3,})/g;

const HTML_TAGS = new Set(["br", "b", "i", "u", "p", "em", "strong", "div", "span", "sup", "sub", "hr", "img", "a", "li", "ul", "ol", "tr", "td", "th", "table", "code", "pre", "small"]);
const looksLikeLabel = (s: string) => /[A-Za-zÀ-ÿ]/.test(s) && !/^https?:|^\/|@/.test(s.trim()) && s.trim().split(/\s+/).length <= 6;

/** Blanks inside one piece of text: {{field}}, [Label], <Label>, <<Label>>, «Label», "Label: ____". */
export function scanText(text: string, opts: { brackets?: "all" | "known" } = {}): Extract<MapItem, { kind: "token" }>[] {
  const out: Extract<MapItem, { kind: "token" }>[] = [];
  const seen = new Set<string>();
  const add = (it: Extract<MapItem, { kind: "token" }>) => {
    if (seen.has(it.token)) return;
    seen.add(it.token);
    out.push(it);
  };
  for (const m of text.matchAll(CURLY)) {
    const raw = m[1].trim();
    const key = raw.toLowerCase().replace(/\s+/g, "_");
    if (FIELD[key]) add({ kind: "token", token: m[0], field: key, label: FIELD[key].label.en, sure: true });
    else if (/\s/.test(raw)) continue; // "{{double braces}}" in a sentence is text, not a blank
    else {
      const f = fieldForLabel(raw.replace(/_/g, " "));
      add({ kind: "token", token: m[0], field: f ?? `ask:${raw.replace(/_/g, " ")}`, label: raw.replace(/_/g, " "), sure: !!f });
    }
  }
  for (const re of BRACKETS) {
    for (const m of text.matchAll(re)) {
      const raw = m[1].trim();
      const next = text.charAt((m.index ?? 0) + m[0].length);
      const prev = text.charAt((m.index ?? 0) - 1);
      if (re.source.startsWith("<(") && (prev === "<" || next === ">")) continue; // inside <<Label>>
      if (!looksLikeLabel(raw) || /^\d+$/.test(raw) || /\{\{/.test(raw) || /^["'`]/.test(raw) || HTML_TAGS.has(raw.replace(/[\s/]/g, "").toLowerCase()) || next === "(") continue;
      const label = raw.replace(/^(insert|enter|add|escriba|ingrese|inserte)\s+/i, "");
      const f = fieldForLabel(label) ?? fieldForLabel(raw);
      if (opts.brackets === "known" && !f) continue;
      add({ kind: "token", token: m[0], field: f ?? `ask:${label}`, label, sure: !!f });
    }
  }
  for (const m of text.matchAll(UNDERSCORE)) {
    const label = m[1].trim();
    const f = fieldForLabel(label);
    add({ kind: "token", token: m[0], keep: m[0].slice(0, m[0].length - m[2].length), field: f ?? `ask:${label}`, label, sure: !!f });
  }
  return out;
}

/** Replaces token blanks in a piece of text. Returns the new text and how many blanks were filled. */
export function fillText(text: string, items: MapItem[], v: Values, report: FillReport): string {
  let out = text;
  for (const it of items) {
    if (it.kind !== "token" || !it.field || !out.includes(it.token)) continue;
    const val = valueFor(v, it.field);
    if (!val) {
      if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
      continue;
    }
    const n = out.split(it.token).length - 1;
    out = out.split(it.token).join((it.keep ?? "") + val);
    report.filled += n;
  }
  return out;
}

/** The text a section blank gets ("ask:" sections take your answer, or the AI draft you approved). */
export function sectionValue(it: Extract<MapItem, { kind: "section" }>, v: Values) {
  if (!it.field) return "";
  return it.field.startsWith("ask:") ? v.scalars[it.field] ?? "" : sectionText(v, it.fields.length ? it.fields : [it.field]);
}

export function valueFor(v: Values, field: string) {
  if (field.startsWith("ask:")) return v.scalars[field] ?? "";
  return valueText(v, field);
}

// ------------------------------------------------------------------------------------------ tables

const SKIP_TABLE = ["signature", "firma", "signed", "firmado", "approved by", "aprobado por"];

/** Which profile field a table holds, from its header cells (and the words around it). Null when unsure. */
export function mapHeaders(headers: string[], context = ""): { field: string; cols: TableCol[] } | null {
  const clean = headers.map((h) => cleanLabel(h));
  if (clean.some((h) => SKIP_TABLE.includes(h))) return null;
  const ctx = cleanLabel(context);
  let best: { field: string; cols: TableCol[]; score: number; subs: number } | null = null;
  let tie = false;
  for (const f of FIELD_DEFS) {
    if (f.kind !== "table" || !f.columns) continue;
    const cols: TableCol[] = [];
    headers.forEach((h, i) => {
      if (!clean[i] || isScaleHeader(h)) return;
      const col = f.columns!.find((c) => c.aliases.includes(clean[i]));
      if (col) cols.push({ col: i, field: f.key, sub: col.key, header: h.trim() });
    });
    const subs = new Set(cols.map((c) => c.sub)).size;
    if (subs < 2) continue;
    const score = subs + ((f.context ?? []).some((w) => ctx.includes(w)) ? 1.5 : 0);
    if (!best || score > best.score) {
      best = { field: f.key, cols, score, subs };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  if (best && !tie) return { field: best.field, cols: best.cols };
  // A table whose columns are lists: "In scope | Out of scope", "Assumptions | Constraints".
  const lists: TableCol[] = [];
  headers.forEach((h, i) => {
    const f = LIST_KEYS.find((k) => FIELD[k].aliases.includes(clean[i]));
    if (f) lists.push({ col: i, field: f, header: h.trim() });
  });
  const nonEmpty = clean.filter(Boolean).length;
  if (lists.length && lists.length === nonEmpty) return { field: lists[0].field, cols: lists };
  return null;
}

/** The rows a table blank writes: one array of cell texts per row, in column order of `cols`. */
export function tableRows(it: Extract<MapItem, { kind: "table" }>, v: Values): string[][] {
  const tableField = it.cols.find((c) => c.sub)?.field;
  if (tableField) {
    const rows = v.tables[tableField] ?? [];
    return rows.map((r) => it.cols.map((c) => (c.sub ? r[c.sub] ?? "" : "")));
  }
  const lists = it.cols.map((c) => v.lists[c.field] ?? []);
  const n = Math.max(0, ...lists.map((l) => l.length));
  return Array.from({ length: n }, (_, i) => lists.map((l) => l[i] ?? ""));
}

/** Every profile field a map uses (for "what's missing" and for the out-of-date check). */
export function fieldsUsed(items: MapItem[]) {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind === "table") for (const c of it.cols) out.push(c.field);
    else if (it.kind === "section" && it.field) out.push(...(it.field.startsWith("ask:") ? [it.field] : it.fields.length ? it.fields : [it.field]));
    else if (it.field) out.push(it.field);
  }
  return [...new Set(out)];
}

/** Items that fill on their own (no confirmation needed): {{known fields}}, exact labels, clear tables. */
export function autoItems(items: MapItem[]) {
  return items.filter((it) => it.sure && it.field && !it.field.startsWith("ask:"));
}

/** Keeps a saved map in sync with a new scan: saved choices win, new blanks are added as found. */
export function mergeMap(saved: MapItem[], scanned: MapItem[]): MapItem[] {
  const keyOf = (it: MapItem) =>
    it.kind === "token" ? `t:${it.token}` : it.kind === "cell" ? `c:${it.part}:${it.table}:${it.row}:${it.col}` : it.kind === "table" ? `T:${it.part}:${it.table}:${it.header}` : it.kind === "section" ? `S:${it.part}:${it.heading}` : it.kind === "pdf_field" ? `f:${it.name}` : `s:${it.page}:${it.x}:${it.y}`;
  const savedBy = new Map(saved.map((it) => [keyOf(it), it]));
  const out = scanned.map((it) => savedBy.get(keyOf(it)) ?? it);
  for (const it of saved) if (it.kind === "pdf_spot" && !out.includes(it)) out.push(it);
  return out;
}

/** Cleans a map coming from the browser (only known kinds and fields, sane numbers). */
export function cleanMap(input: unknown): MapItem[] {
  if (!Array.isArray(input)) return [];
  const okField = (f: unknown): string | null => (typeof f === "string" && (FIELD[f] || (/^ask:.{1,60}$/.test(f))) ? f : null);
  const str = (s: unknown, n = 200) => (typeof s === "string" ? s.slice(0, n) : "");
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
  const out: MapItem[] = [];
  for (const raw of input.slice(0, 500)) {
    const it = raw as Record<string, unknown>;
    const field = okField(it.field);
    const label = str(it.label, 80) || "Blank";
    if (it.kind === "token" && typeof it.token === "string" && it.token.length) out.push({ kind: "token", token: str(it.token, 300), keep: typeof it.keep === "string" ? str(it.keep, 120) : undefined, field, label, sure: true });
    else if (it.kind === "cell") out.push({ kind: "cell", part: str(it.part), table: num(it.table, 0, 999), row: num(it.row, 0, 9999), col: num(it.col, 0, 99), field, label, sure: true });
    else if (it.kind === "table" && Array.isArray(it.cols)) {
      const cols = (it.cols as Record<string, unknown>[])
        .map((c) => ({ col: num(c.col, 0, 999), field: str(c.field, 40), sub: typeof c.sub === "string" ? str(c.sub, 40) : undefined, header: str(c.header, 80) }))
        .filter((c) => FIELD[c.field] && (!c.sub || FIELD[c.field].columns?.some((x) => x.key === c.sub)));
      if (cols.length) out.push({ kind: "table", part: str(it.part), table: num(it.table, 0, 999), header: num(it.header, 0, 99999), field: field ? cols[0].field : null, label, cols, sure: true });
    } else if (it.kind === "section" && typeof it.heading === "string") {
      const found = Array.isArray(it.fields) ? (it.fields as unknown[]).filter((f): f is string => typeof f === "string" && !!FIELD[f]).slice(0, 4) : [];
      const fields = !field || field.startsWith("ask:") ? found : found.includes(field) ? found : [field];
      out.push({ kind: "section", part: str(it.part), heading: str(it.heading, 200), fields, field, label, sure: true });
    } else if (it.kind === "pdf_field" && typeof it.name === "string") out.push({ kind: "pdf_field", name: str(it.name, 200), field, label, sure: true });
    else if (it.kind === "pdf_spot") out.push({ kind: "pdf_spot", page: Math.round(num(it.page, 1, 999)), x: num(it.x, 0, 100), y: num(it.y, 0, 100), size: num(it.size, 6, 36) || 10, field, label, sure: true });
  }
  return out;
}
