// Search engine — the text inside attached files (server only).
// Word (.docx), PowerPoint (.pptx) and Excel (.xlsx) are zip files of XML: read with Node's zlib, no extra
// packages. Text files are read as they are. PDFs need the "unpdf" package (INSTALAR-BUSCADOR.cmd); without
// it PDFs wait and are read once it is installed.
import { inflateRawSync } from "node:zlib";

export type FilePart = { label: string | null; text: string };
export type FileText = { status: "done" | "no_text" | "skipped" | "failed" | "wait"; parts: FilePart[]; detail?: string };

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT = 1024 * 1024;
export const MAX_PAGES = 300;

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

const TEXT_EXT = new Set("txt text md markdown csv tsv json js jsx ts tsx py rb go rs java c h cpp cs php html htm css scss xml yml yaml toml ini log sh bat ps1 sql srt vtt".split(" "));

/** The files inside a zip, by name → their bytes (only the names asked for, to save memory). */
export function unzip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name) || local + 30 > buf.length) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }));
  }
  return out;
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const tidy = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Text of an Office XML part: the text runs (w:t / a:t), a new line per paragraph. */
function xmlRuns(xml: string, para: string): string {
  return tidy(
    unxml(
      xml
        .replace(new RegExp(`</${para}>`, "g"), "\n")
        .replace(/<(w|a):(tab|br)\b[^>]*\/>/g, " ")
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

const byNumber = (re: RegExp) => (a: string, b: string) => Number(re.exec(a)?.[1] ?? 0) - Number(re.exec(b)?.[1] ?? 0);

export function docxText(buf: Buffer): FilePart[] {
  const z = unzip(buf, (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  const order = ["word/document.xml", ...[...z.keys()].filter((k) => k !== "word/document.xml").sort()];
  const text = order.map((k) => (z.has(k) ? xmlRuns(z.get(k)!.toString("utf8"), "w:p") : "")).filter(Boolean).join("\n\n");
  return text ? [{ label: null, text }] : [];
}

export function pptxText(buf: Buffer): FilePart[] {
  const z = unzip(buf, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const re = /(\d+)\.xml$/;
  const slides = [...z.keys()].filter((k) => k.startsWith("ppt/slides/")).sort(byNumber(re));
  const parts: FilePart[] = [];
  for (const k of slides) {
    const n = re.exec(k)?.[1] ?? "";
    const notes = z.get(`ppt/notesSlides/notesSlide${n}.xml`);
    const text = [xmlRuns(z.get(k)!.toString("utf8"), "a:p"), notes ? xmlRuns(notes.toString("utf8"), "a:p") : ""].filter(Boolean).join("\n");
    if (text) parts.push({ label: `slide ${n}`, text });
  }
  return parts;
}

export function xlsxText(buf: Buffer): FilePart[] {
  const z = unzip(buf, (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared: string[] = [];
  const ss = z.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<[^>]+>/g, "")));
  const names = [...(z.get("xl/workbook.xml")?.toString("utf8") ?? "").matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => unxml(m[1]));
  const re = /sheet(\d+)\.xml$/;
  const parts: FilePart[] = [];
  for (const k of [...z.keys()].filter((x) => re.test(x)).sort(byNumber(re))) {
    const xml = z.get(k)!.toString("utf8");
    const rows: string[] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const inner = c[2] ?? "";
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let val = "";
        if (t === "s" && v !== undefined) val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = unxml((/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "").replace(/<[^>]+>/g, ""));
        else if (v !== undefined) val = unxml(v);
        if (val.trim()) cells.push(val.trim());
      }
      if (cells.length) rows.push(cells.join(" · "));
    }
    const n = Number(re.exec(k)?.[1] ?? 0);
    if (rows.length) parts.push({ label: `sheet ${names[n - 1] ?? n}`, text: rows.join("\n") });
  }
  return parts;
}

export function plainText(buf: Buffer): FilePart[] | null {
  const text = buf.toString("utf8");
  if (text.includes("\u0000")) return null;
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  return t ? [{ label: null, text: t }] : [];
}

type Unpdf = { extractText: (data: Uint8Array, opts: { mergePages: false }) => Promise<{ totalPages: number; text: string[] }> };
let unpdfLoad: Promise<Unpdf | null> | null = null;
/** Loaded at run time on purpose: the app builds and runs without the package (PDFs then just wait). */
function loadUnpdf(): Promise<Unpdf | null> {
  if (!unpdfLoad) {
    const dynImport = new Function("m", "return import(m)") as (m: string) => Promise<Unpdf>;
    unpdfLoad = dynImport("unpdf").catch(() => null);
  }
  return unpdfLoad;
}

export async function pdfText(buf: Buffer): Promise<FilePart[] | "wait"> {
  const lib = await loadUnpdf();
  if (!lib) return "wait";
  const { text } = await lib.extractText(new Uint8Array(buf), { mergePages: false });
  return text
    .slice(0, MAX_PAGES)
    .map((t, i) => ({ label: `page ${i + 1}`, text: tidy(t ?? "") }))
    .filter((p) => p.text);
}

/** The text of a file, cut to MAX_TEXT characters, in parts (pages / slides / sheets). */
export async function fileText(name: string, buf: Buffer): Promise<FileText> {
  const e = ext(name);
  try {
    let parts: FilePart[] | null;
    if (e === "pdf") {
      const r = await pdfText(buf);
      if (r === "wait") return { status: "wait", parts: [], detail: "PDF reader not installed yet" };
      parts = r;
    } else if (e === "docx") parts = docxText(buf);
    else if (e === "pptx") parts = pptxText(buf);
    else if (e === "xlsx") parts = xlsxText(buf);
    else if (TEXT_EXT.has(e)) parts = plainText(buf);
    else return { status: "skipped", parts: [], detail: e ? `.${e} files are found by name only` : "no extension" };
    if (parts === null) return { status: "no_text", parts: [], detail: "binary file" };
    let left = MAX_TEXT;
    const cut: FilePart[] = [];
    for (const p of parts) {
      if (left <= 0) break;
      cut.push({ label: p.label, text: p.text.slice(0, left) });
      left -= p.text.length;
    }
    if (!cut.length) return { status: "no_text", parts: [], detail: e === "pdf" ? "no text (scanned PDF?)" : "empty" };
    return { status: "done", parts: cut, detail: left < 0 ? "only the first 1 MB of text is searchable" : undefined };
  } catch (err) {
    return { status: "failed", parts: [], detail: err instanceof Error ? err.message.slice(0, 200) : "could not read" };
  }
}
