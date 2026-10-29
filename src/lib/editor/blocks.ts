// Everything the "/" menu offers, grouped like Notion: Basic blocks, Media, Advanced, Inline,
// plus colors ("/red", "/blue background") and actions ("/duplicate", "/delete", "/turn").
// "Turn into" in the ⋮⋮ menu uses the items that have a `kind`.
import type { Editor, Range } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { COLOR_ALIASES, COLOR_LABEL, COLOR_NAMES, type ColorName } from "@/lib/editor/colors";
import { currentBlock, deleteBlock, duplicateBlock, setBlockColor, turnInto, type Kind } from "@/lib/editor/transform";
import { openSelectedMath } from "@/lib/editor/nodes/math";
import type { MediaType } from "@/lib/editor/nodes/media";
import { requestUi } from "@/lib/editor/ui-events";
import type { AiMode } from "@/lib/ai-notes";

export type Group = "Suggested" | "AI" | "Basic blocks" | "Media" | "Advanced" | "Inline" | "Text color" | "Background color" | "Actions";

export type BlockItem = {
  key: string;
  label: string;
  hint: string;
  icon: string;
  group: Group;
  keywords: string[];
  /** Notion shortcut shown on the right (e.g. "#", "Ctrl+Shift+1"). */
  shortcut?: string;
  /** Turn-into target (shown in ⋮⋮ → Turn into). */
  kind?: Kind;
  /** Swatch for color items. */
  swatch?: { color: ColorName; bg: boolean };
  run: (editor: Editor, range?: Range) => void;
};

const del = (editor: Editor, range?: Range) => {
  const c = editor.chain().focus();
  return range ? c.deleteRange(range) : c;
};

/** Turns the current block (after removing "/query") into `kind`. */
const into = (kind: Kind) => (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).run();
  const b = currentBlock(editor);
  if (b) turnInto(editor, b.pos, kind);
};

/** Inserts a node after the current block, or in place of it when the line is empty. */
export function insertBlock(editor: Editor, range: Range | undefined, content: Record<string, unknown> | Record<string, unknown>[], select = true) {
  if (range) editor.chain().focus().deleteRange(range).run();
  const { $from } = editor.state.selection;
  const depth = $from.depth;
  const emptyLine = $from.parent.isTextblock && $from.parent.content.size === 0 && depth > 0;
  const from = emptyLine ? $from.before(depth) : $from.after(Math.max(1, depth));
  const to = emptyLine ? $from.after(depth) : from;
  editor
    .chain()
    .insertContentAt({ from, to }, content)
    .command(({ tr }) => {
      if (!select) return true;
      const n = tr.doc.nodeAt(from);
      if (n?.isAtom) tr.setSelection(NodeSelection.create(tr.doc, from));
      return true;
    })
    .focus()
    .run();
}

const media = (type: MediaType) => (editor: Editor, range?: Range) => {
  insertBlock(editor, range, { type });
  setTimeout(() => {
    const dom = editor.view.nodeDOM(editor.state.selection.from) as HTMLElement | null;
    dom?.querySelector<HTMLElement>("[data-media-empty]")?.click();
  }, 40);
};

export const BLOCK_ITEMS: BlockItem[] = [
  // ---- Basic blocks
  { key: "text", label: "Text", hint: "Just start writing with plain text.", icon: "Aa", group: "Basic blocks", keywords: ["plain", "paragraph", "texto", "p"], shortcut: "", kind: "text", run: into("text") },
  { key: "page", label: "Page", hint: "Embed a sub-page inside this page.", icon: "📄", group: "Basic blocks", keywords: ["subpage", "pagina", "nota", "new page"], run: (e, r) => void createSubpageBlock(e, r) },
  { key: "todo", label: "To-do list", hint: "Track tasks with a to-do list.", icon: "☑", group: "Basic blocks", keywords: ["checkbox", "task", "tarea", "casilla", "todo", "[]"], shortcut: "[]", kind: "todo", run: into("todo") },
  { key: "h1", label: "Heading 1", hint: "Big section heading.", icon: "H1", group: "Basic blocks", keywords: ["title", "titulo", "h1", "#"], shortcut: "#", kind: "h1", run: into("h1") },
  { key: "h2", label: "Heading 2", hint: "Medium section heading.", icon: "H2", group: "Basic blocks", keywords: ["subtitle", "subtitulo", "h2", "##"], shortcut: "##", kind: "h2", run: into("h2") },
  { key: "h3", label: "Heading 3", hint: "Small section heading.", icon: "H3", group: "Basic blocks", keywords: ["h3", "###"], shortcut: "###", kind: "h3", run: into("h3") },
  { key: "h4", label: "Heading 4", hint: "Smallest section heading.", icon: "H4", group: "Basic blocks", keywords: ["h4", "####"], shortcut: "####", kind: "h4", run: into("h4") },
  { key: "table", label: "Table", hint: "Add a simple table.", icon: "▦", group: "Basic blocks", keywords: ["tabla", "grid", "simple table"], run: (e, r) => del(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: "bullet", label: "Bulleted list", hint: "Create a simple bulleted list.", icon: "•", group: "Basic blocks", keywords: ["list", "lista", "bullet", "-", "ul"], shortcut: "-", kind: "bullet", run: into("bullet") },
  { key: "ordered", label: "Numbered list", hint: "Create a list with numbering.", icon: "1.", group: "Basic blocks", keywords: ["numbered", "numerada", "ordered", "ol", "1."], shortcut: "1.", kind: "ordered", run: into("ordered") },
  { key: "toggle", label: "Toggle list", hint: "Toggles can hide and show content inside.", icon: "▸", group: "Basic blocks", keywords: ["desplegable", "details", "collapse", "toggle"], shortcut: ">", kind: "toggle", run: into("toggle") },
  { key: "quote", label: "Quote", hint: "Capture a quote.", icon: "❝", group: "Basic blocks", keywords: ["cita", "blockquote", "quote"], shortcut: '"', kind: "quote", run: into("quote") },
  { key: "divider", label: "Divider", hint: "Visually divide blocks.", icon: "—", group: "Basic blocks", keywords: ["separador", "divider", "hr", "---", "line"], shortcut: "---", run: (e, r) => del(e, r).setHorizontalRule().run() },
  { key: "linkpage", label: "Link to page", hint: "Link to an existing page.", icon: "↗", group: "Basic blocks", keywords: ["link", "enlace", "page", "nota"], run: (e, r) => del(e, r).insertContent("[[").run() },
  { key: "callout", label: "Callout", hint: "Make writing stand out.", icon: "💡", group: "Basic blocks", keywords: ["aviso", "nota", "callout", "box", "info"], kind: "callout", run: into("callout") },

  // ---- Media
  { key: "image", label: "Image", hint: "Upload or embed with a link.", icon: "🖼️", group: "Media", keywords: ["imagen", "foto", "picture", "img", "photo"], run: media("image") },
  { key: "video", label: "Video", hint: "Embed from YouTube, Vimeo… or upload.", icon: "🎬", group: "Media", keywords: ["youtube", "vimeo", "loom", "mp4"], run: media("video") },
  { key: "audio", label: "Audio", hint: "Embed audio or upload a file.", icon: "🎵", group: "Media", keywords: ["sound", "music", "mp3", "musica", "voz"], run: media("audio") },
  { key: "code", label: "Code", hint: "Capture a code snippet.", icon: "</>", group: "Media", keywords: ["codigo", "code", "```", "snippet"], shortcut: "```", kind: "code", run: into("code") },
  { key: "file", label: "File", hint: "Upload or embed with a link.", icon: "📎", group: "Media", keywords: ["archivo", "attachment", "adjunto", "upload"], run: media("file") },
  { key: "pdf", label: "PDF", hint: "Show a PDF inside the page.", icon: "📕", group: "Media", keywords: ["documento", "pdf"], run: media("pdf") },
  { key: "bookmark", label: "Web bookmark", hint: "Save a link as a visual bookmark.", icon: "🔖", group: "Media", keywords: ["link", "url", "enlace", "marcador", "book"], run: media("bookmark") },
  { key: "embed", label: "Embed", hint: "Google Maps, Figma, Spotify, CodePen…", icon: "🔗", group: "Media", keywords: ["iframe", "insertar", "maps", "figma", "spotify"], run: media("embed") },

  // ---- Advanced
  { key: "toc", label: "Table of contents", hint: "Show an outline of your page.", icon: "☰", group: "Advanced", keywords: ["toc", "indice", "outline", "contents"], run: (e, r) => insertBlock(e, r, { type: "tableOfContents" }) },
  { key: "math", label: "Block equation", hint: "Display a standalone math equation.", icon: "∑", group: "Advanced", keywords: ["math", "latex", "tex", "equation", "ecuacion", "formula"], run: (e, r) => {
      if (r) e.chain().focus().deleteRange(r).run();
      e.chain().focus().insertBlockMath("").run();
      openSelectedMath(e);
    } },
  { key: "button", label: "Button", hint: "Insert the blocks you choose with one click.", icon: "▣", group: "Advanced", keywords: ["boton", "template", "plantilla"], run: (e, r) => insertBlock(e, r, { type: "notionButton", attrs: { label: "New to-do" }, content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] }] }, false) },
  { key: "breadcrumb", label: "Breadcrumb", hint: "Show where this page is.", icon: "›", group: "Advanced", keywords: ["bread", "migas", "ruta", "path"], run: (e, r) => insertBlock(e, r, { type: "breadcrumb" }) },
  { key: "th1", label: "Toggle heading 1", hint: "Hide content inside a large heading.", icon: "▸H1", group: "Advanced", keywords: ["toggle heading", "desplegable titulo", "th1"], kind: "th1", run: into("th1") },
  { key: "th2", label: "Toggle heading 2", hint: "Hide content inside a medium heading.", icon: "▸H2", group: "Advanced", keywords: ["toggle heading", "th2"], kind: "th2", run: into("th2") },
  { key: "th3", label: "Toggle heading 3", hint: "Hide content inside a small heading.", icon: "▸H3", group: "Advanced", keywords: ["toggle heading", "th3"], kind: "th3", run: into("th3") },
  ...[2, 3, 4, 5].map<BlockItem>((n) => ({
    key: `columns${n}`,
    label: `${n} columns`,
    hint: `Create ${n} columns of blocks.`,
    icon: "▥",
    group: "Advanced",
    keywords: ["columns", "columnas", "column", `${n}`],
    run: (e, r) => del(e, r).insertColumns(n).run(),
  })),
  { key: "mermaid", label: "Mermaid diagram", hint: "Flowcharts and diagrams from text.", icon: "◇", group: "Advanced", keywords: ["diagram", "diagrama", "flowchart", "mermaid", "chart"], run: (e, r) => del(e, r).insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "graph TD\n  A[Start] --> B{Is it?}\n  B -->|Yes| C[OK]\n  B -->|No| D[End]" }] }).run() },

  // ---- Inline
  { key: "mention", label: "Mention a page", hint: "Link to a page in the text.", icon: "@", group: "Inline", keywords: ["mencion", "mention", "@", "page"], run: (e, r) => del(e, r).insertContent("@").run() },
  { key: "date", label: "Date or reminder", hint: "Insert today's date, or type one.", icon: "📅", group: "Inline", keywords: ["fecha", "date", "today", "hoy", "reminder"], run: (e, r) => del(e, r).insertContent("@").run() },
  { key: "emoji", label: "Emoji", hint: "Search for an emoji.", icon: "😀", group: "Inline", keywords: ["emoji", "icon", "smile", "cara"], run: (e, r) => del(e, r).insertContent(":").run() },
  { key: "imath", label: "Inline equation", hint: "Math inside a line of text.", icon: "√x", group: "Inline", keywords: ["inline math", "equation", "ecuacion", "latex"], shortcut: "Ctrl+Shift+E", run: (e, r) => {
      del(e, r).insertInlineMath("").run();
      openSelectedMath(e);
    } },
];

/** Creates a sub-page (a new note inside this one) and leaves its block here. */
export async function createSubpageBlock(editor: Editor, range?: Range, title = "") {
  const s = editor.storage.notion;
  if (range) editor.chain().focus().deleteRange(range).run();
  if (!s.createSubpage) return;
  const page = await s.createSubpage(title);
  if (!page) return;
  insertBlock(editor, undefined, { type: "pageLink", attrs: { url: `/notes/${page.id}`, title: page.title } });
  s.navigate(`/notes/${page.id}`);
}

const COLOR_ITEMS: BlockItem[] = COLOR_NAMES.flatMap((c) => {
  const kws = [c, ...COLOR_ALIASES[c]];
  const text: BlockItem = {
    key: `color-${c}`,
    label: c === "default" ? "Default" : COLOR_LABEL[c],
    hint: c === "default" ? "Remove the color" : `${COLOR_LABEL[c]} text`,
    icon: "A",
    group: "Text color",
    keywords: kws,
    swatch: { color: c, bg: false },
    run: (e, r) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const b = currentBlock(e);
      if (b) setBlockColor(e, b.pos, c === "default" ? null : c);
      e.storage.notion.lastColor = c === "default" ? null : c;
    },
  };
  if (c === "default") return [text];
  const bg: BlockItem = {
    key: `bg-${c}`,
    label: `${COLOR_LABEL[c]} background`,
    hint: `${COLOR_LABEL[c]} background`,
    icon: "A",
    group: "Background color",
    keywords: kws.flatMap((k) => [`${k} background`, `${k} bg`, `fondo ${k}`]),
    swatch: { color: c, bg: true },
    run: (e, r) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const b = currentBlock(e);
      if (b) setBlockColor(e, b.pos, `${c}_bg`);
      e.storage.notion.lastColor = `${c}_bg`;
    },
  };
  return [text, bg];
});

/** ✨ AI items ("/ai", "/summarize", "/continue"…). They open the AI panel at the cursor. */
const ai = (mode: AiMode) => (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).run();
  requestUi(editor.view, { kind: "ai", mode });
};
const AI_ITEMS: BlockItem[] = [
  { key: "ai-ask", label: "Ask AI", hint: "Ask the AI to write anything. (Space on an empty line)", icon: "✨", group: "AI", keywords: ["ai", "ia", "write", "escribir", "generate", "generar"], run: ai("write") },
  { key: "ai-continue", label: "Continue writing", hint: "The AI keeps writing from here.", icon: "✎", group: "AI", keywords: ["ai", "ia", "continue", "continuar", "seguir"], run: ai("continue") },
  { key: "ai-summary", label: "Summarize page", hint: "A short summary of this page.", icon: "≡", group: "AI", keywords: ["ai", "ia", "summary", "summarize", "resumen", "resumir", "tldr"], run: ai("summarize") },
  { key: "ai-todo", label: "Find action items", hint: "The AI lists the to-dos in this page.", icon: "☑", group: "AI", keywords: ["ai", "ia", "action items", "todos", "pendientes", "tareas"], run: ai("action-items") },
];

export type ActionHooks = { openTurnInto?: () => void; openMoveTo?: () => void };

function actionItems(hooks: ActionHooks): BlockItem[] {
  return [
    { key: "a-duplicate", label: "Duplicate", hint: "Copy this block below.", icon: "⧉", group: "Actions", keywords: ["duplicate", "duplicar", "copy"], shortcut: "Ctrl+D", run: (e, r) => {
        if (r) e.chain().focus().deleteRange(r).run();
        const b = currentBlock(e);
        if (b) duplicateBlock(e, b.pos);
      } },
    { key: "a-delete", label: "Delete", hint: "Delete this block.", icon: "🗑", group: "Actions", keywords: ["delete", "borrar", "eliminar", "remove"], shortcut: "Del", run: (e, r) => {
        if (r) e.chain().focus().deleteRange(r).run();
        const b = currentBlock(e);
        if (b) deleteBlock(e, b.pos);
      } },
    { key: "a-turn", label: "Turn into", hint: "Change this block's type.", icon: "⇄", group: "Actions", keywords: ["turn", "convertir", "cambiar", "turn into"], shortcut: "Ctrl+/", run: (e, r) => {
        if (r) e.chain().focus().deleteRange(r).run();
        hooks.openTurnInto?.();
      } },
    { key: "a-move", label: "Move to", hint: "Move this block to another page.", icon: "↪", group: "Actions", keywords: ["move", "mover", "moveto"], shortcut: "Ctrl+Shift+P", run: (e, r) => {
        if (r) e.chain().focus().deleteRange(r).run();
        hooks.openMoveTo?.();
      } },
  ];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const RECENT_KEY = "pos-slash-recent";
export function rememberBlock(key: string) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...list.filter((k) => k !== key)].slice(0, 5)));
  } catch {}
}
function recentBlocks(): BlockItem[] {
  try {
    const keys = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    return keys.map((k) => BLOCK_ITEMS.find((i) => i.key === k)).filter(Boolean).map((i) => ({ ...i!, group: "Suggested" as const }));
  } catch {
    return [];
  }
}

/** The "/" menu for what was typed: blocks first, then colors and actions when they match. */
export function filterBlocks(query: string, hooks: ActionHooks = {}, opts: { canCreatePage?: boolean } = {}): BlockItem[] {
  const q = fold(query.trim());
  const blocks = BLOCK_ITEMS.filter((i) => i.key !== "page" || opts.canCreatePage);
  if (!q) return [...recentBlocks(), ...blocks, ...AI_ITEMS];
  const score = (i: BlockItem) => {
    const label = fold(i.label);
    if (label.startsWith(q)) return 0;
    if (i.keywords.some((k) => fold(k).startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (i.keywords.some((k) => fold(k).includes(q)) && q.length >= 3) return 3;
    return -1;
  };
  const pool = [...blocks, ...AI_ITEMS, ...COLOR_ITEMS, ...actionItems(hooks)];
  return pool
    .map((i) => ({ i, s: score(i) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.i);
}

/** Items for ⋮⋮ → Turn into (in Notion's order). */
export const TURN_INTO: BlockItem[] = ["text", "h1", "h2", "h3", "h4", "todo", "bullet", "ordered", "toggle", "code", "quote", "callout", "th1", "th2", "th3"]
  .map((k) => BLOCK_ITEMS.find((i) => i.key === k)!)
  .filter(Boolean);

export { COLOR_ITEMS };
