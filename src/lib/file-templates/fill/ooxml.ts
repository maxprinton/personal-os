// Template Manager, phase 3 — small helpers for Office files (.docx .xlsx .pptx are zips of XML).
// Server only: reading the zip uses node:zlib (same reader as the Teaching Excel report).
import { readZip } from "@/lib/xlsx-fill";
import { createZip, type ZipEntry } from "@/lib/zip";

export type Parts = { order: string[]; files: Map<string, Uint8Array> };

const dec = new TextDecoder();
const enc = new TextEncoder();

export function openZip(bytes: Uint8Array): Parts {
  const entries = readZip(bytes);
  return { order: entries.map((e) => e.name), files: new Map(entries.map((e) => [e.name, typeof e.content === "string" ? enc.encode(e.content) : e.content])) };
}

export function readPart(p: Parts, name: string): string | null {
  const b = p.files.get(name);
  return b ? dec.decode(b) : null;
}

export function writePart(p: Parts, name: string, xml: string) {
  if (!p.files.has(name)) p.order.push(name);
  p.files.set(name, enc.encode(xml));
}

export function saveZip(p: Parts): Uint8Array {
  const out: ZipEntry[] = p.order.filter((n) => p.files.has(n)).map((n) => ({ name: n, content: p.files.get(n)! }));
  return createZip(out);
}

/** Start/end offsets of every `<tag>…</tag>` that is not inside another element of the same tag. */
export function topLevel(xml: string, tag: string): [number, number][] {
  const re = new RegExp(`<${tag}(?=[\\s>/])[^>]*?(/?)>|</${tag}>`, "g");
  const out: [number, number][] = [];
  let depth = 0;
  let start = -1;
  for (const m of xml.matchAll(re)) {
    const i = m.index ?? 0;
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push([start, i + m[0].length]);
        start = -1;
      }
    } else if (m[1] === "/") {
      if (depth === 0) out.push([i, i + m[0].length]);
    } else {
      if (depth === 0) start = i;
      depth++;
    }
  }
  return out;
}

/** Replaces ranges (from topLevel) with new strings, keeping everything else byte for byte. */
export function spliceRanges(xml: string, ranges: [number, number][], repl: (i: number, part: string) => string | null) {
  let out = "";
  let last = 0;
  ranges.forEach(([a, b], i) => {
    const r = repl(i, xml.slice(a, b));
    out += xml.slice(last, a) + (r ?? xml.slice(a, b));
    last = b;
  });
  return out + xml.slice(last);
}
