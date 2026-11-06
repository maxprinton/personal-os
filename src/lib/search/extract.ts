// Search engine — a note → the pieces of text the index keeps ("chunks"). Pure (no server).
// Reads the editor's Markdown dialect (Notion-style tags) and keeps only words people wrote:
// title, headings, text, lists, toggles, callouts, columns, tables, code, equations, links, mentions,
// media captions / file names, bookmarks, buttons and properties. Markup, colors and ids are dropped.
import { parseAttrs } from "@/lib/editor/tags";
import { plainNumbers, splitIdentifiers } from "@/lib/search/core";

export type ChunkKind = "title" | "heading" | "text" | "code" | "table" | "props" | "media" | "file";
export type Chunk = { kind: ChunkKind; weight: "A" | "B" | "C"; label: string | null; anchor: string | null; body: string; extra: string };
/** A file attached in the note (to read its text later). */
export type FileRef = { path: string; name: string };

export const MAX_CHUNK = 1800;
const FILE_PREFIX = "/api/files/";

const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** "/api/files/u1/abc%20d.pdf" → "u1/abc d.pdf" (null when it isn't one of your uploaded files). */
export function filePathOf(src: string | undefined | null): string | null {
  if (!src) return null;
  const s = src.trim();
  const at = s.indexOf(FILE_PREFIX);
  if (at < 0) return null;
  const rest = s.slice(at + FILE_PREFIX.length).split(/[?#]/)[0];
  try {
    const p = rest.split("/").map((x) => decodeURIComponent(x)).join("/");
    return p || null;
  } catch {
    return rest || null;
  }
}

const baseName = (p: string) => p.split("/").pop() ?? p;

/** URL → searchable words (domain + path), e.g. "https://docs.google.com/a/b" → "docs google com a b". */
function urlWords(u: string): string {
  if (!u || u.startsWith(FILE_PREFIX)) return "";
  try {
    const x = new URL(u, "https://x.invalid");
    if (x.hostname === "x.invalid") return decodeURIComponent(x.pathname).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return `${x.hostname} ${decodeURIComponent(x.pathname)}`.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  } catch {
    return u.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }
}

function dateWords(start?: string, end?: string): string {
  const one = (s?: string) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s ?? "";
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const en = dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const es = dt.toLocaleDateString("es-ES", { month: "long", timeZone: "UTC" });
    return `${en} ${es} ${s.slice(0, 10)}`;
  };
  return [one(start), end ? one(end) : ""].filter(Boolean).join(" ");
}

type Inline = { text: string; extra: string[]; files: FileRef[] };

/** One line of Markdown → plain words (+ hidden words for the index, + files it points to). */
export function cleanInline(line: string): Inline {
  const extra: string[] = [];
  const files: FileRef[] = [];
  let s = line;
  s = s.replace(/<mention-page\b[^>]*>([\s\S]*?)<\/mention-page>/gi, (_m, t: string) => ` ${unesc(t)} `);
  s = s.replace(/<mention-date\b([^>]*?)\/?>(?:<\/mention-date>)?/gi, (_m, a: string) => {
    const at = parseAttrs(a);
    return ` ${dateWords(at.start, at.end)} `;
  });
  s = s.replace(/<mention-link\b([^>]*)>([\s\S]*?)<\/mention-link>/gi, (_m, a: string, t: string) => {
    const url = parseAttrs(a).url ?? "";
    extra.push(urlWords(url));
    return ` ${unesc(t)} `;
  });
  s = s.replace(/<\/?span\b[^>]*>/gi, "");
  s = s.replace(/[ \t]*\{(?:\s*[\w-]+="[^"]*")+\s*\}[ \t]*$/, ""); // {color="red"} {id="…"} at the end
  // Images: caption + file name
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_m, cap: string, src: string) => {
    const p = filePathOf(src);
    const name = p ? baseName(p) : "";
    if (p) files.push({ path: p, name });
    return ` ${cap} ${name.replace(/[._-]+/g, " ")} `;
  });
  // Links: the text stays, the address becomes hidden searchable words
  s = s.replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_m, t: string, url: string) => {
    const p = filePathOf(url);
    if (p) files.push({ path: p, name: baseName(p) });
    else extra.push(urlWords(url));
    return ` ${t} `;
  });
  // Bare URLs: keep them visible, and searchable as words
  for (const m of s.matchAll(/https?:\/\/[^\s<>()]+/g)) extra.push(urlWords(m[0]));
  // Equations $…$ / $$…$$: keep the TeX, words without backslashes
  s = s.replace(/\$\$?([^$]+)\$\$?/g, (_m, tex: string) => ` ${tex.replace(/\\/g, " ")} `);
  // Marks and list markers
  s = s
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)]|[a-z][.)]|[ivx]+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/(\*\*|__|~~|==|\+\+)/g, "")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<br\s*\/?>/gi, " ");
  return { text: unesc(s).replace(/[ \t]+/g, " ").trim(), extra: extra.filter(Boolean), files };
}

const SKIP_TAG = /^<\/?(callout|columns|column|details|table_of_contents|breadcrumb)\b[^>]*\/?>\s*$/i;
const MEDIA = /^<(video|audio|file|pdf|embed)\b([^>]*)>([\s\S]*?)<\/\1>\s*$/i;

export type NoteForSearch = {
  title: string;
  blockName?: string | null;
  seq?: number | null;
  content: string;
  /** "Type: Idea", "Tags: work, ielts"… (the note's properties as text). */
  props?: string[];
};

/** A note → its chunks (in order) and the files it holds. */
export function noteToChunks(note: NoteForSearch): { chunks: Chunk[]; files: FileRef[] } {
  const chunks: Chunk[] = [];
  const files = new Map<string, FileRef>();
  const addFile = (f: FileRef) => {
    if (!files.has(f.path)) files.set(f.path, f);
  };

  // Title (+ block name + NOTE-12)
  const titleBits = [note.title?.trim(), note.blockName?.trim(), note.seq ? `NOTE-${note.seq}` : ""].filter(Boolean) as string[];
  if (titleBits.length) chunks.push({ kind: "title", weight: "A", label: null, anchor: null, body: titleBits.join(" · "), extra: note.seq ? `note${note.seq} ${note.seq}` : "" });

  // Properties
  const props = (note.props ?? []).map((l) => l.trim()).filter(Boolean);
  if (props.length) chunks.push({ kind: "props", weight: "B", label: "Properties", anchor: null, body: props.join("\n"), extra: plainNumbers(props.join(" ")) });

  let anchor: string | null = null;
  let buf: string[] = [];
  let bufExtra: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) chunks.push({ kind: "text", weight: "C", label: null, anchor, body, extra: [...bufExtra, plainNumbers(body)].filter(Boolean).join(" ") });
    buf = [];
    bufExtra = [];
  };
  const push = (text: string, extra: string[] = []) => {
    if (!text && !extra.length) return;
    if (buf.join("\n").length + text.length > MAX_CHUNK) flush();
    // A single line longer than a chunk is cut in pieces
    for (let i = 0; i < Math.max(1, text.length); i += MAX_CHUNK) {
      buf.push(text.slice(i, i + MAX_CHUNK));
      if (i + MAX_CHUNK < text.length) flush();
    }
    bufExtra.push(...extra);
  };
  const special = (c: Chunk) => {
    flush();
    if (c.body.length <= MAX_CHUNK) chunks.push(c);
    else for (let i = 0; i < c.body.length; i += MAX_CHUNK) chunks.push({ ...c, body: c.body.slice(i, i + MAX_CHUNK), extra: i === 0 ? c.extra : "" });
  };

  const lines = (note.content ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code block (```lang … ```): the code as written, plus split identifiers
    const fence = /^\s*(```+|~~~+)\s*([\w#+.-]*)/.exec(line);
    if (fence) {
      const close = fence[1];
      const lang = fence[2] || null;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) code.push(lines[i++]);
      i++;
      const body = code.join("\n").replace(/\s+$/, "");
      if (body || lang) special({ kind: "code", weight: "C", label: lang && lang !== "plaintext" && lang !== "text" ? lang : "Plain text", anchor, body, extra: [lang ?? "", splitIdentifiers(body), plainNumbers(body)].filter(Boolean).join(" ") });
      continue;
    }

    // Table (| a | b |): every cell; the header row also as a heading-weight chunk
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      let header: string | null = null;
      const extras: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const row = lines[i++];
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes("-")) continue; // |---|---|
        const cells = row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map((c) => cleanInline(c.trim()));
        for (const c of cells) {
          extras.push(...c.extra);
          c.files.forEach(addFile);
        }
        const text = cells.map((c) => c.text).filter(Boolean).join(" · ");
        if (header === null) header = text;
        if (text) rows.push(text);
      }
      if (rows.length) special({ kind: "table", weight: "C", label: "Table", anchor, body: rows.join("\n"), extra: [header ?? "", ...extras, plainNumbers(rows.join(" "))].filter(Boolean).join(" ") });
      continue;
    }

    // Headings (# … ####) and toggle titles (<summary>)
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line) ?? /^\s*<summary>([\s\S]*?)<\/summary>\s*$/i.exec(line);
    if (h) {
      flush();
      const c = cleanInline(h[1]);
      c.files.forEach(addFile);
      if (c.text) {
        anchor = c.text.slice(0, 200);
        chunks.push({ kind: "heading", weight: "B", label: null, anchor, body: c.text, extra: c.extra.join(" ") });
      }
      i++;
      continue;
    }

    // Video / audio / file / PDF / embed: caption + file name (+ the file, to read it later)
    const media = MEDIA.exec(line.trim());
    if (media) {
      const a = parseAttrs(media[2]);
      const p = filePathOf(a.src);
      const name = a.name || (p ? baseName(p) : "");
      if (p && (media[1] === "file" || media[1] === "pdf")) addFile({ path: p, name: name || baseName(p) });
      const caption = cleanInline(unesc(media[3] ?? "")).text;
      const body = [caption, name].filter(Boolean).join(" · ");
      if (body || a.src) special({ kind: "media", weight: "B", label: name || media[1], anchor, body: body || media[1], extra: [name.replace(/[._-]+/g, " "), p ? "" : urlWords(a.src ?? "")].filter(Boolean).join(" ") });
      i++;
      continue;
    }

    // Bookmark: title, description, address
    const bm = /^\s*<bookmark\b([^>]*)\/?>(?:<\/bookmark>)?\s*$/i.exec(line);
    if (bm) {
      const a = parseAttrs(bm[1]);
      push([a.title, a.description].filter(Boolean).map((x) => unesc(x as string)).join(" — ") || (a.url ?? ""), [urlWords(a.url ?? "")]);
      i++;
      continue;
    }

    // Sub-page / link to page: its title
    const pg = /^\s*<page\b[^>]*>([\s\S]*?)<\/page>\s*$/i.exec(line);
    if (pg) {
      push(unesc(pg[1]));
      i++;
      continue;
    }

    // Button: its label (the blocks inside are read as normal lines)
    const btn = /^\s*<button\b([^>]*)>\s*$/i.exec(line);
    if (btn) {
      push(unesc(parseAttrs(btn[1]).label ?? ""));
      i++;
      continue;
    }
    if (/^\s*<\/button>\s*$/i.test(line) || SKIP_TAG.test(line.trim())) {
      i++;
      continue;
    }
    // A container tag with text on the same line (<callout icon="💡">Text): drop the tag, keep the text
    const stripped = line.replace(/^\s*<(callout|column|columns|details)\b[^>]*>/i, "").replace(/<\/(callout|column|columns|details)>\s*$/i, "");
    if (/^\s*(---|\*\*\*|___)\s*$/.test(stripped)) {
      i++;
      continue;
    }
    const c = cleanInline(stripped);
    c.files.forEach(addFile);
    push(c.text, c.extra);
    i++;
  }
  flush();
  return { chunks, files: [...files.values()] };
}

/** Which attached files have text worth reading (others are only searchable by name). */
export function readableFile(name: string): boolean {
  return /\.(pdf|docx|pptx|xlsx|txt|text|md|markdown|csv|tsv|json|js|jsx|ts|tsx|py|rb|go|rs|java|c|h|cpp|cs|php|html|htm|css|scss|xml|yml|yaml|toml|ini|log|sh|bat|ps1|sql|srt|vtt)$/i.test(name);
}
