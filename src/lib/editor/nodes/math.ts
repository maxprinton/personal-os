// Equations with KaTeX (the same library Notion uses).
//   inline:  $E = mc^2$        block:  $$
//                                      \int_0^1 x\,dx
//                                      $$
// Click an equation to edit it (live preview). "$$x$$" typed in a line becomes an inline equation.
import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { requestUi } from "@/lib/editor/ui-events";

type Katex = typeof import("katex");
let katexP: Promise<Katex> | null = null;
export function loadKatex(): Promise<Katex> {
  // (its stylesheet is imported by RichEditor)
  return (katexP ??= import("katex")
    .then((k) => ((k as unknown as { default?: Katex }).default ?? k) as Katex)
    .catch((e) => {
      katexP = null;
      throw e;
    }));
}

export function renderMath(el: HTMLElement, latex: string, block: boolean) {
  if (!latex.trim()) {
    el.textContent = block ? "Add a TeX equation" : "New equation";
    el.classList.add("is-empty");
    return;
  }
  el.classList.remove("is-empty");
  el.textContent = latex;
  void loadKatex()
    .then((k) => {
      try {
        k.render(latex, el, { displayMode: block, throwOnError: false, output: "htmlAndMathml" });
      } catch {
        el.textContent = latex;
      }
    })
    .catch(() => {
      el.textContent = latex;
    });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertInlineMath: (latex?: string) => ReturnType;
      insertBlockMath: (latex?: string) => ReturnType;
    };
  }
}

function mathView(block: boolean) {
  return ({ node, getPos, editor }: { node: PMNode; getPos: (() => number | undefined) | boolean; editor: import("@tiptap/core").Editor }) => {
    let current = node;
    const dom = document.createElement(block ? "div" : "span");
    dom.className = block ? "n-math-block" : "n-math-inline";
    dom.contentEditable = "false";
    const paint = () => renderMath(dom, current.attrs.latex as string, block);
    paint();
    const pos = () => (typeof getPos === "function" ? getPos() : undefined);
    const open = () => {
      if (!editor.isEditable) return;
      const p = pos();
      if (typeof p !== "number") return;
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, p)));
      requestUi(editor.view, {
        kind: "math",
        rect: dom.getBoundingClientRect(),
        latex: current.attrs.latex as string,
        block,
        onSave: (latex) => {
          const q = pos();
          if (typeof q !== "number") return;
          editor.chain().command(({ tr }) => {
            tr.setNodeMarkup(q, undefined, { latex });
            return true;
          }).setTextSelection(q + current.nodeSize).focus().run();
        },
        onRemove: () => {
          const q = pos();
          if (typeof q !== "number") return;
          editor.chain().deleteRange({ from: q, to: q + current.nodeSize }).focus().run();
        },
      });
    };
    dom.addEventListener("click", open);
    dom.addEventListener("n-open", open);
    return {
      dom,
      update: (n: PMNode) => {
        if (n.type !== current.type) return false;
        const changed = n.attrs.latex !== current.attrs.latex;
        current = n;
        if (changed) paint();
        return true;
      },
      stopEvent: (e: Event) => e.type === "click",
      ignoreMutation: () => true,
    };
  };
}

/** Opens the editor of the equation that is selected (used right after inserting one). */
export function openSelectedMath(editor: import("@tiptap/core").Editor) {
  setTimeout(() => {
    const { from } = editor.state.selection;
    const dom = editor.view.nodeDOM(from) as HTMLElement | null;
    dom?.dispatchEvent(new Event("n-open"));
  }, 30);
}

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: "", parseHTML: (el) => el.getAttribute("data-latex") ?? "" } };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "inline-math", "data-latex": node.attrs.latex }), `$${node.attrs.latex}$`];
  },
  renderText: ({ node }) => `$${node.attrs.latex}$`,
  addNodeView() {
    return mathView(false) as never;
  },
  markdownTokenName: "inlineMath",
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: (src: string) => src.indexOf("$"),
    tokenize(src: string) {
      if (src.startsWith("$$")) return undefined;
      const m = /^\$(?=\S)((?:\\\$|[^$\n])*?\S)\$(?!\d)/.exec(src);
      if (!m) return undefined;
      return { type: "inlineMath", raw: m[0], text: m[1] } as MarkdownToken;
    },
  },
  parseMarkdown: (token, h) => h.createNode("inlineMath", { latex: (token as { text?: string }).text ?? "" }),
  renderMarkdown: (node) => `$${String(node.attrs?.latex ?? "").replace(/\$/g, "\\$")}$`,
  addInputRules() {
    return [
      // Notion: $$x^2$$ inside a line → inline equation
      new InputRule({
        find: /(?:^|[^$])(\$\$([^$\n]+)\$\$)$/,
        handler: ({ state, range, match }) => {
          const whole = match[1];
          const start = range.to - whole.length;
          state.tr.replaceWith(start, range.to, this.type.create({ latex: match[2] }));
        },
      }),
    ];
  },
  addCommands() {
    return {
      insertInlineMath:
        (latex = "") =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { latex } })
            .command(({ tr }) => {
              const at = tr.selection.from - 1;
              if (at >= 0 && tr.doc.nodeAt(at)?.type.name === this.name) tr.setSelection(NodeSelection.create(tr.doc, at));
              return true;
            })
            .run(),
    };
  },
});

export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { latex: { default: "", parseHTML: (el) => el.getAttribute("data-latex") ?? "" } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "block-math", "data-latex": node.attrs.latex }), `$$${node.attrs.latex}$$`];
  },
  addNodeView() {
    return mathView(true) as never;
  },
  markdownTokenName: "blockMath",
  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: (src: string) => {
      const i = src.search(/(^|\n)\$\$/);
      return i < 0 ? -1 : src[i] === "\n" ? i + 1 : i;
    },
    tokenize(src: string) {
      const m = /^\$\$[ \t]*\n?([\s\S]*?)\n?\$\$[ \t]*(?:\n|$)/.exec(src);
      if (!m) return undefined;
      return { type: "blockMath", raw: m[0], text: m[1].trim() } as MarkdownToken;
    },
  },
  parseMarkdown: (token, h) => h.createNode("blockMath", { latex: (token as { text?: string }).text ?? "" }),
  renderMarkdown: (node) => `$$\n${String(node.attrs?.latex ?? "")}\n$$`,
  addCommands() {
    return {
      insertBlockMath:
        (latex = "") =>
        ({ chain, state }) => {
          const { $from } = state.selection;
          const empty = $from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0;
          const from = empty ? $from.before() : $from.after(Math.max(1, $from.depth));
          const to = empty ? $from.after() : from;
          return chain()
            .insertContentAt({ from, to }, { type: this.name, attrs: { latex } })
            .command(({ tr }) => {
              if (tr.doc.nodeAt(from)?.type.name === this.name) tr.setSelection(NodeSelection.create(tr.doc, from));
              return true;
            })
            .run();
        },
    };
  },
});
