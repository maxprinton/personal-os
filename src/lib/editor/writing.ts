// Writing check inside the notes editor: after a pause of ~0.8 s the paragraphs you changed are checked
// (spelling in Spanish and English + the rules, src/lib/writing) and problems get a wavy underline.
// Click / tap one → editor.storage.writing.onOpen(hit) opens the menu (RichEditor). Code, links,
// mentions and other chips are skipped. While the dictionaries work, the browser's own red underline
// is turned off here so there are never two.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { checkWriting, onWritingChange, writingStatus } from "@/lib/writing/client";
import type { Issue, Lang } from "@/lib/writing/types";

export type WritingHit = { issue: Issue; from: number; to: number; ignoreKey: string };
export type WritingStorage = {
  enabled: boolean;
  /** "Ignore in this note" words (lower case). */
  ignoreNote: Set<string>;
  /** "Ignore here": word + paragraph text. */
  ignoreHere: Set<string>;
  onOpen: ((hit: WritingHit, rect: { left: number; top: number; bottom: number }) => void) | null;
};

type Range = { from: number; to: number };
type State = { decos: DecorationSet; dirty: Range[]; all: boolean };
type Meta = { type: "set"; from: number; to: number; decos: Decoration[] } | { type: "clearDirty" } | { type: "all" } | { type: "remove"; from: number; to: number } | { type: "off" };

declare module "@tiptap/core" {
  interface Storage {
    writing: WritingStorage;
  }
}

export const writingKey = new PluginKey<State>("writingCheck");
const DELAY = 800;
const MAX_BLOCKS = 400;

export { blockText, hereKey } from "@/lib/editor/writing-text";
import { blockText, hereKey } from "@/lib/editor/writing-text";

function blocksIn(doc: PMNode, ranges: Range[]) {
  const found = new Map<number, PMNode>();
  for (const r of ranges) {
    const from = Math.max(0, Math.min(r.from, doc.content.size));
    const to = Math.max(from, Math.min(r.to, doc.content.size));
    doc.nodesBetween(from, to, (node, pos) => {
      if (found.size >= MAX_BLOCKS) return false;
      if (node.isTextblock) {
        if (node.type.name !== "codeBlock") found.set(pos, node);
        return false;
      }
      return true;
    });
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]);
}

export const WritingCheck = Extension.create<object, WritingStorage>({
  name: "writing",

  addStorage() {
    return { enabled: true, ignoreNote: new Set<string>(), ignoreHere: new Set<string>(), onOpen: null };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<State>({
        key: writingKey,
        state: {
          init: () => ({ decos: DecorationSet.empty, dirty: [], all: true }),
          apply(tr, v) {
            let decos = v.decos.map(tr.mapping, tr.doc);
            let dirty = v.dirty.map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }));
            let all = v.all;
            if (tr.docChanged) {
              tr.mapping.maps.forEach((map, i) => {
                const rest = tr.mapping.slice(i + 1);
                map.forEach((_a, _b, start, end) => {
                  const r = { from: rest.map(start, -1), to: rest.map(end, 1) };
                  dirty.push(r);
                  // the underline under what you are typing goes away until the next check
                  decos = decos.remove(decos.find(Math.max(0, r.from - 1), r.to + 1));
                });
              });
            }
            const meta = tr.getMeta(writingKey) as Meta | undefined;
            if (meta?.type === "set") decos = decos.remove(decos.find(meta.from, meta.to)).add(tr.doc, meta.decos);
            else if (meta?.type === "remove") decos = decos.remove(decos.find(meta.from, meta.to));
            else if (meta?.type === "clearDirty") {
              dirty = [];
              all = false;
            } else if (meta?.type === "all") all = true;
            else if (meta?.type === "off") {
              decos = DecorationSet.empty;
              dirty = [];
              all = false;
            }
            return { decos, dirty, all };
          },
        },
        props: {
          decorations: (state) => writingKey.getState(state)?.decos ?? null,
          // no second underline from the browser while ours works
          attributes: (): Record<string, string> => ({ spellcheck: storage.enabled && writingStatus().loaded && (writingStatus().es || writingStatus().en) ? "false" : "true" }),
          handleClick(view, pos) {
            const st = writingKey.getState(view.state);
            const d = st?.decos.find(pos, pos).find((x) => x.from <= pos && pos <= x.to);
            if (!d || !storage.onOpen) return false;
            const spec = d.spec as { issue: Issue; key: string };
            const at = view.coordsAtPos(d.from);
            const end = view.coordsAtPos(d.to);
            storage.onOpen({ issue: spec.issue, from: d.from, to: d.to, ignoreKey: spec.key }, { left: at.left, top: at.top, bottom: Math.max(at.bottom, end.bottom) });
            return false; // the caret still goes where you clicked
          },
        },
        view(view: EditorView) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let running = false;
          let gone = false;
          const schedule = (ms = DELAY) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void run(), ms);
          };
          const run = async () => {
            timer = null;
            if (gone) return;
            if (running) return schedule();
            const st = writingKey.getState(view.state);
            if (!st) return;
            if (!storage.enabled) {
              if (st.decos !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(writingKey, { type: "off" } satisfies Meta).setMeta("addToHistory", false));
              return;
            }
            const doc = view.state.doc;
            const ranges = st.all ? [{ from: 0, to: doc.content.size }] : st.dirty;
            if (!ranges.length) return;
            view.dispatch(view.state.tr.setMeta(writingKey, { type: "clearDirty" } satisfies Meta).setMeta("addToHistory", false));
            running = true;
            let prevLang: Lang | undefined;
            try {
              for (const [pos, node] of blocksIn(doc, ranges)) {
                const { text, pos: at } = blockText(node, pos + 1);
                let decos: Decoration[] = [];
                if (text.trim()) {
                  const res = await checkWriting(text, [...storage.ignoreNote], prevLang);
                  prevLang = res.lang;
                  if (gone) return;
                  decos = res.issues
                    .filter((i) => !storage.ignoreHere.has(hereKey(i.word, text)) && i.to > i.from)
                    .map((i) => {
                      const from = at[i.from];
                      const to = at[i.to - 1] + 1;
                      return Decoration.inline(from, to, { class: `wc wc-${i.kind}`, title: i.message }, { issue: i, key: hereKey(i.word, text) });
                    });
                }
                // the paragraph changed (or moved) while it was being checked: the next round takes it
                if (view.state.doc.nodeAt(pos) !== node) continue;
                view.dispatch(view.state.tr.setMeta(writingKey, { type: "set", from: pos, to: pos + node.nodeSize, decos } satisfies Meta).setMeta("addToHistory", false));
              }
            } finally {
              running = false;
            }
            const after = writingKey.getState(view.state);
            if (after && (after.all || after.dirty.length)) schedule();
          };
          // Dictionaries loaded / words added: check everything again
          const off = onWritingChange(() => {
            if (gone) return;
            view.dispatch(view.state.tr.setMeta(writingKey, { type: "all" } satisfies Meta).setMeta("addToHistory", false));
          });
          schedule(400);
          return {
            update(v, prev) {
              const s = writingKey.getState(v.state);
              if (v.state.doc !== prev.doc || s?.all) schedule();
            },
            destroy() {
              gone = true;
              off();
              if (timer) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});

/** Underline gone without a change (Ignore here). */
export function removeWritingMark(view: EditorView, from: number, to: number) {
  view.dispatch(view.state.tr.setMeta(writingKey, { type: "remove", from, to } satisfies Meta).setMeta("addToHistory", false));
}
/** Check the whole note again (ignored words changed). */
export function recheckAll(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(writingKey, { type: "all" } satisfies Meta).setMeta("addToHistory", false));
}
