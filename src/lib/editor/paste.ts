// Pasting and dropping, like Notion:
//  · images/files (paste or drag from the computer) → uploaded and shown as image / video / audio / PDF / file blocks
//  · a link over selected text → that text becomes the link
//  · a link alone → pasted as a link + a small menu: Dismiss · Mention · Bookmark · Embed
//  · Markdown text (# titles, - lists, ```code…) → real blocks
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { requestUi } from "@/lib/editor/ui-events";
import type { MediaType } from "@/lib/editor/nodes/media";

const URL_RE = /^https?:\/\/[^\s<>"]+$/i;

export function mediaTypeFor(file: File): MediaType {
  const t = file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (t.startsWith("image/") || ext === "avif" || ext === "svg") return "image";
  if (t.startsWith("video/")) return "video";
  // Windows often gives .m4a / .mp3 an empty or odd type: go by the extension too
  if (t.startsWith("audio/") || ext === "mp3" || ext === "m4a") return "audio";
  if (t === "application/pdf" || ext === "pdf") return "pdf";
  return "file";
}

/** Text files bigger than this are attached as a file instead of shown as a code block. */
export const MAX_TEXT_FILE = 1024 * 1024;
const TEXT_EXT = new Set(
  "txt text md markdown mdx csv tsv json jsonc json5 ndjson js mjs cjs jsx ts mts cts tsx py rb go rs java kt kts swift c h cc cpp hpp cs php html htm css scss sass less xml svg yml yaml toml ini cfg conf env log sh bash zsh bat cmd ps1 sql graphql gql srt vtt tex rtf r lua pl dart vue svelte astro gitignore dockerfile makefile properties".split(" "),
);
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-javascript|ecmascript|x-sh|x-yaml|yaml|toml|sql|x-sql|graphql|ld\+json|x-ndjson))/;

/** A plain-text file (by type or by extension): dropped / pasted, it becomes a code block. */
export function isTextFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  if (ext === "svg" || file.type === "image/svg+xml") return false; // SVG is a picture: it becomes an image block
  if (TEXT_TYPES.test(file.type)) return true;
  return TEXT_EXT.has(ext);
}

/** File text ready for a code block (Windows line endings out). null = it isn't really text (binary). */
export function cleanFileText(text: string): string | null {
  if (text.includes("\u0000")) return null;
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

/** Text files → plain-text code blocks (language: Plain text), in order, at `at`. Others are returned to upload. */
function insertTextFiles(editor: Editor, files: File[], at: number): File[] {
  const text = files.filter((f) => isTextFile(f) && f.size <= MAX_TEXT_FILE);
  const big = files.filter((f) => isTextFile(f) && f.size > MAX_TEXT_FILE);
  if (big.length) requestUi(editor.view, { kind: "toast", text: `${big[0].name} is too big to show as code (max 1 MB): added as a file.` });
  if (!text.length) return files.filter((f) => !text.includes(f));
  const binary: File[] = [];
  void Promise.all(text.map((f) => f.text().then((t) => ({ f, t: cleanFileText(t) }), () => ({ f, t: null as string | null })))).then((read) => {
    let pos = Math.min(at, editor.state.doc.content.size);
    const nodes = [];
    for (const { f, t } of read) {
      if (t === null) {
        binary.push(f);
        continue;
      }
      nodes.push(editor.schema.nodeFromJSON({ type: "codeBlock", attrs: { language: null }, ...(t ? { content: [{ type: "text", text: t }] } : {}) }));
    }
    if (nodes.length) {
      let tr = editor.state.tr;
      for (const n of nodes) {
        tr = tr.insert(pos, n);
        pos += n.nodeSize;
      }
      editor.view.dispatch(tr.scrollIntoView());
      requestUi(editor.view, { kind: "toast", text: nodes.length === 1 ? "Added as a code block." : `Added ${nodes.length} code blocks.` });
    }
    if (binary.length) uploadFiles(editor, binary, pos);
  });
  return files.filter((f) => !text.includes(f));
}

/**
 * Inserts the files at pos. Text files (.txt, .md, .csv, .json, code…) become plain-text code blocks;
 * the rest are uploaded (until then the block shows the local preview).
 */
export function insertFiles(editor: Editor, files: File[], pos?: number) {
  const at = pos ?? editor.state.selection.$from.after(Math.max(1, editor.state.selection.$from.depth));
  const rest = insertTextFiles(editor, files.slice(0, 10), at);
  if (rest.length) uploadFiles(editor, rest, at);
}

function uploadFiles(editor: Editor, files: File[], pos?: number) {
  const upload = editor.storage.notion.upload;
  if (!upload) {
    requestUi(editor.view, { kind: "toast", text: "Files can only be added inside a note." });
    return;
  }
  let at = pos ?? editor.state.selection.$from.after(Math.max(1, editor.state.selection.$from.depth));
  for (const file of files.slice(0, 10)) {
    if (file.size > 50 * 1024 * 1024) {
      requestUi(editor.view, { kind: "toast", text: `${file.name} is larger than 50 MB.` });
      continue;
    }
    const type = mediaTypeFor(file);
    const temp = URL.createObjectURL(file);
    const node = editor.schema.nodes[type]?.create({ src: temp, name: file.name, size: file.size, uploading: true });
    if (!node) continue;
    const tr = editor.state.tr.insert(Math.min(at, editor.state.doc.content.size), node);
    editor.view.dispatch(tr);
    at = Math.min(at, editor.state.doc.content.size) + node.nodeSize;
    void upload(file)
      .then((res) => {
        let found = -1;
        editor.state.doc.descendants((n, p) => {
          if (found >= 0) return false;
          if (n.attrs?.src === temp) found = p;
          return true;
        });
        if (found < 0) return;
        const n = editor.state.doc.nodeAt(found)!;
        if (!res) {
          editor.view.dispatch(editor.state.tr.delete(found, found + n.nodeSize));
          return;
        }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(found, undefined, { ...n.attrs, src: res.url, name: res.name, size: res.size, uploading: false }));
        setTimeout(() => URL.revokeObjectURL(temp), 5000);
      })
      .catch(() => requestUi(editor.view, { kind: "toast", text: `Couldn't upload ${file.name}.` }));
  }
}

/** A paste this long (characters or lines) on an empty line gets the "Keep as text / Code block" menu. */
export const LONG_PASTE_CHARS = 1200;
export const LONG_PASTE_LINES = 12;
export const isLongPaste = (t: string) => t.length >= LONG_PASTE_CHARS || t.split("\n").length >= LONG_PASTE_LINES;

/**
 * After a long paste on an empty top-level line: find the blocks it became (by counting top-level blocks)
 * and offer the menu. `idx` = index of the empty line, `oldCount` = number of top-level blocks before.
 */
function offerLongPaste(view: import("@tiptap/pm/view").EditorView, raw: string, idx: number, oldCount: number) {
  setTimeout(() => {
    const doc = view.state.doc;
    const added = doc.childCount - oldCount;
    if (added < 0 || idx >= doc.childCount) return;
    let from = 0;
    for (let i = 0; i < idx; i++) from += doc.child(i).nodeSize;
    let to = from;
    for (let i = idx; i <= idx + added && i < doc.childCount; i++) to += doc.child(i).nodeSize;
    const snapshot = doc.textBetween(from, to, "\n", "\n");
    if (!snapshot.trim()) return;
    let c: { left: number; top: number; bottom: number };
    try {
      c = view.coordsAtPos(view.state.selection.from);
    } catch {
      return;
    }
    requestUi(view, { kind: "pasteLong", text: raw, from, to, snapshot, rect: new DOMRect(c.left, c.top, 1, c.bottom - c.top) });
  }, 0);
}

const looksLikeMarkdown = (t: string) => /(^|\n)(#{1,4} |[-*+] |\d+\. |- \[[ x]\] |> |```|\|.+\|)/.test(t) || /\*\*[^*]+\*\*/.test(t);

export const NotionPaste = Extension.create({
  name: "notionPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("notionPaste"),
        props: {
          handlePaste: (view, event) => {
            const dt = event.clipboardData;
            if (!dt) return false;
            const files = Array.from(dt.files ?? []);
            if (files.length && !dt.getData("text/html")) {
              insertFiles(editor, files);
              return true;
            }
            const raw = dt.getData("text/plain").replace(/\r\n?/g, "\n");
            const text = raw.trim();
            const html = dt.getData("text/html");
            if (editor.isActive("codeBlock")) return false;
            // Long text on an empty line (a transcript…): paste it normally, then offer "Code block"
            const sel = view.state.selection;
            const $f = sel.$from;
            const onEmptyLine = sel.empty && $f.depth === 1 && $f.parent.type.name === "paragraph" && $f.parent.content.size === 0;
            if (onEmptyLine && text && !URL_RE.test(text) && isLongPaste(text)) offerLongPaste(view, raw.replace(/^\n+|\s+$/g, ""), $f.index(0), view.state.doc.childCount);
            if (URL_RE.test(text)) {
              const { from, to, empty } = view.state.selection;
              if (!empty) {
                editor.chain().focus().extendMarkRange("link").setLink({ href: text }).run();
                return true;
              }
              const tr = view.state.tr.insertText(text, from, to);
              tr.addMark(from, from + text.length, view.state.schema.marks.link.create({ href: text }));
              view.dispatch(tr);
              const coords = view.coordsAtPos(from + text.length);
              requestUi(view, { kind: "pasteUrl", url: text, from, to: from + text.length, rect: new DOMRect(coords.left, coords.top, 1, coords.bottom - coords.top) });
              return true;
            }
            if (!html && text && looksLikeMarkdown(text) && editor.markdown) {
              try {
                const json = editor.markdown.parse(text);
                editor.chain().focus().insertContent(json.content ?? []).run();
                return true;
              } catch {
                return false;
              }
            }
            return false;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!at) return false;
            const $p = view.state.doc.resolve(at.pos);
            const pos = $p.depth > 0 ? $p.after(1) : at.pos;
            event.preventDefault();
            insertFiles(editor, files, pos);
            return true;
          },
        },
      }),
    ];
  },
});
