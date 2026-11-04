// While a block is dragged (⋮⋮ handle): (1) a copy of the block follows the mouse so you see what you are moving,
// and the original dims; (2) the page scrolls by itself when the mouse is near the top or bottom edge
// (faster the closer it gets), also when the mouse is over the margins outside the text.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const EDGE = 110; // px from the top/bottom edge where scrolling starts
const MAX_SPEED = 30; // px per frame at the very edge

/** The nearest ancestor that scrolls, or null for the window. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n && n !== document.body; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll" || o === "overlay") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

const BLANK = (() => {
  if (typeof Image === "undefined") return null;
  const i = new Image();
  i.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  return i;
})();

export const DragAssist = Extension.create({
  name: "dragAssist",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("dragAssist"),
        view(view: EditorView) {
          let active = false;
          let ghost: HTMLElement | null = null;
          let source: HTMLElement | null = null;
          let y = 0;
          let raf = 0;

          const stop = () => {
            active = false;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            ghost?.remove();
            ghost = null;
            source?.classList.remove("n-drag-source");
            source = null;
          };

          const tick = () => {
            raf = 0;
            if (!active) return;
            const sc = scroller(view.dom as HTMLElement);
            const box = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
            const top = Math.max(0, box.top);
            const bottom = Math.min(window.innerHeight, box.bottom);
            const edge = Math.min(EDGE, (bottom - top) / 3);
            let dy = 0;
            if (y < top + edge) dy = -MAX_SPEED * Math.min(1, (top + edge - y) / edge) ** 2;
            else if (y > bottom - edge) dy = MAX_SPEED * Math.min(1, (y - (bottom - edge)) / edge) ** 2;
            if (Math.abs(dy) >= 0.5) {
              if (sc) sc.scrollTop += dy;
              else window.scrollBy(0, dy);
            }
            raf = requestAnimationFrame(tick);
          };

          const onStart = (e: DragEvent) => {
            const t = e.target as Element | null;
            const fromHandle = !!t?.closest?.(".rich-handle, [data-drag-handle]");
            if (!fromHandle && !view.dragging) return;
            active = true;
            y = e.clientY;
            // Our own preview replaces the browser's faint one (this listener runs after the handle's own)
            if (BLANK && e.dataTransfer) e.dataTransfer.setDragImage(BLANK, 0, 0);
            const sel = view.state.selection;
            let dom: HTMLElement | null = null;
            if (sel instanceof NodeSelection) {
              const n = view.nodeDOM(sel.from);
              if (n instanceof HTMLElement) dom = n;
            }
            ghost = document.createElement("div");
            ghost.className = "n-drag-ghost rich-prose";
            if (dom) {
              ghost.style.width = `${Math.min(520, dom.getBoundingClientRect().width)}px`;
              ghost.appendChild(dom.cloneNode(true));
              source = dom;
              dom.classList.add("n-drag-source");
            } else {
              const text = view.dragging?.slice.content.textBetween(0, view.dragging.slice.content.size, " ", " ") ?? "";
              ghost.textContent = text.slice(0, 140) || "Moving block";
            }
            ghost.style.left = `${e.clientX + 14}px`;
            ghost.style.top = `${e.clientY + 10}px`;
            document.body.appendChild(ghost);
            if (!raf) raf = requestAnimationFrame(tick);
          };
          const onOver = (e: DragEvent) => {
            if (!active) return;
            y = e.clientY;
            if (ghost) {
              ghost.style.left = `${e.clientX + 14}px`;
              ghost.style.top = `${e.clientY + 10}px`;
            }
            if (!raf) raf = requestAnimationFrame(tick);
          };

          document.addEventListener("dragstart", onStart); // bubble: after the handle's own listener
          document.addEventListener("dragover", onOver, true);
          document.addEventListener("dragend", stop, true);
          document.addEventListener("drop", stop, true);
          return {
            destroy() {
              stop();
              document.removeEventListener("dragstart", onStart);
              document.removeEventListener("dragover", onOver, true);
              document.removeEventListener("dragend", stop, true);
              document.removeEventListener("drop", stop, true);
            },
          };
        },
      }),
    ];
  },
});
