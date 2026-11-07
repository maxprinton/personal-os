// Portfolio publishing — HTML sanitizer (pure, no dependencies). It runs at publish time AND again when the
// site shows a page. Everything not on the allowlist is removed; text is kept, scripts are dropped with their content.
// Output is always well formed: attributes re-escaped, tags balanced, stray "<" escaped.

export type SanitizeReport = { removedTags: Record<string, number>; removedAttrs: Record<string, number>; blockedUrls: string[] };
export type SanitizeOptions = {
  /** Allow <iframe> only for these embed URL prefixes. Default: YouTube (privacy mode) embeds. */
  iframeAllow?: RegExp[];
};

const VOID = new Set(["br", "hr", "img", "wbr"]);
const TAGS = new Set([
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "b", "i", "u", "s", "del", "ins", "code", "pre", "span", "a", "ul", "ol", "li",
  "blockquote", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "img", "figure", "figcaption", "div", "details", "summary",
  "iframe", "sup", "sub", "mark", "time", "section", "aside", "kbd", "small", "abbr", "wbr", "cite", "dl", "dt", "dd",
]);
/** Removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set(["script", "style", "template", "noscript", "title", "head", "object", "embed", "applet", "svg", "math", "textarea", "select", "option", "button", "form", "link", "meta", "base", "frameset", "frame"]);

const GLOBAL_ATTRS = new Set(["class", "id", "title", "lang", "dir", "style"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "rel", "target", "download"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  iframe: new Set(["src", "allowfullscreen", "loading", "width", "height", "referrerpolicy", "allow"]),
  details: new Set(["open"]),
  td: new Set(["colspan", "rowspan", "align"]),
  th: new Set(["colspan", "rowspan", "align", "scope"]),
  col: new Set(["span", "width"]),
  time: new Set(["datetime"]),
  ol: new Set(["start", "type"]),
  li: new Set(["value"]),
  abbr: new Set(["title"]),
};

export const YOUTUBE_EMBED = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(\?[A-Za-z0-9_=&.%-]*)?$/;

const STYLE_PROPS = new Set(["height", "width", "min-width", "top", "left", "margin-left", "margin-right", "vertical-align", "border-bottom-width", "border-right-width", "padding-left", "padding-right"]);
const STYLE_RE = /^\s*([a-z-]+)\s*:\s*(-?(?:\d+\.?\d*|\.\d+)(?:em|ex|px|rem|%|pt)?)\s*$/i;

export function escapeText(s: string) {
  return s.replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, "&amp;").replace(/</g, "&lt;");
}
export function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/" };
/** Decodes entities in an attribute value so URL checks see what a browser would see. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** null = not allowed. Allowed: https, http, mailto, tel, relative paths, #anchors. */
export function safeUrl(raw: string, opts: { imageOnly?: boolean } = {}): string | null {
  const v = decodeEntities(raw).trim();
  // eslint-disable-next-line no-control-regex
  const probe = v.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, "").toLowerCase();
  if (!probe) return null;
  if (probe.startsWith("#") || probe.startsWith("/") && !probe.startsWith("//")) return v;
  const m = /^([a-z][a-z0-9+.-]*):/.exec(probe);
  if (!m) return /^[\w./~%-]/.test(probe) && !probe.startsWith("//") ? v : null; // relative path without a scheme
  const scheme = m[1];
  if (opts.imageOnly) return scheme === "https" || scheme === "http" ? v : null;
  return ["https", "http", "mailto", "tel"].includes(scheme) ? v : null;
}

function cleanStyle(v: string): string | null {
  const out: string[] = [];
  for (const decl of v.split(";")) {
    if (!decl.trim()) continue;
    const m = STYLE_RE.exec(decl);
    if (!m || !STYLE_PROPS.has(m[1].toLowerCase())) return null;
    out.push(`${m[1].toLowerCase()}:${m[2]}`);
  }
  return out.length ? out.join(";") : null;
}

type RawAttr = { name: string; value: string };

/** Reads one tag starting at s[i] === "<". Returns null when it is not a tag (the "<" is then plain text). */
function readTag(s: string, i: number): { end: number; name: string; closing: boolean; attrs: RawAttr[]; selfClosing: boolean } | null {
  let j = i + 1;
  let closing = false;
  if (s[j] === "/") {
    closing = true;
    j++;
  }
  const nm = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(s.slice(j, j + 40));
  if (!nm) return null;
  const name = nm[0].toLowerCase();
  j += nm[0].length;
  const attrs: RawAttr[] = [];
  let selfClosing = false;
  for (;;) {
    while (j < s.length && /[\s]/.test(s[j])) j++;
    if (j >= s.length) return null; // unterminated tag: treat "<" as text
    if (s[j] === ">") return { end: j + 1, name, closing, attrs, selfClosing };
    if (s[j] === "/") {
      selfClosing = true;
      j++;
      continue;
    }
    const an = /^[^\s"'<>\/=]+/.exec(s.slice(j, j + 80));
    if (!an) {
      j++; // junk character inside the tag: skip it
      continue;
    }
    j += an[0].length;
    selfClosing = false;
    let value = "";
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === "=") {
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      const q = s[j];
      if (q === '"' || q === "'") {
        const e = s.indexOf(q, j + 1);
        if (e < 0) return null;
        value = s.slice(j + 1, e);
        j = e + 1;
      } else {
        const u = /^[^\s>]*/.exec(s.slice(j))![0];
        value = u;
        j += u.length;
      }
    }
    attrs.push({ name: an[0].toLowerCase(), value });
  }
}

export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): { html: string; report: SanitizeReport } {
  const iframeAllow = opts.iframeAllow ?? [YOUTUBE_EMBED];
  const report: SanitizeReport = { removedTags: {}, removedAttrs: {}, blockedUrls: [] };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(escapeText(html.slice(i)));
      break;
    }
    if (lt > i) out.push(escapeText(html.slice(i, lt)));
    if (html.startsWith("<!--", lt)) {
      const e = html.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt) || html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const e = html.indexOf(">", lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const tag = readTag(html, lt);
    if (!tag) {
      out.push("&lt;");
      i = lt + 1;
      continue;
    }
    i = tag.end;
    const { name } = tag;

    if (DROP_WITH_CONTENT.has(name)) {
      bump(report.removedTags, name);
      if (!tag.closing && !tag.selfClosing) {
        const re = new RegExp(`</${name}\\s*>`, "i");
        const m = re.exec(html.slice(i));
        i = m ? i + m.index + m[0].length : n;
      }
      continue;
    }
    if (!TAGS.has(name)) {
      bump(report.removedTags, name); // unknown tag: drop the tag, keep its text
      continue;
    }
    if (tag.closing) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue; // stray closing tag
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }

    // attributes
    const allowed = TAG_ATTRS[name];
    const kept: string[] = [];
    let href: string | null = null;
    let src: string | null = null;
    let external = false;
    let dropTag = false;
    for (const a of tag.attrs) {
      if (a.name.startsWith("on")) {
        bump(report.removedAttrs, a.name);
        continue;
      }
      if (!(GLOBAL_ATTRS.has(a.name) || allowed?.has(a.name))) {
        bump(report.removedAttrs, a.name);
        continue;
      }
      const val = decodeEntities(a.value);
      switch (a.name) {
        case "href": {
          const u = safeUrl(a.value);
          if (!u) {
            report.blockedUrls.push(val.slice(0, 120));
            bump(report.removedAttrs, "href");
          } else {
            href = u;
            external = /^https?:/i.test(u);
          }
          break;
        }
        case "src": {
          if (name === "iframe") {
            const u = safeUrl(a.value, { imageOnly: true });
            if (u && iframeAllow.some((re) => re.test(u))) src = u;
            else {
              report.blockedUrls.push(val.slice(0, 120));
              dropTag = true;
            }
          } else {
            const u = safeUrl(a.value, { imageOnly: true });
            if (!u) {
              report.blockedUrls.push(val.slice(0, 120));
              dropTag = true;
            } else src = u;
          }
          break;
        }
        case "style": {
          const st = cleanStyle(val);
          if (st) kept.push(`style="${escapeAttr(st)}"`);
          else bump(report.removedAttrs, "style");
          break;
        }
        case "class":
          if (/^[\w\- :.]*$/.test(val)) kept.push(`class="${escapeAttr(val.trim())}"`);
          else bump(report.removedAttrs, "class");
          break;
        case "id":
          if (/^[A-Za-z][\w:.-]{0,80}$/.test(val)) kept.push(`id="${escapeAttr(val)}"`);
          else bump(report.removedAttrs, "id");
          break;
        case "target":
        case "rel":
          break; // set by us below
        case "width":
        case "height":
        case "colspan":
        case "rowspan":
        case "start":
        case "value":
        case "span":
          if (/^\d{1,5}%?$/.test(val.trim())) kept.push(`${a.name}="${val.trim()}"`);
          break;
        case "align":
          if (/^(left|right|center)$/i.test(val.trim())) kept.push(`align="${val.trim().toLowerCase()}"`);
          break;
        case "loading":
          kept.push('loading="lazy"');
          break;
        case "decoding":
        case "referrerpolicy":
        case "allow":
          break;
        case "allowfullscreen":
        case "open":
        case "download":
          kept.push(a.name);
          break;
        case "datetime":
          if (/^[\dT:+\-.Z ]{4,40}$/.test(val)) kept.push(`datetime="${escapeAttr(val.trim())}"`);
          break;
        case "scope":
        case "type":
          if (/^[a-z0-9]{1,8}$/i.test(val.trim())) kept.push(`${a.name}="${val.trim()}"`);
          break;
        default:
          kept.push(`${a.name}="${escapeAttr(val)}"`);
      }
    }
    if (dropTag) {
      bump(report.removedTags, name);
      continue;
    }
    if (name === "iframe" && !src) {
      bump(report.removedTags, "iframe");
      continue;
    }
    if (name === "img" && !src) {
      bump(report.removedTags, "img");
      continue;
    }
    if (href !== null) kept.unshift(`href="${escapeAttr(href)}"`);
    if (src !== null) kept.unshift(`src="${escapeAttr(src)}"`);
    if (name === "a" && href !== null) kept.push(external ? 'rel="noopener noreferrer" target="_blank"' : 'rel="noopener"');
    if (name === "iframe") kept.push('loading="lazy"', 'referrerpolicy="strict-origin-when-cross-origin"', 'allow="encrypted-media; picture-in-picture; fullscreen"');
    if (name === "img" && !tag.attrs.some((a) => a.name === "loading")) kept.push('loading="lazy"');

    if (stack.length >= 60) {
      bump(report.removedTags, name); // absurdly deep: drop the tag
      continue;
    }
    out.push(`<${name}${kept.length ? " " + kept.join(" ") : ""}>`);
    if (!VOID.has(name)) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return { html: out.join(""), report };
}

/** The visible text of sanitized HTML (for search text and reading time). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|figcaption|summary|pre)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n[\s]*/g, "\n")
    .trim();
}
