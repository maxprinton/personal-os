// Text blocks with Notion's block color and block anchor, written at the end of the line the way
// Notion's Markdown does it:  "Some text {color="red_bg"}"  ·  "## Title {color="blue" id="k3x9"}"
// plus colored text inside a line:  <span color="red">word</span>  (Notion's inline syntax).
import { Extension, Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import { normalizeColor } from "@/lib/editor/colors";
import { inlineTagTokenizer, attrString, type TagToken } from "@/lib/editor/tags";

const SUFFIX = /[ \t]*\{((?:\s*[\w-]+="[^"]*")+)\s*\}[ \t]*$/;

/** Moves a trailing {color="…" id="…"} from the text into the block's attributes. */
function lift(node: JSONContent): JSONContent {
  const content = node.content;
  const last = content?.[content.length - 1];
  if (!content || !last || last.type !== "text" || !last.text) return node;
  const m = SUFFIX.exec(last.text);
  if (!m) return node;
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(m[1]))) attrs[a[1]] = a[2];
  const color = normalizeColor(attrs.color);
  const id = attrs.id && /^[\w-]{1,40}$/.test(attrs.id) ? attrs.id : null;
  if (!color && !id) return node;
  const text = last.text.slice(0, m.index);
  const nextContent = text ? [...content.slice(0, -1), { ...last, text }] : content.slice(0, -1);
  return { ...node, attrs: { ...(node.attrs ?? {}), ...(color ? { color } : {}), ...(id ? { blockId: id } : {}) }, content: nextContent };
}

export function liftBlockAttrs<T>(result: T): T {
  if (Array.isArray(result)) return result.map((n) => (n && (n.type === "paragraph" || n.type === "heading") ? lift(n) : n)) as T;
  const n = result as unknown as JSONContent;
  if (n && (n.type === "paragraph" || n.type === "heading")) return lift(n) as T;
  return result;
}

function suffix(node: JSONContent) {
  const color = normalizeColor(node.attrs?.color as string | undefined);
  const id = node.attrs?.blockId as string | undefined;
  if (!color && !id) return "";
  return ` {${attrString({ color, id }).trim()}}`;
}

const withSuffix = (md: string, node: JSONContent) => (md && md.trim() && md !== "&nbsp;" ? md + suffix(node) : md);

/** color + blockId on paragraphs and headings (the HTML carries data-color / id="b-…"). */
export const BlockAttrs = Extension.create({
  name: "blockAttrs",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          color: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => normalizeColor(el.getAttribute("data-color")),
            renderHTML: (a) => (a.color ? { "data-color": a.color } : {}),
          },
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-block-id"),
            renderHTML: (a) => (a.blockId ? { "data-block-id": a.blockId, id: `b-${a.blockId}` } : {}),
          },
        },
      },
    ];
  },
});

export const NParagraph = Paragraph.extend({
  parseMarkdown(token, h) {
    return liftBlockAttrs(this.parent!(token, h));
  },
  renderMarkdown(node, h, ctx) {
    return withSuffix(this.parent!(node, h, ctx), node);
  },
});

export const NHeading = Heading.extend({
  parseMarkdown(token, h) {
    return liftBlockAttrs(this.parent!(token, h));
  },
  renderMarkdown(node, h, ctx) {
    return withSuffix(this.parent!(node, h, ctx), node);
  },
  addKeyboardShortcuts() {
    return {}; // Notion's Ctrl+Shift+1…4 live in the Notion keymap
  },
}).configure({ levels: [1, 2, 3, 4] });

function markAll(content: JSONContent[], mark: { type: string; attrs?: Record<string, unknown> }): JSONContent[] {
  return content.map((c) => ({ ...c, marks: [...(c.marks ?? []).filter((m) => m.type !== mark.type), mark] }));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

/** Text or background color of a piece of text: <span color="red">…</span> / <span color="red_bg">…</span>. */
export const TextColor = Mark.create({
  name: "textColor",
  // Rendered inside other marks so **bold** around it stays valid Markdown
  priority: 50,
  excludes: "textColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => normalizeColor(el.getAttribute("data-color") ?? el.getAttribute("color")),
        renderHTML: (a) => (a.color ? { "data-color": a.color } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-color]" }, { tag: "span[color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "n-color" }, HTMLAttributes), 0];
  },
  markdownTokenName: "notionSpan",
  markdownTokenizer: inlineTagTokenizer("span", "notionSpan", "inline"),
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    let content = h.parseInline((t.inlineTokens ?? []) as never);
    const color = normalizeColor(t.attrs?.color);
    if (color) content = markAll(content, { type: "textColor", attrs: { color } });
    if (t.attrs?.underline === "true") content = markAll(content, { type: "underline" });
    return content;
  },
  renderMarkdown: (node, h) => {
    const color = normalizeColor(node.attrs?.color as string | undefined);
    const inner = h.renderChildren(node);
    return color ? `<span color="${color}">${inner}</span>` : inner;
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          normalizeColor(color) ? commands.setMark(this.name, { color: normalizeColor(color) }) : commands.unsetMark(this.name),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
