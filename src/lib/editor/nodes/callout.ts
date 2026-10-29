// Callout (Notion): a colored box with an emoji that holds any blocks.
//   <callout icon="💡" color="gray_bg">
//
//   text **and** more blocks
//
//   </callout>
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { normalizeColor } from "@/lib/editor/colors";
import { attrString, blockTagTokenizer, type TagToken } from "@/lib/editor/tags";
import { requestUi } from "@/lib/editor/ui-events";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the current block in a callout. */
      setCallout: (attrs?: { icon?: string; color?: string }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      icon: { default: "💡", parseHTML: (el) => el.getAttribute("data-icon") ?? "💡" },
      color: { default: "gray_bg", parseHTML: (el) => normalizeColor(el.getAttribute("data-color")) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]', contentElement: ".n-callout-body" }, { tag: "aside" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "callout", "data-icon": node.attrs.icon, "data-color": node.attrs.color ?? undefined, class: "n-callout" }),
      ["span", { class: "n-callout-icon", contenteditable: "false" }, node.attrs.icon || ""],
      ["div", { class: "n-callout-body" }, 0],
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "n-callout";
      dom.setAttribute("data-type", "callout");
      const icon = document.createElement("button");
      icon.type = "button";
      icon.className = "n-callout-icon";
      icon.contentEditable = "false";
      icon.title = "Change icon";
      const body = document.createElement("div");
      body.className = "n-callout-body";
      dom.append(icon, body);
      const paint = () => {
        icon.textContent = current.attrs.icon || "";
        icon.classList.toggle("is-empty", !current.attrs.icon);
        if (current.attrs.color) dom.setAttribute("data-color", current.attrs.color);
        else dom.removeAttribute("data-color");
      };
      paint();
      icon.addEventListener("mousedown", (e) => e.preventDefault());
      icon.addEventListener("click", () => {
        if (!editor.isEditable) return;
        requestUi(editor.view, {
          kind: "emoji",
          rect: icon.getBoundingClientRect(),
          allowRemove: true,
          onPick: (emoji) => {
            const pos = typeof getPos === "function" ? getPos() : undefined;
            if (typeof pos !== "number") return;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, icon: emoji ?? "" }));
          },
        });
      });
      return {
        dom,
        contentDOM: body,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          paint();
          return true;
        },
        ignoreMutation: (m) => m.type !== "selection" && icon.contains(m.target as globalThis.Node),
      };
    };
  },
  markdownTokenizer: blockTagTokenizer("callout", "callout", "blocks"),
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    const body = t.children?.length ? h.parseChildren(t.children as never) : [];
    return h.createNode("callout", { icon: t.attrs.icon ?? "💡", color: normalizeColor(t.attrs.color) }, body.length ? body : [{ type: "paragraph" }]);
  },
  renderMarkdown: (node, h) => {
    const body = h.renderChildren((node.content ?? []) as JSONContent[], "\n\n").trim();
    return `<callout${attrString({ icon: node.attrs?.icon ?? "", color: normalizeColor(node.attrs?.color as string) })}>\n\n${body}\n\n</callout>`;
  },
  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ state, chain }) => {
          const { $from, $to } = state.selection;
          const range = $from.blockRange($to);
          if (!range) return false;
          const slice = state.doc.slice(range.start, range.end).toJSON()?.content ?? [{ type: "paragraph" }];
          return chain()
            .insertContentAt({ from: range.start, to: range.end }, { type: this.name, attrs: { icon: attrs.icon ?? "💡", color: attrs.color ?? "gray_bg" }, content: slice })
            .command(({ tr }) => {
              const pos = Math.min(range.start + 2, tr.doc.content.size);
              tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
              return true;
            })
            .run();
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter on an empty last line leaves the callout; Backspace at its very start turns it back into text
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.depth < 2) return false;
        const box = $from.node(-1);
        if (box.type.name !== this.name) return false;
        const para = $from.parent;
        const isLast = $from.index(-1) === box.childCount - 1;
        if (!isLast || para.content.size !== 0 || box.childCount < 2) return false;
        return editor.commands.lift("paragraph");
      },
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.depth < 2) return false;
        if ($from.node(-1).type.name !== this.name || $from.index(-1) !== 0) return false;
        return editor.commands.lift($from.parent.type.name);
      },
    };
  },
});
