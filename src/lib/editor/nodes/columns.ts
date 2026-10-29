// Columns (Notion): blocks side by side. Made with "/2 columns"… or by dragging a block to the
// left/right edge of another one. The line between two columns can be dragged to resize them.
//   <columns>
//   <column width="0.4">
//
//   …blocks…
//
//   </column>
//   <column width="0.6">
//   …
//   </column>
//   </columns>
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { attrString, blockTagTokenizer, type TagToken } from "@/lib/editor/tags";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      /** Inserts N empty columns after the current block. */
      insertColumns: (count: number) => ReturnType;
    };
  }
}

const width = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0.05 && n < 0.95 ? Math.round(n * 1000) / 1000 : null;
};

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,
  addAttributes() {
    return { width: { default: null, parseHTML: (el) => width(el.getAttribute("data-width")) } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column", "data-width": node.attrs.width ?? undefined, class: "n-column" }), 0];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "n-column";
      dom.setAttribute("data-type", "column");
      const grip = document.createElement("div");
      grip.className = "n-column-resizer";
      grip.contentEditable = "false";
      const content = document.createElement("div");
      content.className = "n-column-content";
      dom.append(grip, content);
      const paint = () => {
        dom.style.flex = current.attrs.width ? `${current.attrs.width} 1 0` : "1 1 0";
      };
      paint();

      grip.addEventListener("mousedown", (e) => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        const prevDom = dom.previousElementSibling as HTMLElement | null;
        const list = dom.parentElement;
        if (typeof pos !== "number" || !prevDom || !list || !editor.isEditable) return;
        e.preventDefault();
        const $pos = editor.state.doc.resolve(pos);
        const listNode = $pos.parent;
        const index = $pos.index();
        const total = list.getBoundingClientRect().width;
        const startX = e.clientX;
        const a0 = prevDom.getBoundingClientRect().width;
        const b0 = dom.getBoundingClientRect().width;
        const sum = a0 + b0;
        // Each column's share of the row now, so the others keep their size
        const shares: number[] = [];
        Array.from(list.children).forEach((c) => shares.push((c as HTMLElement).getBoundingClientRect().width / total));
        let a = a0;
        document.body.classList.add("n-col-resizing");
        const move = (ev: MouseEvent) => {
          a = Math.max(sum * 0.1, Math.min(sum * 0.9, a0 + ev.clientX - startX));
          prevDom.style.flex = `${a / total} 1 0`;
          dom.style.flex = `${(sum - a) / total} 1 0`;
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          document.body.classList.remove("n-col-resizing");
          shares[index - 1] = a / total;
          shares[index] = (sum - a) / total;
          const norm = shares.reduce((s, x) => s + x, 0) || 1;
          const tr = editor.state.tr;
          let p = pos - $pos.parentOffset; // first column's position inside the list
          for (let i = 0; i < listNode.childCount; i++) {
            const col = listNode.child(i);
            tr.setNodeMarkup(p, undefined, { ...col.attrs, width: width(shares[i] / norm) });
            p += col.nodeSize;
          }
          editor.view.dispatch(tr);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });

      return {
        dom,
        contentDOM: content,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          paint();
          return true;
        },
        ignoreMutation: (m) => m.type !== "selection" && grip.contains(m.target as globalThis.Node),
      };
    };
  },
  markdownTokenizer: blockTagTokenizer("column", "column", "blocks"),
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    const body = t.children?.length ? h.parseChildren(t.children as never) : [];
    return h.createNode("column", { width: width(t.attrs.width) }, body.length ? body : [{ type: "paragraph" }]);
  },
  renderMarkdown: (node, h) => {
    const body = h.renderChildren((node.content ?? []) as JSONContent[], "\n\n").trim();
    return `<column${attrString({ width: width(node.attrs?.width) })}>\n\n${body}\n\n</column>`;
  },
});

export const ColumnList = Node.create({
  name: "columnList",
  group: "block",
  content: "column+",
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="columnList"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columnList", class: "n-columns" }), 0];
  },
  markdownTokenizer: blockTagTokenizer("columns", "columns", "blocks"),
  markdownTokenName: "columns",
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    const kids = (t.children?.length ? h.parseChildren(t.children as never) : []) as JSONContent[];
    const cols = kids.filter((k) => k.type === "column");
    if (cols.length >= 2) return h.createNode("columnList", {}, cols);
    // A single column (or none): just its blocks
    return cols.flatMap((c) => c.content ?? []).concat(kids.filter((k) => k.type !== "column"));
  },
  renderMarkdown: (node, h) => {
    const cols = ((node.content ?? []) as JSONContent[]).map((c) => h.renderChildren([c])).join("\n");
    return `<columns>\n${cols}\n</columns>`;
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ state, chain }) => {
          const n = Math.max(2, Math.min(5, count));
          const { $from } = state.selection;
          const top = $from.depth >= 1 ? $from.before(1) : 0;
          const after = $from.depth >= 1 ? top + $from.node(1).nodeSize : state.doc.content.size;
          const empty = $from.depth >= 1 && $from.node(1).isTextblock && $from.node(1).content.size === 0;
          const cols = Array.from({ length: n }, () => ({ type: "column", content: [{ type: "paragraph" }] }));
          return chain()
            .insertContentAt(empty ? { from: top, to: after } : after, { type: this.name, content: cols })
            .command(({ tr }) => {
              const at = (empty ? top : after) + 3;
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))));
              return true;
            })
            .run();
        },
    };
  },
  addProseMirrorPlugins() {
    return [columnsCleanup()];
  },
});

/** A row left with one column becomes normal blocks again; widths always add up to 100 %. */
function columnsCleanup() {
  return new Plugin({
    key: new PluginKey("columnsCleanup"),
    appendTransaction(trs: readonly Transaction[], _old: EditorState, state: EditorState) {
      if (!trs.some((t) => t.docChanged)) return null;
      const fixes: { pos: number; node: PMNode }[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === "columnList") {
          fixes.push({ pos, node });
          return false;
        }
        return node.isBlock;
      });
      if (!fixes.length) return null;
      let tr: Transaction | null = null;
      for (const { pos, node } of fixes.reverse()) {
        const cols: PMNode[] = [];
        node.forEach((c) => cols.push(c));
        if (cols.length <= 1) {
          tr = tr ?? state.tr;
          const inner = cols.flatMap((c) => {
            const k: PMNode[] = [];
            c.forEach((b) => k.push(b));
            return k;
          });
          tr.replaceWith(pos, pos + node.nodeSize, inner.length ? inner : state.schema.nodes.paragraph.create());
          continue;
        }
        const ws = cols.map((c) => c.attrs.width as number | null);
        if (ws.some((w) => w !== null)) {
          const total = ws.reduce<number>((s, w) => s + (w ?? 1 / cols.length), 0);
          if (Math.abs(total - 1) > 0.02) {
            tr = tr ?? state.tr;
            let p = pos + 1;
            cols.forEach((c, i) => {
              tr!.setNodeMarkup(p, undefined, { ...c.attrs, width: width((ws[i] ?? 1 / cols.length) / total) });
              p += c.nodeSize;
            });
          }
        }
      }
      return tr;
    },
  });
}
