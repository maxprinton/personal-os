// Drag a block to the left or right edge of another block → they become columns (like Notion).
// A blue vertical line shows where it will land; anywhere else the normal drop (blue horizontal line) applies.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, type Slice } from "@tiptap/pm/model";

type Hit = { pos: number; side: "left" | "right"; rect: DOMRect };

function findTarget(view: EditorView, e: DragEvent | MouseEvent): Hit | null {
  const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (!at) return null;
  const { doc } = view.state;
  let p = at.inside >= 0 ? at.inside : at.pos;
  let $p = doc.resolve(p);
  if (at.inside < 0) {
    // Between blocks: take the block right there
    if ($p.depth === 0 && $p.nodeAfter) p = $p.pos;
    else if ($p.depth > 0) p = $p.before($p.depth);
    $p = doc.resolve(p);
  }
  // Climb to a block whose parent is the page or a column
  while ($p.depth > 0 && !["doc", "column"].includes($p.parent.type.name)) {
    p = $p.before($p.depth);
    $p = doc.resolve(p);
  }
  const node = doc.nodeAt(p);
  if (!node || !node.isBlock) return null;
  const sel = view.state.selection;
  if (p >= sel.from && p < sel.to) return null; // onto itself
  const dom = view.nodeDOM(p) as HTMLElement | null;
  if (!dom || !dom.getBoundingClientRect) return null;
  const rect = dom.getBoundingClientRect();
  if (e.clientY < rect.top || e.clientY > rect.bottom) return null;
  const edge = Math.min(140, rect.width * 0.22);
  if (e.clientX > rect.right - edge) return { pos: p, side: "right", rect };
  if (e.clientX < rect.left + Math.min(48, rect.width * 0.08)) return { pos: p, side: "left", rect };
  return null;
}

function drop(view: EditorView, slice: Slice, moved: boolean, hit: Hit): boolean {
  const { schema } = view.state;
  const colType = schema.nodes.column;
  const listType = schema.nodes.columnList;
  if (!colType || !listType) return false;
  const blocks: import("@tiptap/pm/model").Node[] = [];
  slice.content.forEach((n) => {
    if (n.isBlock) blocks.push(n);
  });
  if (!blocks.length) return false;
  const tr = view.state.tr;
  if (moved) tr.deleteSelection();
  const mp = tr.mapping.map(hit.pos);
  const target = tr.doc.nodeAt(mp);
  if (!target) return false;
  const $mp = tr.doc.resolve(mp);
  let newCol;
  try {
    newCol = colType.createChecked({ width: null }, Fragment.from(blocks));
  } catch {
    return false;
  }
  let listPos: number;
  if (target.type === listType) {
    tr.insert(hit.side === "right" ? mp + target.nodeSize - 1 : mp + 1, newCol);
    listPos = mp;
  } else if ($mp.parent.type === colType) {
    const colPos = $mp.before($mp.depth);
    const col = $mp.parent;
    tr.insert(hit.side === "right" ? colPos + col.nodeSize : colPos, newCol);
    listPos = tr.doc.resolve(colPos).before(tr.doc.resolve(colPos).depth);
  } else {
    const targetCol = colType.create({ width: null }, target);
    tr.replaceWith(mp, mp + target.nodeSize, listType.create(null, hit.side === "right" ? [targetCol, newCol] : [newCol, targetCol]));
    listPos = mp;
  }
  // New column → equal widths again
  const list = tr.doc.nodeAt(listPos);
  if (list?.type === listType) {
    let p = listPos + 1;
    list.forEach((c) => {
      if (c.attrs.width !== null) tr.setNodeMarkup(p, undefined, { ...c.attrs, width: null });
      p += c.nodeSize;
    });
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const ColumnsDrop = Extension.create({
  name: "columnsDrop",
  addProseMirrorPlugins() {
    let line: HTMLDivElement | null = null;
    const hostOf = (view: EditorView) => (view.dom.closest(".rich-editor") as HTMLElement | null) ?? view.dom.parentElement;
    const hide = (view: EditorView) => {
      if (line) line.style.display = "none";
      hostOf(view)?.classList.remove("n-side-drop");
    };
    const show = (view: EditorView, hit: Hit) => {
      const host = hostOf(view);
      if (!host) return;
      if (!line || !line.isConnected) {
        line = document.createElement("div");
        line.className = "n-side-drop-line";
        host.appendChild(line);
      }
      line.style.display = "block";
      const h = ((line.offsetParent as HTMLElement | null) ?? host).getBoundingClientRect();
      line.style.left = `${(hit.side === "right" ? hit.rect.right + 2 : hit.rect.left - 6) - h.left}px`;
      line.style.top = `${hit.rect.top - h.top}px`;
      line.style.height = `${hit.rect.height}px`;
      host.classList.add("n-side-drop");
    };
    return [
      new Plugin({
        key: new PluginKey("columnsDrop"),
        props: {
          handleDOMEvents: {
            dragover: (view, e) => {
              if (!view.dragging || !view.editable) return false;
              const hit = findTarget(view, e);
              if (hit) show(view, hit);
              else hide(view);
              return false;
            },
            dragleave: (view, e) => {
              if (!(e.relatedTarget instanceof Node) || !view.dom.contains(e.relatedTarget)) hide(view);
              return false;
            },
            dragend: (view) => {
              hide(view);
              return false;
            },
          },
          handleDrop: (view, event, slice, moved) => {
            hide(view);
            if (!view.dragging) return false;
            const hit = findTarget(view, event);
            if (!hit) return false;
            return drop(view, slice, moved, hit);
          },
        },
      }),
    ];
  },
});
