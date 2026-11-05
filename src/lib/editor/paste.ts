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
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t === "application/pdf") return "pdf";
  return "file";
}

/** Inserts the files at pos (uploads them; until then the block shows the local preview). */
export function insertFiles(editor: Editor, files: File[], pos?: number) {
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
