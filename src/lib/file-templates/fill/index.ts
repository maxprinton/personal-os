// Template Manager, phase 3 — the fill engine's front door: which files can be filled, find their blanks, fill them.
// Server only (zip reading uses node:zlib; PDFs use pdf-lib).
import type { Values } from "../fields";
import type { FillReport, MapItem } from "./common";
import { fillDocx, scanDocx } from "./docx";
import { fillPdf, scanPdf } from "./pdf";
import { fillPptx, scanPptx } from "./pptx";
import { fillTextFile, scanTextFile, textKindOf } from "./text";
import { fillXlsx, scanXlsx } from "./xlsx";

export type FillKind = "docx" | "xlsx" | "pptx" | "pdf" | "md" | "txt" | "csv" | "mmd";

export function fillKindOf(name: string): FillKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx" || ext === "xlsx" || ext === "pptx" || ext === "pdf") return ext;
  if (ext === "docm" || ext === "dotx") return "docx";
  if (ext === "xlsm" || ext === "xltx") return "xlsx";
  return textKindOf(name);
}

const dec = new TextDecoder();
const enc = new TextEncoder();

/** Every blank the file has, with a suggested field for each. Throws when the file can't be read. */
export async function scanFile(name: string, bytes: Uint8Array): Promise<MapItem[]> {
  const kind = fillKindOf(name);
  const items =
    kind === "docx" ? scanDocx(bytes)
    : kind === "xlsx" ? scanXlsx(bytes)
    : kind === "pptx" ? scanPptx(bytes)
    : kind === "pdf" ? await scanPdf(bytes)
    : kind ? scanTextFile(dec.decode(bytes), kind)
    : [];
  // A file written with {{field}} blanks (like the generated library) uses them for every blank: other brackets in it
  // are just text ("<cause> → <effect>"), so unknown ones are dropped.
  if (items.some((it) => it.kind === "token" && it.token.startsWith("{{"))) return items.filter((it) => it.kind !== "token" || it.token.startsWith("{{") || it.sure);
  return items;
}

/** The file with its blanks filled (only the confirmed items with a field). */
export async function fillFile(name: string, bytes: Uint8Array, items: MapItem[], v: Values, report: FillReport): Promise<Uint8Array> {
  const kind = fillKindOf(name);
  const use = items.filter((it) => it.field);
  if (kind === "docx") return fillDocx(bytes, use, v, report);
  if (kind === "xlsx") return fillXlsx(bytes, use, v, report);
  if (kind === "pptx") return fillPptx(bytes, use, v, report);
  if (kind === "pdf") return fillPdf(bytes, use, v, report);
  if (kind) return enc.encode(fillTextFile(dec.decode(bytes), kind, use, v, report));
  return bytes;
}

export type { FillReport, MapItem } from "./common";
