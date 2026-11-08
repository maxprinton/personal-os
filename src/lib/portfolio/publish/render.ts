// Portfolio publishing — renders the Markdown of a note (the editor's dialect, Notion-style tags) to HTML for the public site.
// Pure: no database, no network. The caller gives it the lookups it needs (public link of a note, public URL of a media file).
// Two passes by the engine: 1) without ctx.media → collects the files used  2) with ctx.media → final HTML.
// The output always goes through the sanitizer, so it is safe by construction.
import { Marked, type Tokens } from "marked";
import katex from "katex";
import { common, createLowlight } from "lowlight";
import { matchBlockTag, parseAttrs, dedent, unescAttr, type Attrs } from "@/lib/editor/tags";
import { normalizeColor } from "@/lib/editor/colors";
import { sanitizeHtml, escapeText, escapeAttr, safeUrl, htmlToText, type SanitizeReport } from "./sanitize";
import { Warnings, type Warning } from "./warnings";

export type RenderCtx = {
  /** "en" | "es": used to write dates. */
  lang?: string;
  /** Public path of a note ("/projects/x") if it is published in this language, else null. */
  noteLink?: (noteId: string) => string | null;
  /** Public URL of a private media file ("/api/files/…"). Not given on the first pass. */
  media?: (src: string) => string | null;
  /** Host names of the private OS: links to them are removed. */
  osHosts?: string[];
};
export type MediaRef = { src: string; kind: "image" | "file" | "audio" };
export type TocItem = { level: number; id: string; text: string };
export type RenderResult = { html: string; toc: TocItem[]; warnings: Warning[]; media: MediaRef[]; hasToc: boolean; sanitize: SanitizeReport };

const PH_OPEN = "";
const PH_CLOSE = "";
const MK_OPEN = "";
const MK_CLOSE = "";
const MAX_DEPTH = 6;
const NOTE_RE = /^(?:https?:\/\/[^/]+)?\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#].*)?$/i;
const BLOCK_TAGS = new Set(["callout", "columns", "details", "button", "table_of_contents", "page", "video", "audio", "file", "pdf", "embed", "bookmark", "empty-block"]);
const ATTRS = String.raw`((?:\s+[\w-]+(?:\s*=\s*"[^"]*")?)*)\s*`;
const MATH_RE = /(?<![$\\])\$(?!\$)(?=\S)((?:\\\$|[^$\n])*?\S)\$(?!\d)/g;
const SUFFIX_RE = /[ \t]*\{((?:\s*[\w-]+="[^"]*")+)\s*\}[ \t]*(?=\n|$)/g;

type State = {
  ctx: RenderCtx;
  w: Warnings;
  media: Map<string, MediaRef>;
  toc: TocItem[];
  ids: Map<string, number>;
  hasToc: boolean;
  ph: string[];
  marked: Marked;
};

const escCode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/\\(.)/g, "$1");
const cls = (color: string | null | undefined, base = "") => {
  const c = [base, color ? `n-color-${color}` : ""].filter(Boolean).join(" ");
  return c ? ` class="${c}"` : "";
};

// ——— placeholders (HTML we make ourselves travels through Markdown as one private character group) ———
const store = (st: State, html: string) => PH_OPEN + (st.ph.push(html) - 1) + PH_CLOSE;
const fill = (st: State, s: string) => s.replace(/(\d+)/g, (_, n) => st.ph[Number(n)] ?? "");

/** Runs fn on the parts of the text that are not code (fenced blocks and `inline code`). */
function mapOutsideCode(text: string, fn: (seg: string) => string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (!buf.length) return;
    out.push(
      buf
        .join("\n")
        .split(/(``[^\n]+?``|`[^`\n]+`)/)
        .map((p, i) => (i % 2 ? p : fn(p)))
        .join(""),
    );
    buf = [];
  };
  for (const line of lines) {
    if (fence) {
      out.push(line);
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      flush();
      fence = m[1];
      out.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.join("\n");
}

// ——— small renderers ———
function mathHtml(st: State, tex: string, display: boolean): string {
  try {
    const h = katex.renderToString(tex, { displayMode: display, output: "html", throwOnError: true, strict: "ignore", trust: false });
    return display ? `<div class="n-math">${h}</div>\n` : h;
  } catch {
    st.w.add("math_error", tex.slice(0, 40));
    return display ? `<pre class="n-math-error"><code>${escCode(tex)}</code></pre>\n` : `<code>${escCode(tex)}</code>`;
  }
}

const lowlight = createLowlight(common);
type Hast = { type: string; value?: string; tagName?: string; properties?: { className?: string[] | string }; children?: Hast[] };
function hast(n: Hast): string {
  if (n.type === "text") return escCode(n.value ?? "");
  const inner = (n.children ?? []).map(hast).join("");
  if (n.type !== "element" || n.tagName !== "span") return inner;
  const c = Array.isArray(n.properties?.className) ? n.properties!.className.join(" ") : "";
  return `<span${c ? ` class="${escapeAttr(c)}"` : ""}>${inner}</span>`;
}
function codeHtml(text: string, langRaw: string | undefined): string {
  const lang = (langRaw ?? "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
  const body = text.replace(/\n$/, "");
  if (lang && lowlight.registered(lang)) {
    try {
      return `<pre><code class="hljs language-${lang}">${hast(lowlight.highlight(lang, body) as unknown as Hast)}</code></pre>\n`;
    } catch {
      /* falls back to plain */
    }
  }
  return `<pre><code>${escCode(body)}</code></pre>\n`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
function isOsHost(st: State, host: string | null) {
  if (!host) return false;
  return host === "localhost" || host === "127.0.0.1" || (st.ctx.osHosts ?? []).some((h) => h.toLowerCase() === host);
}

function youtubeId(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i.exec(url.trim());
  return m ? m[1] : null;
}

/** Public URL (or the same path in pass 1) of an image/file. null = removed (a warning was added). */
function mapMedia(st: State, src: string, kind: "image" | "file" | "audio", label?: string): string | null {
  const s = src.trim();
  if (/^blob:/i.test(s)) return st.w.add("blob_upload", label), null;
  if (/^data:/i.test(s)) return st.w.add("data_url", label), null;
  let path: string | null = null;
  if (/^\/api\/files\//.test(s)) path = s;
  else if (/^https?:\/\//i.test(s)) {
    const host = hostOf(s);
    if (isOsHost(st, host)) {
      const m = /^https?:\/\/[^/]+(\/api\/files\/.+)$/i.exec(s);
      if (!m) return st.w.add("os_link", label), null;
      path = m[1];
    }
  } else return st.w.add(s.startsWith("/") ? "os_link" : "bad_link", label ?? s.slice(0, 40)), null;
  if (path) {
    if (!st.media.has(path)) st.media.set(path, { src: path, kind });
    if (!st.ctx.media) return path;
    const pub = st.ctx.media(path);
    if (!pub) return st.w.add("media_failed", label ?? path.split("/").pop()), null;
    return pub;
  }
  const ok = safeUrl(s, { imageOnly: kind === "image" });
  if (!ok) return st.w.add("bad_link", label ?? s.slice(0, 40)), null;
  if (kind === "image") st.w.add("external_image", hostOf(s) ?? undefined);
  return ok;
}

/** The address a link should have on the public site. null = leave only the text. */
function resolveLink(st: State, href: string, label: string): string | null {
  const h = href.trim();
  if (h.startsWith("#")) return h;
  const nm = NOTE_RE.exec(h);
  if (nm) {
    const p = st.ctx.noteLink?.(nm[1].toLowerCase());
    if (p) return p;
    st.w.add("private_link", label);
    return null;
  }
  if (/^\/api\/files\//.test(h) || (/^https?:\/\//i.test(h) && isOsHost(st, hostOf(h)) && /\/api\/files\//.test(h))) return mapMedia(st, h, "file", label);
  if (/^https?:\/\//i.test(h) && isOsHost(st, hostOf(h))) return st.w.add("os_link", label), null;
  if (h.startsWith("/")) return st.w.add("os_link", label), null;
  if (!/^(https?:|mailto:|tel:)/i.test(h)) return st.w.add("bad_link", label || h.slice(0, 40)), null;
  const ok = safeUrl(h);
  if (!ok) return st.w.add("bad_link", label || h.slice(0, 40)), null;
  return ok;
}

function mentionPage(st: State, a: Attrs, title: string): string {
  const id = NOTE_RE.exec(a.url ?? "")?.[1];
  const href = id ? st.ctx.noteLink?.(id.toLowerCase()) : null;
  if (href) return `<a href="${escapeAttr(href)}">${escapeText(title)}</a>`;
  st.w.add("private_link", title);
  return escapeText(title);
}
function mentionDate(st: State, a: Attrs): string {
  const f = (d: string) => {
    const dt = new Date(d.slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(+dt) ? d : dt.toLocaleDateString(st.ctx.lang ?? "en", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
  };
  if (!a.start) return "";
  const text = a.end ? `${f(a.start)} → ${f(a.end)}` : f(a.start);
  return `<time datetime="${escapeAttr(a.start.slice(0, 10))}">${escapeText(text)}</time>`;
}

function uniqueId(st: State, text: string) {
  const base = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";
  const n = (st.ids.get(base) ?? 0) + 1;
  st.ids.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}
const takeMarker = (html: string) => {
  const m = new RegExp(`${MK_OPEN}([a-z_]*)${MK_CLOSE}\\s*$`).exec(html);
  return m ? { html: html.slice(0, m.index), color: normalizeColor(m[1]) } : { html, color: null };
};
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ——— Markdown (the inline + simple block part) ———
function prepare(st: State, text: string): string {
  return mapOutsideCode(text, (seg) =>
    seg
      .replace(MATH_RE, (_, tex: string) => store(st, mathHtml(st, tex.replace(/\\\$/g, "$"), false)))
      .replace(new RegExp(`<mention-page${ATTRS}>([\\s\\S]*?)</mention-page>`, "gi"), (_, a: string, t: string) => store(st, mentionPage(st, parseAttrs(a), unescAttr(t))))
      .replace(new RegExp(`<mention-date${ATTRS}/?>(?:</mention-date>)?`, "gi"), (_, a: string) => store(st, mentionDate(st, parseAttrs(a))))
      .replace(new RegExp(`<span${ATTRS}>`, "gi"), (_, a: string) => {
        const c = normalizeColor(parseAttrs(a).color);
        return store(st, c ? `<span class="n-color-${c}">` : "<span>");
      })
      .replace(/<\/span\s*>/gi, () => store(st, "</span>"))
      .replace(/<(\/?)u\s*>/gi, (_, c: string) => store(st, c ? "</u>" : "<u>"))
      .replace(SUFFIX_RE, (_, a: string) => {
        const c = normalizeColor(parseAttrs(a).color);
        return c ? MK_OPEN + c + MK_CLOSE : "";
      }),
  );
}

function makeMarked(st: State): Marked {
  const m = new Marked({ gfm: true, breaks: true });
  m.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        const t = token.text.trim();
        if (/^<br\s*\/?>$/i.test(t)) return "<br>";
        if (/^<!--[\s\S]*-->$/.test(t) || /^<empty-block\s*\/?>$/i.test(t)) return "";
        st.w.add("raw_html", t.slice(0, 50));
        const e = escCode(token.text);
        return "block" in token && token.block ? `<p>${e}</p>\n` : e;
      },
      paragraph(token: Tokens.Paragraph) {
        const { html, color } = takeMarker(this.parser.parseInline(token.tokens));
        return `<p${cls(color)}>${html}</p>\n`;
      },
      heading(token: Tokens.Heading) {
        const { html, color } = takeMarker(fill(st, this.parser.parseInline(token.tokens)));
        const text = htmlToText(html).trim();
        const id = uniqueId(st, text);
        st.toc.push({ level: token.depth, id, text });
        return `<h${token.depth} id="${id}"${cls(color)}>${html}</h${token.depth}>\n`;
      },
      code(token: Tokens.Code) {
        return codeHtml(token.text, token.lang);
      },
      codespan(token: Tokens.Codespan) {
        return `<code>${escCode(token.text)}</code>`;
      },
      link(token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        const target = resolveLink(st, token.href, htmlToText(fill(st, inner)).slice(0, 60));
        if (target === null) return inner;
        return `<a href="${escapeAttr(target)}"${token.title ? ` title="${escapeAttr(token.title)}"` : ""}>${inner}</a>`;
      },
      image(token: Tokens.Image) {
        const url = mapMedia(st, token.href, "image", token.text.slice(0, 40));
        return url ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(token.text)}">` : "";
      },
      checkbox(token: { checked: boolean }) {
        if (!token.checked) st.w.add("unchecked_todo");
        return token.checked ? '<span class="n-check n-checked" aria-label="done">☑</span> ' : '<span class="n-check" aria-label="to do">☐</span> ';
      },
    },
  });
  return m;
}

function renderMarkdown(st: State, text: string): string {
  const html = fill(st, st.marked.parse(prepare(st, text), { async: false }) as string);
  return html
    .replace(new RegExp(`${MK_OPEN}[a-z_]*${MK_CLOSE}`, "g"), "")
    .replace(/<table>/g, '<div class="n-table"><table>')
    .replace(/<\/table>/g, "</table></div>");
}
function renderInline(st: State, text: string): string {
  return fill(st, st.marked.parseInline(prepare(st, text), { async: false }) as string).replace(new RegExp(`${MK_OPEN}[a-z_]*${MK_CLOSE}`, "g"), "");
}

// ——— blocks ———
function figure(st: State, src: string, caption: string, a: Attrs): string {
  const url = mapMedia(st, src, "image", caption.slice(0, 40) || undefined);
  if (!url) return "";
  const w = parseInt(a.width ?? "", 10);
  const width = w > 0 && w < 4000 ? ` width="${w}"` : "";
  const al = a.align === "left" || a.align === "right" || a.align === "center" ? ` n-align-${a.align}` : "";
  return `<figure class="n-figure${al}"><img src="${escapeAttr(url)}" alt="${escapeAttr(caption)}"${width}>${caption ? `<figcaption>${escapeText(caption)}</figcaption>` : ""}</figure>\n`;
}
function youtubeFigure(id: string, caption: string): string {
  return `<figure class="n-embed"><iframe src="https://www.youtube-nocookie.com/embed/${id}" allowfullscreen loading="lazy"></iframe>${caption ? `<figcaption>${escapeText(caption)}</figcaption>` : ""}</figure>\n`;
}
const firstText = (md: string) => md.split("\n").find((l) => l.trim())?.replace(/^[\s#>*_~`-]+/, "") ?? "";

function renderTag(st: State, tag: string, mt: { attrs: Attrs; inner: string }, depth: number): string {
  const a = mt.attrs;
  const caption = unescAttr(mt.inner.trim());
  switch (tag) {
    case "callout": {
      const inner = dedent(mt.inner);
      const icon = a.icon ?? "";
      if (icon.includes("🔒") || firstText(inner).startsWith("🔒")) return st.w.add("locked_removed"), "";
      const ok = icon && icon.length <= 16 && !/[<>"&]/.test(icon) && !/^(https?:|\/)/i.test(icon);
      return `<aside${cls(normalizeColor(a.color), "n-callout")}>${ok ? `<span class="n-callout-icon" aria-hidden="true">${icon}</span>` : ""}<div class="n-callout-body">${renderBlocks(st, inner, depth + 1)}</div></aside>\n`;
    }
    case "columns": {
      const cols: { w: number; html: string }[] = [];
      let rest = mt.inner.replace(/^\s+/, "");
      for (let c = matchBlockTag(rest, "column"); c; c = matchBlockTag(rest, "column")) {
        cols.push({ w: Number(c.attrs.width) > 0 ? Number(c.attrs.width) : 0, html: renderBlocks(st, dedent(c.inner), depth + 1) });
        rest = rest.slice(c.raw.length).replace(/^\s+/, "");
      }
      if (!cols.length) return renderBlocks(st, dedent(mt.inner), depth + 1);
      const all = cols.every((c) => c.w > 0);
      const sum = cols.reduce((n, c) => n + c.w, 0);
      return `<div class="n-columns">${cols.map((c) => `<div class="n-column" style="width:${(all ? (c.w / sum) * 100 : 100 / cols.length).toFixed(2)}%">${c.html}</div>`).join("")}</div>\n`;
    }
    case "details": {
      let inner = dedent(mt.inner);
      const sum = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(inner);
      const title = sum ? sum[1].trim() : "";
      if (sum) inner = inner.slice(sum[0].length);
      if (title.startsWith("🔒")) return st.w.add("locked_removed"), "";
      const h = /^[1-4]$/.test(a.heading ?? "") ? ` n-toggle-h${a.heading}` : "";
      return `<details${cls(normalizeColor(a.color), "n-toggle" + h)}${a.open === "true" ? " open" : ""}><summary>${renderInline(st, title || "…")}</summary>${renderBlocks(st, inner, depth + 1)}</details>\n`;
    }
    case "button":
      return st.w.add("button", a.label), "";
    case "table_of_contents":
      return (st.hasToc = true), "";
    case "empty-block":
      return "";
    case "page": {
      const id = NOTE_RE.exec(a.url ?? "")?.[1];
      const href = id ? st.ctx.noteLink?.(id.toLowerCase()) : null;
      if (href) return `<p class="n-pagelink"><a href="${escapeAttr(href)}">${escapeText(caption || href)}</a></p>\n`;
      return st.w.add("subpage", caption), "";
    }
    case "video":
    case "embed": {
      const id = youtubeId(a.src ?? "");
      if (id) return youtubeFigure(id, caption);
      if (tag === "video" && (/^\/api\/files\//.test(a.src ?? "") || isOsHost(st, hostOf(a.src ?? "")))) return st.w.add("video_file", caption || a.src?.split("/").pop()), "";
      return st.w.add("iframe_blocked", hostOf(a.src ?? "") ?? a.src?.slice(0, 40)), "";
    }
    case "audio": {
      const name = a.name || caption || decodeURIComponent((a.src ?? "").split("/").pop() ?? "").replace(/^[0-9a-f]{8}-/, "") || "audio";
      const url = mapMedia(st, a.src ?? "", "audio", name);
      if (!url) return "";
      return `<figure class="n-audio"><audio src="${escapeAttr(url)}" controls preload="none"></audio><figcaption>${escapeText(caption || name)}</figcaption></figure>\n`;
    }
    case "file":
    case "pdf": {
      const name = a.name || caption || decodeURIComponent((a.src ?? "").split("/").pop() ?? "").replace(/^[0-9a-f]{8}-/, "") || "file";
      const url = mapMedia(st, a.src ?? "", "file", name);
      if (!url) return "";
      const size = Number(a.size) > 0 ? ` (${fmtSize(Number(a.size))})` : "";
      return `<p class="n-file${tag === "pdf" ? " n-pdf" : ""}"><a href="${escapeAttr(url)}" download>${escapeText(name + size)}</a></p>\n`;
    }
    case "bookmark": {
      const url = a.url ? safeUrl(a.url) : null;
      if (!url || !/^https?:\/\//i.test(url) || isOsHost(st, hostOf(url))) return st.w.add(url && isOsHost(st, hostOf(url)) ? "os_link" : "bad_link", a.url?.slice(0, 40)), "";
      const img = a.image && /^https?:\/\//i.test(a.image) && safeUrl(a.image, { imageOnly: true }) ? `<img src="${escapeAttr(a.image)}" alt="" loading="lazy">` : "";
      const host = hostOf(url) ?? url;
      return `<div class="n-bookmark"><a href="${escapeAttr(url)}">${img}<strong>${escapeText(a.title || host)}</strong>${a.description ? `<span>${escapeText(a.description)}</span>` : ""}<small>${escapeText(host)}</small></a></div>\n`;
    }
  }
  return "";
}

const IMG_LINE = /^!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\s*\{([^}]*)\})?\s*$/;

function renderBlocks(st: State, src: string, depth: number): string {
  if (depth > MAX_DEPTH) {
    st.w.add("nesting_limit");
    return renderMarkdown(st, src);
  }
  const lines = src.split("\n");
  const out: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    const t = chunk.join("\n");
    chunk = [];
    if (t.trim()) out.push(renderMarkdown(st, t));
  };
  let fence: string | null = null;
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (fence) {
      chunk.push(line);
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      i++;
      continue;
    }
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      fence = fm[1];
      chunk.push(line);
      i++;
      continue;
    }
    const t = line.trim();
    if (t.startsWith("$$")) {
      const one = /^\$\$(.+)\$\$$/.exec(t);
      if (one) {
        flush();
        out.push(mathHtml(st, one[1].trim(), true));
        i++;
        continue;
      }
      if (t === "$$") {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== "$$") j++;
        if (j < lines.length) {
          flush();
          out.push(mathHtml(st, lines.slice(i + 1, j).join("\n"), true));
          i = j + 1;
          continue;
        }
      }
    }
    const im = IMG_LINE.exec(t);
    if (im && line === line.trimStart()) {
      flush();
      out.push(figure(st, im[2], unesc(im[1]), parseAttrs(im[3] ?? "")));
      i++;
      continue;
    }
    const tm = /^<([a-z][\w-]*)/i.exec(line);
    const tag = tm?.[1].toLowerCase();
    if (tag && BLOCK_TAGS.has(tag)) {
      const mt = matchBlockTag(lines.slice(i).join("\n"), tag);
      if (mt) {
        flush();
        out.push(renderTag(st, tag, mt, depth));
        i += mt.raw.replace(/\n$/, "").split("\n").length;
        continue;
      }
    }
    chunk.push(line);
    i++;
  }
  flush();
  return groupGalleries(out).join("");
}

/** A row of this many pictures (or more) in a row, with no text between them, is shown as a gallery grid. */
export const GALLERY_MIN = 3;
const IS_PICTURE = (h: string) => h.startsWith('<figure class="n-figure');

/**
 * Pictures that follow each other with nothing in between (3 or more) become one `<div class="n-gallery">`.
 * Two pictures, or pictures with text between them, stay as they are. Needs no special syntax in the editor.
 */
export function groupGalleries(blocks: string[]): string[] {
  // empty entries and empty paragraphs (what a removed picture leaves behind) do not break a row
  const parts = blocks.filter((b) => b !== "" && !/^<p>\s*<\/p>\s*$/.test(b));
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    if (!IS_PICTURE(parts[i])) {
      out.push(parts[i++]);
      continue;
    }
    let j = i;
    while (j < parts.length && IS_PICTURE(parts[j])) j++;
    if (j - i >= GALLERY_MIN) out.push(`<div class="n-gallery">${parts.slice(i, j).join("")}</div>\n`);
    else out.push(...parts.slice(i, j));
    i = j;
  }
  return out;
}

/** Markdown of a note → clean public HTML + table of contents + warnings + the media files it uses. */
export function renderNote(markdown: string, ctx: RenderCtx = {}): RenderResult {
  const st: State = { ctx, w: new Warnings(), media: new Map(), toc: [], ids: new Map(), hasToc: false, ph: [], marked: null as unknown as Marked };
  st.marked = makeMarked(st);
  const src = markdown.replace(/\r\n?/g, "\n").replace(/[-]/g, "");
  const { html, report } = sanitizeHtml(renderBlocks(st, src, 0));
  return { html, toc: st.toc, warnings: st.w.list(), media: [...st.media.values()], hasToc: st.hasToc, sanitize: report };
}
