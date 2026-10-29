// Notion's keyboard shortcuts and typing shortcuts (Windows keys; Mod = Ctrl, ⌘ on Mac).
import { Extension, InputRule, markInputRule, textInputRule, wrappingInputRule } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { currentBlock, duplicateBlock, deleteBlock, moveBlock, setBlockColor, toggleAllToggles, turnInto, type Kind } from "@/lib/editor/transform";
import { createSubpageBlock } from "@/lib/editor/blocks";
import { openSelectedMath } from "@/lib/editor/nodes/math";
import { requestUi } from "@/lib/editor/ui-events";

const NUMBER_KINDS: Record<string, Kind | "page"> = {
  "0": "text",
  "1": "h1",
  "2": "h2",
  "3": "h3",
  "4": "todo",
  "5": "bullet",
  "6": "ordered",
  "7": "toggle",
  "8": "code",
  "9": "page",
};

export const NotionKeymap = Extension.create({
  name: "notionKeymap",
  priority: 120,
  addKeyboardShortcuts() {
    const e = this.editor;
    const keys: Record<string, () => boolean> = {};
    for (const [n, kind] of Object.entries(NUMBER_KINDS)) {
      keys[`Mod-Shift-${n}`] = () => {
        const b = currentBlock(e);
        if (!b) return false;
        if (kind === "page") {
          const title = b.node.textContent;
          if (!e.storage.notion.createSubpage) return true;
          e.view.dispatch(e.state.tr.delete(b.pos, b.pos + b.node.nodeSize));
          void createSubpageBlock(e, undefined, title);
          return true;
        }
        return turnInto(e, b.pos, kind);
      };
    }
    return {
      ...keys,
      "Mod-d": () => {
        const b = currentBlock(e);
        return b ? duplicateBlock(e, b.pos) : false;
      },
      "Mod-Shift-ArrowUp": () => {
        const b = currentBlock(e);
        return b ? moveBlock(e, b.pos, -1) : false;
      },
      "Mod-Shift-ArrowDown": () => {
        const b = currentBlock(e);
        return b ? moveBlock(e, b.pos, 1) : false;
      },
      "Mod-Alt-t": () => toggleAllToggles(e),
      "Mod-Shift-h": () => {
        const c = e.storage.notion.lastColor;
        if (!c) return false;
        if (!e.state.selection.empty && !(e.state.selection instanceof NodeSelection)) return e.chain().focus().setTextColor(c).run();
        const b = currentBlock(e);
        return b ? setBlockColor(e, b.pos, c) : false;
      },
      "Mod-Shift-e": () => {
        const { from, to, empty } = e.state.selection;
        const text = empty ? "" : e.state.doc.textBetween(from, to, " ");
        e.chain().focus().deleteSelection().insertInlineMath(text).run();
        if (!text) openSelectedMath(e);
        return true;
      },
      "Mod-k": () => {
        requestUi(e.view, { kind: "link" });
        return true;
      },
      "Mod-/": () => {
        const b = currentBlock(e);
        if (!b) return false;
        const dom = e.view.nodeDOM(b.pos) as HTMLElement | null;
        const rect = dom?.getBoundingClientRect?.() ?? new DOMRect(100, 100, 0, 0);
        requestUi(e.view, { kind: "blockMenu", pos: b.pos, rect });
        return true;
      },
      // Ctrl+Enter: tick the to-do / open or close the toggle / open the page
      "Mod-Enter": () => {
        const { $from } = e.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === "taskItem") {
            e.view.dispatch(e.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, checked: !n.attrs.checked }));
            return true;
          }
          if (n.type.name === "details") {
            e.view.dispatch(e.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, open: !n.attrs.open }));
            return true;
          }
        }
        const sel = e.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === "pageLink") {
          e.storage.notion.navigate(sel.node.attrs.url);
          return true;
        }
        return false;
      },
      // Esc selects the block you are writing in (Notion); Esc again goes back to writing
      Escape: () => {
        if (e.storage.notion.menuOpen) return false;
        const sel = e.state.selection;
        if (sel instanceof NodeSelection) {
          const inside = sel.node.isTextblock || sel.node.firstChild?.isTextblock;
          if (!inside) return false;
          e.view.dispatch(e.state.tr.setSelection(TextSelection.near(e.state.doc.resolve(sel.from + 1))));
          return true;
        }
        const b = currentBlock(e);
        if (!b) return false;
        e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, b.pos)));
        return true;
      },
      // With a block selected: Delete/Backspace remove it, Enter goes back to writing
      Backspace: () => {
        const sel = e.state.selection;
        if (sel instanceof NodeSelection && sel.node.isBlock) return deleteBlock(e, sel.from);
        // At the start of a heading / quote / toggle: back to plain text first, like Notion
        const { $from, empty } = sel;
        if (!empty || $from.parentOffset !== 0) return false;
        const node = $from.parent;
        if (node.type.name === "heading") return turnInto(e, $from.before(), "text");
        if (node.type.name === "detailsSummary") return turnInto(e, $from.before($from.depth - 1), "text");
        if ($from.depth >= 2 && $from.node(-1).type.name === "blockquote" && $from.index(-1) === 0) return e.commands.lift("blockquote");
        return false;
      },
      Delete: () => {
        const sel = e.state.selection;
        if (sel instanceof NodeSelection && sel.node.isBlock) return deleteBlock(e, sel.from);
        return false;
      },
    };
  },
  addInputRules() {
    const s = this.editor.schema;
    const rules: InputRule[] = [];
    // ">" + space → toggle list (Notion), '"' + space → quote
    if (s.nodes.details) {
      const editor = this.editor;
      rules.push(
        new InputRule({
          find: /^>\s$/,
          handler: ({ state, range }) => {
            // the rule's own transaction removes ">"; the block becomes a toggle right after it
            state.tr.delete(range.from, range.to);
            setTimeout(() => {
              const b = currentBlock(editor);
              if (b) turnInto(editor, b.pos, "toggle");
            }, 0);
          },
        }),
      );
    }
    if (s.nodes.blockquote) rules.push(wrappingInputRule({ find: /^["“”]\s$/, type: s.nodes.blockquote }));
    // "a. " / "i. " → numbered list
    if (s.nodes.orderedList) rules.push(wrappingInputRule({ find: /^(a|i)\.\s$/, type: s.nodes.orderedList }));
    // ~strike~ with one tilde (Notion)
    if (s.marks.strike) rules.push(markInputRule({ find: /(?:^|\s)(~(?!~)((?:[^~\s][^~]*?))~(?!~))$/, type: s.marks.strike }));
    // Arrows
    rules.push(textInputRule({ find: /->$/, replace: "→" }), textInputRule({ find: /<-$/, replace: "←" }), textInputRule({ find: /←>$/, replace: "↔" }));
    return rules;
  },
});
