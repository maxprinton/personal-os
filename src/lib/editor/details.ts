// Toggle blocks (▸ like Notion) saved inside Markdown as HTML, the way GitHub and Notion export them:
//   <details>
//   <summary>Title</summary>
//
//   inner **markdown**
//
//   </details>
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import type { JSONContent } from "@tiptap/core";

type Tok = { type: string; raw: string; summaryTokens?: unknown[]; children?: unknown[] };

/** Finds where the <details> that opens at 0 is closed (nested toggles count). */
function closingIndex(src: string) {
  const re = /<\/?details\b[^>]*>/gi;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

export const MdDetails = Details.extend({
  markdownTokenizer: {
    name: "details",
    level: "block",
    start: (src: string) => src.search(/<details\b/i),
    tokenize(src, _tokens, lexer) {
      if (!/^<details\b/i.test(src)) return undefined;
      const close = closingIndex(src);
      if (!close) return undefined;
      const inner = src.slice(src.indexOf(">") + 1, close.start);
      const sum = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(inner);
      const summary = sum ? sum[1].trim() : "";
      const body = (sum ? inner.slice(sum[0].length) : inner).trim();
      const after = src.slice(close.end);
      const trailing = /^[ \t]*\n?/.exec(after)?.[0] ?? "";
      return {
        type: "details",
        raw: src.slice(0, close.end) + trailing,
        summaryTokens: lexer.inlineTokens(summary),
        children: body ? lexer.blockTokens(body) : [],
      } as Tok;
    },
  },
  parseMarkdown(token, h) {
    const t = token as unknown as Tok;
    const body = t.children?.length ? h.parseChildren(t.children as never) : [];
    return h.createNode("details", {}, [
      h.createNode("detailsSummary", {}, h.parseInline((t.summaryTokens ?? []) as never)),
      h.createNode("detailsContent", {}, body.length ? body : [{ type: "paragraph" }]),
    ]);
  },
  renderMarkdown(node, h) {
    const kids = (node.content ?? []) as JSONContent[];
    const summary = kids.find((k) => k.type === "detailsSummary");
    const content = kids.find((k) => k.type === "detailsContent");
    const title = summary ? h.renderChildren(summary.content ?? []) : "";
    const body = content ? h.renderChildren(content.content ?? [], "\n\n").trim() : "";
    return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
  },
});

export const MdDetailsSummary = DetailsSummary;
export const MdDetailsContent = DetailsContent;
