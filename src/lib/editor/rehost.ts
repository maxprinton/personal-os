// Keeps pictures from disappearing: an image whose address points to another website (pasted from a web page)
// or is embedded as data: gets its own copy in your storage, and the note is updated to use that copy.
// Without this, links that expire after ~24 hours (Coursera, Google, Notion…) leave an empty hole in the note.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { requestUi } from "@/lib/editor/ui-events";

/** Pictures that live on another website (never our own copies). */
export function isRemoteImageSrc(src: unknown, ownOrigin = typeof location !== "undefined" ? location.origin : ""): src is string {
  if (typeof src !== "string" || !/^https?:\/\//i.test(src)) return false;
  try {
    return new URL(src).origin !== ownOrigin;
  } catch {
    return false;
  }
}
export const isDataImageSrc = (src: unknown): src is string => typeof src === "string" && /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/i.test(src);

/** Every distinct picture address in the document that still needs its own copy. */
export function pendingImageSrcs(doc: import("@tiptap/pm/model").Node, skip: Set<string>, ownOrigin?: string): string[] {
  const out = new Set<string>();
  doc.descendants((n) => {
    if (n.type.name === "image" && (isRemoteImageSrc(n.attrs.src, ownOrigin) || isDataImageSrc(n.attrs.src)) && !skip.has(n.attrs.src)) out.add(n.attrs.src);
    return true;
  });
  return [...out];
}

type Saved = { url: string; name: string; size: number };

async function saveCopy(editor: Editor, src: string): Promise<Saved | null> {
  if (isDataImageSrc(src)) {
    try {
      const blob = await (await fetch(src)).blob();
      const ext = (blob.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
      return (await editor.storage.notion.upload?.(new File([blob], `pasted.${ext}`, { type: blob.type }))) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch("/api/note-image-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: src }) });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<Saved>;
    return j.url ? { url: j.url, name: j.name ?? "image", size: j.size ?? 0 } : null;
  } catch {
    return null;
  }
}

function swap(editor: Editor, from: string, to: Saved) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "image" && n.attrs.src === from) {
      tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: to.url });
      changed = true;
    }
    return true;
  });
  // not in the undo history: Ctrl+Z must never bring back the link that expires
  if (changed) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

export const RehostImages = Extension.create({
  name: "rehostImages",
  addProseMirrorPlugins() {
    const editor = this.editor;
    const tried = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;
    let running = false;

    const scan = async (quiet: boolean) => {
      if (dead || running || !editor.isEditable || !editor.storage.notion?.upload) return;
      const todo = pendingImageSrcs(editor.state.doc, tried);
      if (!todo.length) return;
      running = true;
      let failed = 0;
      try {
        for (const src of todo) {
          tried.add(src);
          const saved = await saveCopy(editor, src);
          if (dead) return;
          if (saved) swap(editor, src, saved);
          else failed++;
        }
      } finally {
        running = false;
      }
      if (failed && !quiet) {
        requestUi(editor.view, { kind: "toast", text: failed === 1 ? "Couldn't keep a copy of 1 image from the web: its link may have expired." : `Couldn't keep a copy of ${failed} images from the web: their links may have expired.` });
      }
      // pictures pasted while we were busy
      if (!dead && pendingImageSrcs(editor.state.doc, tried).length) timer = setTimeout(() => void scan(false), 300);
    };

    return [
      new Plugin({
        key: new PluginKey("rehostImages"),
        view: () => {
          timer = setTimeout(() => void scan(true), 1200); // pictures already in the note (old links that still work)
          return {
            update: (view, prev) => {
              if (view.state.doc.eq(prev.doc)) return;
              clearTimeout(timer);
              timer = setTimeout(() => void scan(false), 600);
            },
            destroy: () => {
              dead = true;
              clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
