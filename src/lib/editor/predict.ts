// Next-word prediction in the notes editor, like a phone keyboard: the word you usually write next
// (or the end of the word you are typing) shows in gray after the cursor. Tab adds it (with a space);
// on the phone, tap the gray word. Esc or any other key: keep writing. Learns from every paragraph
// you finish. Nothing here uses the AI (src/lib/writing/predict.ts).
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { ensurePredictModel, learnText, predictNext, writingSettings } from "@/lib/writing/client";
import { predictOn, type WritingArea } from "@/lib/writing/settings";
import type { Prediction } from "@/lib/writing/predict";

type Ghost = { pos: number; p: Prediction } | null;
type State = { ghost: Ghost; hidden: boolean };
export type PredictStorage = { enabled: boolean; area: WritingArea };

declare module "@tiptap/core" {
  interface Storage {
    predict: PredictStorage;
  }
}

export const predictKey = new PluginKey<State>("writingPredict");

function textBefore(state: EditorState): { before: string; start: number } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $p = sel.$from;
  const parent = $p.parent;
  if (!parent.isTextblock || parent.type.name === "codeBlock") return null;
  if ($p.marks().some((m) => m.type.name === "code" || m.type.name === "link")) return null;
  // only at the end of a word: the next character is the end of the paragraph or a space
  const after = parent.textBetween($p.parentOffset, Math.min(parent.content.size, $p.parentOffset + 1), "\n", "￼");
  if (after && !/\s/.test(after)) return null;
  return { before: parent.textBetween(0, $p.parentOffset, "\n", "￼"), start: $p.start() };
}

function accept(view: EditorView, g: NonNullable<Ghost>) {
  const { state } = view;
  if (state.selection.from !== g.pos) return false;
  const next = state.doc.textBetween(g.pos, Math.min(state.doc.content.size, g.pos + 1), "\n", "￼");
  const text = g.p.insert + (next === " " ? "" : " ");
  view.dispatch(state.tr.insertText(text, g.pos).setMeta(predictKey, { ghost: null }));
  view.focus();
  return true;
}

export const WritingPredict = Extension.create<object, PredictStorage>({
  name: "predict",
  priority: 1000, // Tab here first (only while a suggestion shows and no menu is open)

  addStorage() {
    return { enabled: true, area: "notes" };
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const g = predictKey.getState(editor.state)?.ghost;
        if (!g || editor.storage.notion?.menuOpen) return false;
        return accept(editor.view, g);
      },
      Escape: ({ editor }) => {
        const g = predictKey.getState(editor.state)?.ghost;
        if (!g) return false;
        editor.view.dispatch(editor.state.tr.setMeta(predictKey, { ghost: null, hidden: true }));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const on = () => storage.enabled && predictOn(writingSettings(), storage.area);
    return [
      new Plugin<State>({
        key: predictKey,
        state: {
          init: () => ({ ghost: null, hidden: false }),
          apply(tr, v) {
            const meta = tr.getMeta(predictKey) as Partial<State> | undefined;
            if (meta) return { ghost: meta.ghost ?? null, hidden: meta.hidden ?? false };
            if (tr.docChanged || tr.selectionSet) return { ghost: null, hidden: tr.docChanged ? false : v.hidden };
            return v;
          },
        },
        props: {
          decorations(state) {
            const g = predictKey.getState(state)?.ghost;
            if (!g) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                g.pos,
                (view) => {
                  const span = document.createElement("span");
                  span.className = "wc-ghost";
                  span.textContent = g.p.insert;
                  span.contentEditable = "false";
                  span.title = "Tab to add";
                  const take = (e: Event) => {
                    e.preventDefault();
                    const cur = predictKey.getState(view.state)?.ghost;
                    if (cur) accept(view, cur);
                  };
                  span.addEventListener("mousedown", take);
                  span.addEventListener("touchstart", take, { passive: false });
                  return span;
                },
                { side: 1, key: `ghost-${g.pos}-${g.p.insert}`, ignoreSelection: true },
              ),
            ]);
          },
        },
        view(view) {
          void ensurePredictModel();
          let timer: ReturnType<typeof setTimeout> | null = null;
          // the paragraph the cursor was in: learned when you leave it
          let cur: { start: number; text: string } | null = null;
          const learnLeft = (state: EditorState) => {
            const $p = state.selection.$from;
            const start = $p.parent.isTextblock ? $p.start() : -1;
            if (cur && cur.start !== start) learnText(cur.text);
            cur = start >= 0 && $p.parent.type.name !== "codeBlock" ? { start, text: $p.parent.textBetween(0, $p.parent.content.size, "\n", " ") } : null;
          };
          const compute = () => {
            timer = null;
            const st = predictKey.getState(view.state);
            if (!st || st.hidden || !on() || !view.editable || view.composing || !view.hasFocus()) return;
            const ctx = textBefore(view.state);
            const p = ctx ? predictNext(ctx.before) : null;
            const pos = view.state.selection.from;
            const same = st.ghost && p && st.ghost.pos === pos && st.ghost.p.insert === p.insert;
            if (same || (!p && !st.ghost)) return;
            view.dispatch(view.state.tr.setMeta(predictKey, { ghost: p ? { pos, p } : null }).setMeta("addToHistory", false));
          };
          return {
            update(v, prev) {
              if (v.state.doc === prev.doc && v.state.selection.eq(prev.selection)) return;
              learnLeft(v.state);
              if (timer) clearTimeout(timer);
              timer = setTimeout(compute, 90);
            },
            destroy() {
              if (timer) clearTimeout(timer);
              if (cur) learnText(cur.text);
            },
          };
        },
      }),
    ];
  },
});
