// Menus that open while typing (Notion): "/" blocks, "@" mentions, "[[" page links, ":" emoji.
// The extension only tracks the typed query; RichEditor draws the menu and handles the keys.
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";

export type MenuKind = "slash" | "mention" | "link" | "emoji";

export type SuggestState = {
  kind: MenuKind;
  query: string;
  range: Range;
  rect: DOMRect | null;
};

type Options = {
  onChange: (state: SuggestState | null) => void;
  /** Arrow keys / Enter / Tab while a menu is open. Return true if handled. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

const MENUS: { kind: MenuKind; char: string; allowSpaces: boolean; startOfLine?: boolean; minQuery?: number; prefix?: RegExp }[] = [
  { kind: "slash", char: "/", allowSpaces: true },
  { kind: "mention", char: "@", allowSpaces: true },
  { kind: "link", char: "[[", allowSpaces: true },
  { kind: "emoji", char: ":", allowSpaces: false, minQuery: 2 },
];

export const SuggestMenus = Extension.create<Options>({
  name: "suggestMenus",
  addOptions() {
    return { onChange: () => {}, onKeyDown: () => false };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return MENUS.map((m) =>
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey(`suggest-${m.kind}`),
        char: m.char,
        allowSpaces: m.allowSpaces,
        // "@" and ":" right after a letter (an email, "10:30") don't open anything
        allowedPrefixes: m.kind === "slash" || m.kind === "link" ? null : [" ", "(", " "],
        allow: ({ editor, state, range }) => {
          if (editor.isActive("codeBlock") || editor.isActive("code")) return false;
          if (m.kind === "emoji") {
            const q = state.doc.textBetween(range.from + 1, range.to);
            return q.length >= (m.minQuery ?? 0) && /^[a-z0-9_+-]+$/i.test(q);
          }
          if (m.kind === "slash") {
            const q = state.doc.textBetween(range.from + 1, range.to);
            return q.length <= 30 && !/\s{2,}/.test(q) && !/^\s/.test(q);
          }
          if (m.kind === "mention") {
            const q = state.doc.textBetween(range.from + 1, range.to);
            return q.length <= 40 && !/\s{2,}/.test(q);
          }
          return true;
        },
        items: () => [],
        command: () => {},
        render: () => {
          const emit = (p: { query: string; range: Range; clientRect?: (() => DOMRect | null) | null }) =>
            options.onChange({ kind: m.kind, query: p.query, range: p.range, rect: p.clientRect?.() ?? null });
          return {
            onStart: emit,
            onUpdate: emit,
            onExit: () => options.onChange(null),
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                options.onChange(null);
                return true;
              }
              return options.onKeyDown(event);
            },
          };
        },
      }),
    );
  },
});

/** Removes "/query" (or "@query"…) and runs the action. */
export function consume(editor: Editor, range: Range) {
  return editor.chain().focus().deleteRange(range);
}
