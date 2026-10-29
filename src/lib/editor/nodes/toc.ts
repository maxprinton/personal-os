// Table of contents block (Notion "/toc"): lists the page's headings, indented by level; a click jumps there.
//   <table_of_contents color="gray"/>
import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { normalizeColor } from "@/lib/editor/colors";
import { attrString, blockTagTokenizer, type TagToken } from "@/lib/editor/tags";

export type HeadingInfo = { level: number; text: string; pos: number };

/** Headings of the page (toggle headings too), in order. */
export function collectHeadings(editor: Editor): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      out.push({ level: node.attrs.level as number, text: node.textContent, pos });
      return false;
    }
    if (node.type.name === "details" && node.attrs.heading) {
      out.push({ level: node.attrs.heading as number, text: node.firstChild?.textContent ?? "", pos });
      return true;
    }
    return node.isBlock && node.type.name !== "codeBlock";
  });
  return out;
}

export function scrollToPos(editor: Editor, pos: number) {
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  if (!dom?.scrollIntoView) return;
  dom.scrollIntoView({ behavior: "smooth", block: "center" });
  dom.classList.add("n-flash");
  setTimeout(() => dom.classList.remove("n-flash"), 1600);
}

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { color: { default: null, parseHTML: (el) => normalizeColor(el.getAttribute("data-color")) } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toc", class: "n-toc" })];
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "n-toc";
      dom.contentEditable = "false";
      const paint = () => {
        if (current.attrs.color) dom.setAttribute("data-color", current.attrs.color);
        else dom.removeAttribute("data-color");
        const hs = collectHeadings(editor);
        dom.replaceChildren();
        if (!hs.length) {
          const p = document.createElement("p");
          p.className = "n-toc-empty";
          p.textContent = "Add headings to create a table of contents.";
          dom.append(p);
          return;
        }
        const min = Math.min(...hs.map((h) => h.level));
        for (const h of hs) {
          const a = document.createElement("a");
          a.className = "n-toc-item";
          a.style.paddingLeft = `${(h.level - min) * 24 + 2}px`;
          a.textContent = h.text || "Untitled";
          a.href = "#";
          a.addEventListener("mousedown", (e) => e.preventDefault());
          a.addEventListener("click", (e) => {
            e.preventDefault();
            scrollToPos(editor, h.pos);
          });
          dom.append(a);
        }
      };
      paint();
      const onUpdate = () => paint();
      editor.on("update", onUpdate);
      return {
        dom,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          paint();
          return true;
        },
        destroy: () => editor.off("update", onUpdate),
        stopEvent: (e) => e.type === "click" || e.type === "mousedown",
        ignoreMutation: () => true,
      };
    };
  },
  markdownTokenizer: blockTagTokenizer("table_of_contents", "tableOfContents", "none"),
  parseMarkdown: (token, h) => h.createNode("tableOfContents", { color: normalizeColor((token as unknown as TagToken).attrs?.color) }),
  renderMarkdown: (node) => `<table_of_contents${attrString({ color: normalizeColor(node.attrs?.color as string) })}/>`,
});
