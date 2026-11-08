// Portfolio publishing — copies the files a page uses from the private "note-files" bucket to the public "portfolio-media"
// bucket. Names the copy by content hash (same file twice = stored once) and strips camera/GPS metadata without re-encoding.
import { createHash } from "node:crypto";
import type { MediaRef } from "./render";

export const MEDIA_MAX = 10 * 1024 * 1024;
/** Audio and ZIP files may be bigger (podcasts, bundles). */
export const MEDIA_MAX_LARGE = 25 * 1024 * 1024;
export const maxBytesFor = (kind: string) => (kind === "audio" || kind === "archive" ? MEDIA_MAX_LARGE : MEDIA_MAX);
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** What the engine needs from storage (the real one is in storage.ts; tests use a fake). */
export interface MediaStore {
  /** public URL prefix of the bucket, ending with "/" */
  publicBase: string;
  download(privateKey: string): Promise<Uint8Array | null>;
  exists(publicPath: string): Promise<boolean>;
  upload(publicPath: string, bytes: Uint8Array, type: string): Promise<boolean>;
  list(folder: string): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
}

// ——— which file is it? (by content, not by name) ———
export function sniffType(b: Uint8Array): MediaType | "image/avif" | null {
  const s = (i: number, str: string) => [...str].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && s(1, "PNG\r\n")) return "image/png";
  if (b.length > 6 && s(0, "GIF8")) return "image/gif";
  if (b.length > 12 && s(0, "RIFF") && s(8, "WEBP")) return "image/webp";
  if (b.length > 12 && s(4, "ftyp") && (s(8, "avif") || s(8, "avis"))) return "image/avif";
  if (b.length > 5 && s(0, "%PDF-")) return "application/pdf";
  return null;
}

// ——— every format the public site accepts ———
export type MediaKind = "image" | "audio" | "document" | "text" | "archive";
/** `keeps`: the file may still carry author / camera info we can't remove without re-encoding it. `unsafe`: refuse it. */
export interface Detected { type: string; ext: string; kind: MediaKind; keeps?: "metadata" | "archive"; unsafe?: boolean }

const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const ODF: Record<string, [string, string]> = {
  text: ["application/vnd.oasis.opendocument.text", ".odt"],
  spreadsheet: ["application/vnd.oasis.opendocument.spreadsheet", ".ods"],
  presentation: ["application/vnd.oasis.opendocument.presentation", ".odp"],
};
// HTML is stored as text/plain on purpose: from the public bucket it can be read but never runs scripts.
const TEXT: Record<string, string> = { txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json", html: "text/plain", htm: "text/plain" };

const latin1 = (b: Uint8Array, from: number, to: number) => {
  let o = "";
  for (let i = from; i < Math.min(to, b.length); i++) o += String.fromCharCode(b[i]);
  return o;
};
const utf8 = (b: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return null;
  }
};
const hasText = (b: Uint8Array, needle: string) => Buffer.from(b.buffer, b.byteOffset, b.length).includes(needle);

/** Things an SVG must not contain: scripts, event handlers, outside links. null = looks fine. */
export function svgIssue(text: string): string | null {
  if (!/<svg[\s>/]/i.test(text)) return "no <svg>";
  const bad: [RegExp, string][] = [
    [/<\s*script/i, "script"],
    [/<\s*(foreignObject|iframe|embed|object)/i, "embedded content"],
    [/\son[a-z]+\s*=/i, "event handler"],
    [/javascript:/i, "javascript: link"],
    [/<!ENTITY|<!DOCTYPE[^>]*\[/i, "entity"],
    [/(?:xlink:)?href\s*=\s*["'](?!#|data:image\/(?:png|jpe?g|gif|webp);)/i, "outside link"],
    [/@import|url\(\s*["']?(?!#|data:image\/)/i, "outside link"],
  ];
  for (const [re, why] of bad) if (re.test(text)) return why;
  return null;
}

/** What is this file? Pictures and PDFs are recognised by their content; Office / ZIP / audio by content + extension; text by extension + being valid. */
export function detectMedia(b: Uint8Array, name: string): Detected | null {
  const m = sniffType(b);
  if (m === "application/pdf") return { type: m, ext: ".pdf", kind: "document" };
  if (m === "image/avif") return { type: m, ext: ".avif", kind: "image", keeps: "metadata" };
  if (m) return { type: m, ext: EXT[m], kind: "image" };
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? "").toLowerCase();

  if (b.length > 30 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) {
    const head = latin1(b, 0, 4096);
    const odf = /mimetypeapplication\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)/.exec(head);
    if (odf) {
      const [type, e] = ODF[odf[1]];
      return { type, ext: e, kind: "document", keeps: "metadata" };
    }
    if (OOXML[ext] && head.includes("[Content_Types].xml")) return { type: OOXML[ext], ext: "." + ext, kind: "document", keeps: "metadata", unsafe: hasText(b, "vbaProject.bin") || undefined };
    if (ext === "zip") return { type: "application/zip", ext: ".zip", kind: "archive", keeps: "archive" };
    return null;
  }
  if (ext === "mp3" && b.length > 4 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return { type: "audio/mpeg", ext: ".mp3", kind: "audio", keeps: "metadata" };
  if (ext === "m4a" && b.length > 12 && latin1(b, 4, 8) === "ftyp") return { type: "audio/mp4", ext: ".m4a", kind: "audio", keeps: "metadata" };

  if (ext === "svg" || TEXT[ext]) {
    if (b.subarray(0, 8192).includes(0)) return null;
    const text = utf8(b);
    if (text === null) return null;
    if (ext === "svg") {
      if (!/<svg[\s>/]/i.test(text)) return null;
      return { type: "image/svg+xml", ext: ".svg", kind: "image", unsafe: svgIssue(text) ? true : undefined };
    }
    if (ext === "json") {
      try {
        JSON.parse(text.replace(/^\uFEFF/, ""));
      } catch {
        return null;
      }
    }
    return { type: TEXT[ext], ext: ext === "htm" ? ".html" : "." + ext, kind: "text" };
  }
  return null;
}

// ——— metadata stripping (no re-encode) ———
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

/** EXIF orientation (1–8) of a JPEG APP1 payload, or 1. Browsers use it to show phone photos upright. */
function exifOrientation(p: Uint8Array): number {
  if (p.length < 20 || String.fromCharCode(...p.slice(0, 4)) !== "Exif") return 1;
  const t = 6;
  const le = p[t] === 0x49;
  const r16 = (i: number) => (le ? p[t + i] | (p[t + i + 1] << 8) : (p[t + i] << 8) | p[t + i + 1]);
  const r32 = (i: number) => (le ? (p[t + i] | (p[t + i + 1] << 8) | (p[t + i + 2] << 16) | (p[t + i + 3] << 24)) >>> 0 : u32(p, t + i));
  const ifd = r32(4);
  if (ifd + 2 > p.length - t) return 1;
  const n = r16(ifd);
  for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= p.length - t; k++) {
    const e = ifd + 2 + k * 12;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}
/** A tiny EXIF block that holds only the orientation. */
function orientationOnly(o: number): Uint8Array {
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0xff, 0xe1, 0, body.length + 2, ...body]);
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.slice(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error("bad jpeg");
    const m = b[i + 1];
    if (m === 0xff) (i += 1);
    else if (m === 0xda || m === 0xd9) {
      parts.push(b.slice(i));
      return concat(parts);
    } else if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      parts.push(b.slice(i, i + 2));
      i += 2;
    } else {
      const len = u16(b, i + 2);
      if (len < 2 || i + 2 + len > b.length) throw new Error("bad jpeg");
      const seg = b.slice(i, i + 2 + len);
      if (m === 0xe1) {
        const o = exifOrientation(seg.slice(4));
        if (o > 1) parts.push(orientationOnly(o));
      } else if (m === 0xe0 || m === 0xe2 || m === 0xee || (m >= 0xc0 && m <= 0xcf) || m === 0xdb || m === 0xc4 || m === 0xdd || m === 0xdc) parts.push(seg);
      // everything else (other APPn, comments) is dropped
      i += 2 + len;
    }
  }
  throw new Error("bad jpeg");
}

function stripPng(b: Uint8Array): Uint8Array {
  const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
  const parts: Uint8Array[] = [b.slice(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32(b, i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) throw new Error("bad png");
    if (!drop.has(type)) parts.push(b.slice(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  throw new Error("bad png");
}

function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const end = i + 8 + len + (len % 2);
    if (end > b.length + 1) throw new Error("bad webp");
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === "VP8X" && chunk.length > 8) chunk[8] &= ~0x0c; // EXIF + XMP flags off
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(b.slice(0, 12), 0);
  const size = out.length - 8;
  out[4] = size & 255;
  out[5] = (size >> 8) & 255;
  out[6] = (size >> 16) & 255;
  out[7] = (size >> 24) & 255;
  out.set(body, 12);
  return out;
}

function stripGif(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  parts.push(b.slice(0, i));
  const skipBlocks = (j: number) => {
    while (j < b.length && b[j] !== 0) j += b[j] + 1;
    return j + 1;
  };
  while (i < b.length) {
    if (b[i] === 0x3b) {
      parts.push(b.slice(i, i + 1));
      return concat(parts);
    }
    if (b[i] === 0x21) {
      const end = skipBlocks(i + 2);
      if (b[i + 1] !== 0xfe) parts.push(b.slice(i, end)); // drop comments
      i = end;
    } else if (b[i] === 0x2c) {
      let j = i + 10;
      if (b[i + 9] & 0x80) j += 3 * (1 << ((b[i + 9] & 7) + 1));
      const end = skipBlocks(j + 1);
      parts.push(b.slice(i, end));
      i = end;
    } else throw new Error("bad gif");
  }
  throw new Error("bad gif");
}

/** Same picture, without camera / GPS / text metadata. Throws if the file is damaged. SVG loses comments and <metadata>. PDFs, audio, Office files, text and ZIPs are copied as they are (see `keeps`). */
export function stripMetadata(bytes: Uint8Array, type: string): Uint8Array {
  if (type === "image/svg+xml") {
    const t = utf8(bytes) ?? "";
    return new TextEncoder().encode(t.replace(/<!--[\s\S]*?-->/g, "").replace(/<metadata[\s\S]*?<\/metadata>/gi, "").replace(/<\?xml-stylesheet[^>]*\?>/gi, ""));
  }
  if (type === "image/jpeg") return stripJpeg(bytes);
  if (type === "image/png") return stripPng(bytes);
  if (type === "image/webp") return stripWebp(bytes);
  if (type === "image/gif") return stripGif(bytes);
  return bytes;
}

// ——— copy ———
export type MediaFailure = { src: string; reason: "missing" | "too_big" | "type" | "unsafe" | "failed" };
export type Unstripped = { src: string; name: string; why: "metadata" | "archive" };
export type CopyResult = { urls: Map<string, string>; paths: Map<string, string>; failed: MediaFailure[]; copied: number; unstripped: Unstripped[] };

const decodeKey = (src: string) => src.replace(/^\/api\/files\//, "").split("/").map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join("/");
const safeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-80) || "file";
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf" };

export async function copyMedia(store: MediaStore, userId: string, slotId: string, refs: MediaRef[]): Promise<CopyResult> {
  const res: CopyResult = { urls: new Map(), paths: new Map(), failed: [], copied: 0, unstripped: [] };
  for (const ref of refs) {
    if (res.urls.has(ref.src)) continue;
    const fail = (reason: MediaFailure["reason"]) => void res.failed.push({ src: ref.src, reason });
    const key = decodeKey(ref.src);
    if (!key.startsWith(`${userId}/`) || key.includes("..")) {
      fail("missing");
      continue;
    }
    try {
      const raw = await store.download(key);
      if (!raw) fail("missing");
      else if (raw.length > MEDIA_MAX_LARGE) fail("too_big");
      else {
        const base = key.split("/").pop() ?? "file";
        const det = detectMedia(raw, base);
        if (!det) fail(raw.length > MEDIA_MAX ? "too_big" : "type");
        else if (det.unsafe) fail("unsafe");
        else if ((ref.kind === "image" && det.kind !== "image") || (ref.kind === "audio" && det.kind !== "audio")) fail("type");
        else {
          const type = det.type;
          const out = stripMetadata(raw, type);
          if (out.length > maxBytesFor(det.kind)) fail("too_big");
          else {
            const hash = createHash("sha256").update(out).digest("hex").slice(0, 16);
            let name = safeName(base.replace(/^[0-9a-f]{8}-/, ""));
            if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += det.ext;
            const dest = `${slotId}/${hash}-${name}`;
            if (!(await store.exists(dest))) {
              if (!(await store.upload(dest, out, type))) {
                fail("failed");
                continue;
              }
              res.copied++;
            }
            if (det.keeps) res.unstripped.push({ src: ref.src, name, why: det.keeps });
            res.urls.set(ref.src, store.publicBase + dest);
            res.paths.set(ref.src, dest);
          }
        }
      }
    } catch {
      fail("failed");
    }
  }
  return res;
}

/** The files of a slot's folder that none of the given texts mention. */
export async function unusedMedia(store: MediaStore, slotId: string, usedTexts: string[]): Promise<string[]> {
  const all = await store.list(slotId);
  const used = usedTexts.join("\n");
  return all.filter((p) => !used.includes(p));
}
export async function removeUnused(store: MediaStore, slotId: string, usedTexts: string[]): Promise<number> {
  const gone = await unusedMedia(store, slotId, usedTexts);
  if (gone.length) await store.remove(gone);
  return gone.length;
}
