// Template Manager, phase 3 — PDF: fillable forms (their fields are matched to the profile by name) and flat PDFs
// (you mark spots on the page once; the value is written there each time). Uses pdf-lib. Server only.
import { PDFDocument, PDFTextField, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { fieldForLabel } from "../fields";
import type { Values } from "../fields";
import { valueFor, type FillReport, type MapItem } from "./common";

/** "ProjectName", "project_name", "txtSponsor1" -> "project name", "sponsor". */
function nameToLabel(name: string) {
  const last = name.split(/[.[\]]/).filter(Boolean).filter((p) => !/^\d+$/.test(p)).pop() ?? name;
  return last
    .replace(/^(txt|text|fld|field|tf|cmb|dd)(?=[A-Z_ ])/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\d+$/, "")
    .trim();
}

export async function scanPdf(bytes: Uint8Array): Promise<MapItem[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const items: MapItem[] = [];
  let fields: ReturnType<ReturnType<PDFDocument["getForm"]>["getFields"]> = [];
  try {
    fields = doc.getForm().getFields();
  } catch {
    fields = [];
  }
  for (const f of fields) {
    if (!(f instanceof PDFTextField)) continue;
    const name = f.getName();
    const label = nameToLabel(name) || name;
    const key = fieldForLabel(label);
    items.push({ kind: "pdf_field", name, field: key ?? `ask:${label}`, label, sure: !!key });
  }
  return items;
}

/** Info for the spot editor: page count and sizes. */
export async function pdfInfo(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let fields = 0;
  try {
    fields = doc.getForm().getFields().length;
  } catch {
    fields = 0;
  }
  return { pages: doc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() })), fields };
}

/** Keeps only characters the standard Helvetica font can draw (accents and ñ are fine). */
function safeText(font: PDFFont, text: string) {
  const ok = new Set(font.getCharacterSet());
  const swap: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "✓": "x", " ": " " };
  return [...text].map((ch) => (ch === "\n" || ok.has(ch.codePointAt(0)!) ? ch : swap[ch] ?? "?")).join("");
}

function wrap(font: PDFFont, size: number, text: string, width: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function fillPdf(bytes: Uint8Array, items: MapItem[], v: Values, report: FillReport): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fieldItems = items.filter((it) => it.kind === "pdf_field" && it.field) as Extract<MapItem, { kind: "pdf_field" }>[];
  if (fieldItems.length) {
    const form = doc.getForm();
    for (const it of fieldItems) {
      const val = valueFor(v, it.field!);
      if (!val) {
        if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
        continue;
      }
      try {
        const tf = form.getTextField(it.name);
        const max = tf.getMaxLength();
        let text = safeText(font, val);
        if (!tf.isMultiline()) text = text.replace(/\s*\n\s*/g, "; ");
        if (max !== undefined) text = text.slice(0, max);
        tf.setText(text);
        report.filled++;
      } catch {
        if (!report.skipped.includes(it.label)) report.skipped.push(it.label);
      }
    }
    try {
      form.updateFieldAppearances(font);
    } catch {
      /* a form with odd fonts keeps the viewer's own appearance */
    }
  }
  const pages = doc.getPages();
  for (const it of items) {
    if (it.kind !== "pdf_spot" || !it.field) continue;
    const page = pages[it.page - 1];
    const val = valueFor(v, it.field);
    if (!page || !val) {
      if (!val && !report.skipped.includes(it.label)) report.skipped.push(it.label);
      continue;
    }
    const { width, height } = page.getSize();
    const x = (it.x / 100) * width;
    const top = height - (it.y / 100) * height;
    const lines = wrap(font, it.size, safeText(font, val), Math.max(40, width - x - width * 0.05));
    lines.forEach((line, i) => {
      page.drawText(line, { x, y: top - it.size * (1 + i * 1.25), size: it.size, font, color: rgb(0.08, 0.1, 0.2) });
    });
    report.filled++;
  }
  return doc.save();
}

/** A copy of the PDF with a 10% grid and the spots drawn on it, so the spots can be placed by eye. */
export async function pdfGrid(bytes: Uint8Array, spots: Extract<MapItem, { kind: "pdf_spot" }>[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((page, pi) => {
    const { width, height } = page.getSize();
    const grid = rgb(0.18, 0.23, 0.56);
    for (let i = 1; i < 10; i++) {
      const x = (i / 10) * width;
      const y = height - (i / 10) * height;
      page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: i === 5 ? 0.8 : 0.4, color: grid, opacity: 0.35 });
      page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: i === 5 ? 0.8 : 0.4, color: grid, opacity: 0.35 });
      page.drawText(`${i * 10}`, { x: x + 2, y: height - 9, size: 7, font, color: grid, opacity: 0.8 });
      page.drawText(`${i * 10}`, { x: 2, y: y + 2, size: 7, font, color: grid, opacity: 0.8 });
    }
    for (const s of spots.filter((s) => s.page === pi + 1)) {
      const x = (s.x / 100) * width;
      const top = height - (s.y / 100) * height;
      page.drawRectangle({ x, y: top - s.size * 1.2, width: Math.min(width - x, 160), height: s.size * 1.2, color: rgb(1, 0.85, 0.2), opacity: 0.45, borderColor: rgb(0.85, 0.55, 0), borderWidth: 0.6 });
      page.drawText(safeText(font, s.label).slice(0, 40), { x: x + 2, y: top - s.size, size: Math.min(s.size, 10), font, color: rgb(0.3, 0.2, 0) });
    }
  });
  return doc.save();
}
