// Block operations shared by the "/" menu, the ⋮⋮ menu and the Notion shortcuts:
// turn into, color, duplicate, move up/down, find the block under the cursor.
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { normalizeColor } from "@/lib/editor/colors";

export type Kind =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "todo"
  | "bullet"
  | "ordered"
  | "toggle"
  | "th1"
  | "th2"
  | "th3"
  | "quote"
  | "callout"
  | "code";

const LIST_ITEMS = new Set(["listItem", "taskItem"]);
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * The "Notion block" the cursor is in: a list item (not its paragraph), a toggle (when in its title),
 * otherwise the text block itself. Returns its position, or null.
 */
export function currentBlock(editor: Editor): { pos: number; node: PMNode } | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.isTextblock) {
      const parent = d > 1 ? $from.node(d - 1) : null;
      if (parent && (LIST_ITEMS.has(parent.type.name) && $from.index(d - 1) === 0)) return { pos: $from.before(d - 1), node: parent };
      if (parent && node.type.name === "detailsSummary") return { pos: $from.before(d - 1), node: parent };
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/** Text (inline JSON) and child blocks of any block, to rebuild it as another type. */
function explode(node: PMNode): { text: JSONContent[]; children: JSONContent[]; color: string | null } | null {
  const json = node.toJSON() as JSONContent;
  const kids = (json.content ?? []) as JSONContent[];
  const color = normalizeColor((node.attrs?.color as string) ?? null);
  switch (node.type.name) {
    case "paragraph":
    case "heading":
      return { text: kids, children: [], color };
    case "codeBlock":
      return { text: node.textContent ? [{ type: "text", text: node.textContent }] : [], children: [], color: null };
    case "listItem":
    case "taskItem":
    case "blockquote":
    case "callout": {
      const first = kids[0];
      if (first && (first.type === "paragraph" || first.type === "heading")) {
        return { text: first.content ?? [], children: kids.slice(1), color: color ?? normalizeColor((first.attrs?.color as string) ?? null) };
      }
      return { text: [], children: kids, color };
    }
    case "details": {
      const summary = kids.find((k) => k.type === "detailsSummary");
      const content = kids.find((k) => k.type === "detailsContent");
      const children = (content?.content ?? []).filter((c, i, a) => !(a.length === 1 && c.type === "paragraph" && !c.content?.length));
      return { text: summary?.content ?? [], children, color };
    }
    default:
      return null;
  }
}

const para = (text: JSONContent[], color?: string | null): JSONContent => ({
  type: "paragraph",
  ...(color ? { attrs: { color } } : {}),
  ...(text.length ? { content: text } : {}),
});

function build(kind: Kind, text: JSONContent[], children: JSONContent[], color: string | null): JSONContent[] {
  switch (kind) {
    case "text":
      return [para(text, color), ...children];
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return [{ type: "heading", attrs: { level: Number(kind[1]), ...(color ? { color } : {}) }, ...(text.length ? { content: text } : {}) }, ...children];
    case "todo":
      return [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [para(text, color), ...children] }] }];
    case "bullet":
      return [{ type: "bulletList", content: [{ type: "listItem", content: [para(text, color), ...children] }] }];
    case "ordered":
      return [{ type: "orderedList", content: [{ type: "listItem", content: [para(text, color), ...children] }] }];
    case "toggle":
    case "th1":
    case "th2":
    case "th3":
      return [
        {
          type: "details",
          attrs: { heading: kind === "toggle" ? 0 : Number(kind[2]), color, open: true },
          content: [
            { type: "detailsSummary", ...(text.length ? { content: text } : {}) },
            { type: "detailsContent", content: children.length ? children : [{ type: "paragraph" }] },
          ],
        },
      ];
    case "quote":
      return [{ type: "blockquote", content: [para(text, color), ...children] }];
    case "callout":
      return [{ type: "callout", attrs: { icon: "💡", color: color ?? "gray_bg" }, content: [para(text), ...children] }];
    case "code": {
      const plain = text.map((t) => (t.type === "text" ? t.text ?? "" : t.type === "hardBreak" ? "\n" : "")).join("");
      return [{ type: "codeBlock", attrs: { language: null }, ...(plain ? { content: [{ type: "text", text: plain }] } : {}) }, ...children];
    }
  }
}

/** Moves the cursor to the end of the first text block at/after pos. */
function caretInto(tr: import("@tiptap/pm/state").Transaction, pos: number) {
  let target = -1;
  tr.doc.nodesBetween(pos, Math.min(tr.doc.content.size, pos + 4000), (n, p) => {
    if (target >= 0) return false;
    if (n.isTextblock) {
      target = p + 1 + n.content.size;
      return false;
    }
    return true;
  });
  if (target >= 0) tr.setSelection(TextSelection.create(tr.doc, target));
}

/** Notion's "Turn into" for the block at pos. */
export function turnInto(editor: Editor, pos: number, kind: Kind): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const parts = explode(node);
  if (!parts) return false;
  const built = build(kind, parts.text, parts.children, parts.color);
  let nodes: PMNode[];
  try {
    nodes = built.map((j) => state.schema.nodeFromJSON(j));
  } catch {
    return false;
  }
  const tr = state.tr;
  const $pos = state.doc.resolve(pos);
  if (LIST_ITEMS.has(node.type.name) && LISTS.has($pos.parent.type.name)) {
    // Take the item out of its list: items before and after stay lists
    const list = $pos.parent;
    const listPos = $pos.before($pos.depth);
    const i = $pos.index();
    const before: PMNode[] = [];
    const after: PMNode[] = [];
    list.forEach((item, _o, j) => (j < i ? before : j > i ? after : []).push(item));
    const one = nodes.length === 1 ? nodes[0] : null;
    let out: PMNode[];
    let caretAt = listPos;
    if (one && one.type === list.type) {
      // Same kind of list as its neighbors (e.g. a bullet with other bullets): it stays in that list
      const items: PMNode[] = [];
      one.forEach((it) => items.push(it));
      out = [list.type.create(list.attrs, [...before, ...items, ...after])];
      caretAt = listPos + 1 + before.reduce((s, b) => s + b.nodeSize, 0);
    } else {
      out = [];
      if (before.length) out.push(list.type.create(list.attrs, before));
      out.push(...nodes);
      if (after.length) out.push(list.type.create(list.attrs, after));
      if (before.length) caretAt += out[0].nodeSize;
    }
    try {
      tr.replaceWith(listPos, listPos + list.nodeSize, out);
    } catch {
      return false;
    }
    caretInto(tr, caretAt);
  } else {
    try {
      tr.replaceWith(pos, pos + node.nodeSize, nodes);
    } catch {
      return false;
    }
    caretInto(tr, pos);
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** Notion's block color: on the text block (list items: their first line; callouts/toggles: the box). */
export function setBlockColor(editor: Editor, pos: number, color: string | null): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const c = normalizeColor(color);
  const tr = state.tr;
  const set = (p: number, n: PMNode) => {
    if ("color" in n.attrs) tr.setNodeMarkup(p, undefined, { ...n.attrs, color: c });
  };
  if (["paragraph", "heading", "details", "callout", "tableOfContents"].includes(node.type.name)) set(pos, node);
  else if (LIST_ITEMS.has(node.type.name) || node.type.name === "blockquote" || node.type.name === "column") {
    let p = pos + 1;
    node.forEach((child, _o, i) => {
      if (child.isTextblock && (node.type.name !== "listItem" && node.type.name !== "taskItem" ? true : i === 0)) set(p, child);
      p += child.nodeSize;
    });
  } else if (node.type.name === "columnList") {
    node.descendants((child, p) => {
      if (child.isTextblock) set(pos + 1 + p, child);
      return true;
    });
  } else return false;
  editor.view.dispatch(tr);
  return true;
}

export function duplicateBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const copy = node.type.name === "paragraph" || node.type.name === "heading" ? node.type.create({ ...node.attrs, blockId: null }, node.content, node.marks) : node;
  const at = pos + node.nodeSize;
  const tr = editor.state.tr.insert(at, copy);
  if (copy.isTextblock) tr.setSelection(TextSelection.create(tr.doc, at + 1 + copy.content.size));
  else tr.setSelection(NodeSelection.create(tr.doc, at));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function deleteBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const tr = editor.state.tr.delete(pos, pos + node.nodeSize);
  if (tr.doc.content.size === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
  const near = Math.min(pos, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(near), -1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Ctrl+Shift+↑/↓: swap the block with its neighbor (inside the same parent). */
export function moveBlock(editor: Editor, pos: number, dir: -1 | 1): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const j = index + dir;
  if (j < 0 || j >= parent.childCount) return false;
  const other = parent.child(j);
  const tr = state.tr;
  const sel = state.selection;
  const inside = sel.from - pos;
  if (dir === -1) {
    const otherPos = pos - other.nodeSize;
    tr.replaceWith(otherPos, pos + node.nodeSize, [node, other]);
    const np = otherPos;
    if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, np));
    else tr.setSelection(TextSelection.create(tr.doc, np + inside));
  } else {
    const end = pos + node.nodeSize + other.nodeSize;
    tr.replaceWith(pos, end, [other, node]);
    const np = pos + other.nodeSize;
    if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, np));
    else tr.setSelection(TextSelection.create(tr.doc, np + inside));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Ctrl+Alt+T: open all toggles, or close all when they are all open. */
export function toggleAllToggles(editor: Editor) {
  const { state } = editor;
  const toggles: { pos: number; node: PMNode }[] = [];
  state.doc.descendants((n, p) => {
    if (n.type.name === "details") toggles.push({ pos: p, node: n });
    return true;
  });
  if (!toggles.length) return false;
  const open = !toggles.every((t) => t.node.attrs.open);
  const tr = state.tr;
  toggles.forEach((t) => tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, open }));
  editor.view.dispatch(tr);
  return true;
}

/** Short random id for "Copy link to block". */
export const newBlockId = () => Math.random().toString(36).slice(2, 8);

/** Words and characters of a block (or the whole page), for the menus' footer. */
export function countWords(text: string) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, chars: text.length };
}
