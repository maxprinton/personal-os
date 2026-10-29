// Helpers for the Notion-style tags inside the Markdown of a note, e.g.
//   <callout icon="💡" color="gray_bg">        <columns>            <table_of_contents/>
//   inner **markdown**                          <column width="0.5">
//   </callout>                                   …
// (the syntax of Notion's own "enhanced markdown"). Attribute values are escaped, so a title with
// quotes or < > never breaks the note.
import type { MarkdownLexerConfiguration, MarkdownToken, MarkdownTokenizer } from "@tiptap/core";

export type Attrs = Record<string, string>;

const ATTR_RE = /([\w-]+)(?:\s*=\s*"([^"]*)")?/g;

export function escAttr(v: string) {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;");
}

export function unescAttr(v: string) {
  return v
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseAttrs(src: string): Attrs {
  const out: Attrs = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(src))) out[m[1]] = m[2] === undefined ? "true" : unescAttr(m[2]);
  return out;
}

/** ` a="1" b="2"` for the values that are set (empty / null / false are left out). */
export function attrString(attrs: Record<string, string | number | boolean | null | undefined>) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => ` ${k}="${escAttr(String(v))}"`)
    .join("");
}

const openRe = (tag: string) => new RegExp(`^<${tag}((?:\\s+[\\w-]+(?:\\s*=\\s*"[^"]*")?)*)\\s*(/?)>`, "i");

/** Where the tag that opens at 0 is closed (nested tags of the same name count). */
function findClose(src: string, tag: string): { start: number; end: number } | null {
  const re = new RegExp(`<(/?)${tag}\\b((?:\\s+[\\w-]+(?:\\s*=\\s*"[^"]*")?)*)\\s*(/?)>`, "gi");
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[3] === "/") {
      if (depth === 0) return { start: m.index, end: m.index + m[0].length }; // self-closing at the top
      continue;
    }
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

export type TagMatch = { raw: string; attrs: Attrs; inner: string; selfClosing: boolean };

/** Reads `<tag …>inner</tag>` or `<tag …/>` at the start of `src` (block level: it must own its lines). */
export function matchBlockTag(src: string, tag: string): TagMatch | null {
  const open = openRe(tag).exec(src);
  if (!open) return null;
  const attrs = parseAttrs(open[1] ?? "");
  const trailing = (from: number) => /^[ \t]*(?:\n|$)/.exec(src.slice(from))?.[0];
  if (open[2] === "/") {
    const t = trailing(open[0].length);
    if (t === undefined) return null;
    return { raw: src.slice(0, open[0].length) + t, attrs, inner: "", selfClosing: true };
  }
  const close = findClose(src, tag);
  if (!close || close.start < open[0].length) return null;
  const t = trailing(close.end);
  if (t === undefined) return null;
  return { raw: src.slice(0, close.end) + t, attrs, inner: src.slice(open[0].length, close.start), selfClosing: false };
}

/** Removes one level of indentation (tabs or up to 4 spaces) that Notion puts inside its tags. */
export function dedent(s: string) {
  const lines = s.replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  const ind = lines.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)![0]);
  if (!ind.length) return "";
  if (ind.every((x) => x.startsWith("\t"))) return lines.map((l) => l.replace(/^\t/, "")).join("\n");
  return lines.join("\n");
}

export type TagToken = MarkdownToken & { attrs: Attrs; children?: MarkdownToken[]; inlineTokens?: MarkdownToken[]; inner?: string };

/**
 * A marked block tokenizer for `<tag>`. content:
 *  - "blocks": inner is Markdown blocks (callout, column…)
 *  - "inline": inner is one line of text (a caption, a page title)
 *  - "raw": inner kept as it is
 */
export function blockTagTokenizer(tag: string, tokenName: string, content: "blocks" | "inline" | "raw" | "none"): MarkdownTokenizer {
  return {
    name: tokenName,
    level: "block",
    start: (src: string) => {
      const i = src.search(new RegExp(`(^|\\n)<${tag}\\b`, "i"));
      return i < 0 ? -1 : src[i] === "\n" ? i + 1 : i;
    },
    tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
      const m = matchBlockTag(src, tag);
      if (!m) return undefined;
      const tok: TagToken = { type: tokenName, raw: m.raw, attrs: m.attrs };
      if (content === "blocks") {
        const body = dedent(m.inner);
        tok.children = body.trim() ? lexer.blockTokens(body) : [];
      } else if (content === "inline") {
        tok.inlineTokens = lexer.inlineTokens(m.inner.trim());
        tok.inner = m.inner.trim();
      } else if (content === "raw") tok.inner = m.inner;
      return tok;
    },
  };
}

/** Inline `<tag …>text</tag>` or `<tag …/>` tokenizer (mentions, colored text). */
export function inlineTagTokenizer(tag: string, tokenName: string, innerAs: "inline" | "text"): MarkdownTokenizer {
  const open = openRe(tag);
  return {
    name: tokenName,
    level: "inline",
    start: (src: string) => src.search(new RegExp(`<${tag}\\b`, "i")),
    tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
      const o = open.exec(src);
      if (!o) return undefined;
      const attrs = parseAttrs(o[1] ?? "");
      if (o[2] === "/") return { type: tokenName, raw: o[0], attrs, inner: "" } as TagToken;
      const close = findClose(src, tag);
      if (!close) return undefined;
      const inner = src.slice(o[0].length, close.start);
      const tok: TagToken = { type: tokenName, raw: src.slice(0, close.end), attrs, inner };
      if (innerAs === "inline") tok.inlineTokens = lexer.inlineTokens(inner);
      return tok;
    },
  };
}

/** Indents every line of a child block one tab, the way Notion writes children. */
export const indentLines = (s: string) =>
  s
    .split("\n")
    .map((l) => (l ? `\t${l}` : l))
    .join("\n");
