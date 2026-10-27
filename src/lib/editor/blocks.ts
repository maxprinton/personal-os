// The block types of the note editor: used by the "/" menu and by "Turn into" in the ⋮⋮ menu.
import type { Editor, Range } from "@tiptap/core";

export type BlockItem = {
  key: string;
  label: string;
  hint: string;
  icon: string;
  keywords: string[];
  /** Can a block be turned into this (from the ⋮⋮ menu)? */
  turnInto: boolean;
  run: (editor: Editor, range?: Range) => void;
};

const chain = (editor: Editor, range?: Range) => {
  const c = editor.chain().focus();
  return range ? c.deleteRange(range) : c;
};

export const BLOCK_ITEMS: BlockItem[] = [
  { key: "text", label: "Text", hint: "Plain paragraph", icon: "¶", keywords: ["texto", "paragraph", "p"], turnInto: true, run: (e, r) => chain(e, r).setParagraph().run() },
  { key: "h1", label: "Heading 1", hint: "Big section title", icon: "H1", keywords: ["titulo", "title", "h1", "#"], turnInto: true, run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
  { key: "h2", label: "Heading 2", hint: "Medium title", icon: "H2", keywords: ["subtitulo", "h2", "##"], turnInto: true, run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
  { key: "h3", label: "Heading 3", hint: "Small title", icon: "H3", keywords: ["h3", "###"], turnInto: true, run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
  { key: "todo", label: "To-do list", hint: "Checkboxes", icon: "☑", keywords: ["casilla", "checkbox", "task", "tarea", "todo", "[]"], turnInto: true, run: (e, r) => chain(e, r).toggleTaskList().run() },
  { key: "bullet", label: "Bulleted list", hint: "Simple list", icon: "•", keywords: ["lista", "list", "bullet", "-"], turnInto: true, run: (e, r) => chain(e, r).toggleBulletList().run() },
  { key: "ordered", label: "Numbered list", hint: "1. 2. 3.", icon: "1.", keywords: ["numerada", "numbered", "ordered", "1."], turnInto: true, run: (e, r) => chain(e, r).toggleOrderedList().run() },
  { key: "toggle", label: "Toggle", hint: "Section that opens and closes", icon: "▸", keywords: ["desplegable", "details", "collapse", "toggle"], turnInto: true, run: (e, r) => chain(e, r).setDetails().run() },
  { key: "quote", label: "Quote", hint: "Highlighted quote", icon: "❝", keywords: ["cita", "blockquote", "quote", ">"], turnInto: true, run: (e, r) => chain(e, r).toggleBlockquote().run() },
  { key: "code", label: "Code", hint: "Code block", icon: "</>", keywords: ["codigo", "code", "```"], turnInto: true, run: (e, r) => chain(e, r).toggleCodeBlock().run() },
  { key: "table", label: "Table", hint: "3 × 3 with header", icon: "▦", keywords: ["tabla", "table", "grid"], turnInto: false, run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: "divider", label: "Divider", hint: "Line between sections", icon: "—", keywords: ["separador", "divider", "hr", "---"], turnInto: false, run: (e, r) => chain(e, r).setHorizontalRule().run() },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterBlocks(query: string) {
  const q = fold(query.trim());
  if (!q) return BLOCK_ITEMS;
  return BLOCK_ITEMS.filter((i) => fold(i.label).includes(q) || i.keywords.some((k) => fold(k).startsWith(q)));
}
