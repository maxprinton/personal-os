// Button (Notion's "/button", formerly template button): one click inserts a copy of the blocks you
// set up inside it, right below the button. ⚙ shows/hides those blocks and lets you rename it.
//   <button label="New to-do">
//
//   - [ ]
//
//   </button>
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { attrString, blockTagTokenizer, type TagToken } from "@/lib/editor/tags";

export const NotionButton = Node.create({
  name: "notionButton",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,
  draggable: true,
  addAttributes() {
    return { label: { default: "Button", parseHTML: (el) => el.getAttribute("data-label") ?? "Button" } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="notion-button"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "notion-button", "data-label": node.attrs.label }), 0];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "n-button";
      const bar = document.createElement("div");
      bar.className = "n-button-bar";
      bar.contentEditable = "false";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "n-button-main";
      const gear = document.createElement("button");
      gear.type = "button";
      gear.className = "n-button-gear";
      gear.title = "Edit button";
      gear.textContent = "⚙";
      const label = document.createElement("input");
      label.className = "n-button-label";
      label.placeholder = "Button name";
      const hint = document.createElement("span");
      hint.className = "n-button-hint";
      hint.textContent = "Clicking inserts these blocks below:";
      bar.append(btn, gear, label, hint);
      const body = document.createElement("div");
      body.className = "n-button-body";
      dom.append(bar, body);
      const paint = () => {
        btn.textContent = `✦ ${current.attrs.label || "Button"}`;
        if (document.activeElement !== label) label.value = current.attrs.label || "";
      };
      paint();
      const pos = () => (typeof getPos === "function" ? getPos() : undefined);
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const p = pos();
        if (typeof p !== "number" || !editor.isEditable) return;
        const at = p + current.nodeSize;
        const tr = editor.state.tr.insert(at, current.content);
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))));
        editor.view.dispatch(tr.scrollIntoView());
        editor.view.focus();
      });
      gear.addEventListener("mousedown", (e) => e.preventDefault());
      gear.addEventListener("click", () => dom.classList.toggle("is-editing"));
      label.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") label.blur();
      });
      label.addEventListener("change", () => {
        const p = pos();
        if (typeof p !== "number") return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...current.attrs, label: label.value.trim() || "Button" }));
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
        stopEvent: (e) => bar.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => m.type !== "selection" && bar.contains(m.target as globalThis.Node),
      };
    };
  },
  markdownTokenName: "notionButton",
  markdownTokenizer: blockTagTokenizer("button", "notionButton", "blocks"),
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    const body = t.children?.length ? h.parseChildren(t.children as never) : [];
    return h.createNode("notionButton", { label: t.attrs.label ?? "Button" }, body.length ? body : [{ type: "paragraph" }]);
  },
  renderMarkdown: (node, h) => {
    const body = h.renderChildren((node.content ?? []) as JSONContent[], "\n\n").trim();
    return `<button${attrString({ label: (node.attrs?.label as string) || "Button" })}>\n\n${body}\n\n</button>`;
  },
});
