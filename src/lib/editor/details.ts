// Toggle lists and toggle headings (▸ like Notion), saved inside Markdown as HTML, the way GitHub and
// Notion export them:
//   <details heading="2" color="blue_bg">
//   <summary>Title</summary>
//
//   inner **markdown**
//
//   </details>
// heading = "" (toggle list) or 1-3 (toggle heading 1-3).
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import type { JSONContent, NodeViewRendererProps } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { normalizeColor } from "@/lib/editor/colors";
import { attrString, dedent, matchBlockTag } from "@/lib/editor/tags";

type Tok = { type: string; raw: string; attrs: Record<string, string>; summaryTokens?: unknown[]; children?: unknown[] };

const level = (v: unknown) => {
  const n = Number(v);
  return n >= 1 && n <= 3 ? n : 0;
};

export const MdDetails = Details.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      heading: {
        default: 0,
        parseHTML: (el: HTMLElement) => level(el.getAttribute("data-heading") ?? el.getAttribute("heading")),
        renderHTML: (a: { heading?: number }) => (a.heading ? { "data-heading": String(a.heading) } : {}),
      },
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => normalizeColor(el.getAttribute("data-color") ?? el.getAttribute("color")),
        renderHTML: (a: { color?: string | null }) => (a.color ? { "data-color": a.color } : {}),
      },
    };
  },
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    // The stock view never redraws its attributes: rebuild it when heading/color change.
    return (props: NodeViewRendererProps) => {
      const view = parent(props) as ReturnType<NonNullable<typeof parent>> & { update?: (n: PMNode, ...rest: unknown[]) => boolean };
      let current = props.node;
      const update = view.update?.bind(view);
      view.update = (n: PMNode, ...rest: unknown[]) => {
        if (n.type !== current.type || n.attrs.heading !== current.attrs.heading || n.attrs.color !== current.attrs.color) return false;
        current = n;
        return update ? update(n, ...rest) : true;
      };
      return view;
    };
  },
  markdownTokenizer: {
    name: "details",
    level: "block",
    start: (src: string) => {
      const i = src.search(/(^|\n)<details\b/i);
      return i < 0 ? -1 : src[i] === "\n" ? i + 1 : i;
    },
    tokenize(src, _tokens, lexer) {
      const m = matchBlockTag(src, "details");
      if (!m || m.selfClosing) return undefined;
      const inner = m.inner;
      const sum = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(inner);
      const summary = sum ? sum[1].trim() : "";
      const body = dedent(sum ? inner.slice(sum[0].length) : inner).trim();
      return {
        type: "details",
        raw: m.raw,
        attrs: m.attrs,
        summaryTokens: lexer.inlineTokens(summary),
        children: body ? lexer.blockTokens(body) : [],
      } as Tok;
    },
  },
  parseMarkdown(token, h) {
    const t = token as unknown as Tok;
    const body = t.children?.length ? h.parseChildren(t.children as never) : [];
    return h.createNode("details", { heading: level(t.attrs?.heading), color: normalizeColor(t.attrs?.color), open: t.attrs?.open === "true" }, [
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
    const attrs = attrString({ heading: level(node.attrs?.heading) || null, color: normalizeColor(node.attrs?.color as string) });
    return `<details${attrs}>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
  },
});

export const MdDetailsSummary = DetailsSummary;
export const MdDetailsContent = DetailsContent;
