// "/" menu (like Notion): typing "/" opens the block list; the React editor draws it.
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { filterBlocks, type BlockItem } from "@/lib/editor/blocks";

export type SlashOpen = { items: BlockItem[]; rect: DOMRect | null; pick: (item: BlockItem) => void };

type SlashOptions = {
  /** Called when the menu opens, updates (null = closed). */
  onChange: (state: SlashOpen | null) => void;
  /** Arrow keys / Enter while the menu is open. Return true if handled. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",
  addOptions() {
    return { onChange: () => {}, onKeyDown: () => false };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowSpaces: false,
        items: ({ query }) => filterBlocks(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        allow: ({ editor }) => !editor.isActive("codeBlock"),
        render: () => {
          const open = (p: { items: BlockItem[]; clientRect?: (() => DOMRect | null) | null; command: (i: BlockItem) => void }) =>
            options.onChange({ items: p.items, rect: p.clientRect?.() ?? null, pick: (i) => p.command(i) });
          return {
            onStart: open,
            onUpdate: open,
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
    ];
  },
});
