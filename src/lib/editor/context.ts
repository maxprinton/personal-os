// What the editor knows about the app: the other notes (for @ mentions, page links, backlinks),
// the note being edited, and callbacks the React editor plugs in (create a sub-page, upload a file…).
import { Extension } from "@tiptap/core";

export type PageRef = { id: string; title: string; icon?: string | null; parentId?: string | null };

export type NotionStorage = {
  noteId: string | null;
  /** Title of the page (context for the ✨ AI). */
  title: string;
  pages: Map<string, PageRef>;
  /** Creates a sub-page of this note and returns it (null = not possible here). */
  createSubpage: ((title: string) => Promise<PageRef | null>) | null;
  /** Uploads a file and returns its URL (null = uploads not available). */
  upload: ((file: File) => Promise<{ url: string; name: string; size: number } | null>) | null;
  /** Appends Markdown to another note (⋮⋮ → Move to). */
  moveBlockTo: ((noteId: string, markdown: string) => Promise<boolean>) | null;
  /** Opens a note in the app. */
  navigate: (href: string) => void;
  lastColor: string | null;
  /** A typing menu ("/", "@"…) is open: Esc belongs to it. */
  menuOpen: boolean;
  listeners: Set<() => void>;
};

declare module "@tiptap/core" {
  interface Storage {
    notion: NotionStorage;
  }
}

export const NotionContext = Extension.create<Record<string, never>, NotionStorage>({
  name: "notion",
  addStorage() {
    return {
      noteId: null,
      title: "",
      pages: new Map(),
      createSubpage: null,
      upload: null,
      moveBlockTo: null,
      navigate: (href: string) => {
        window.location.href = href;
      },
      lastColor: null,
      menuOpen: false,
      listeners: new Set(),
    };
  },
});

/** Page links and mentions redraw when the list of notes changes. */
export function onPagesChange(storage: NotionStorage, fn: () => void) {
  storage.listeners.add(fn);
  return () => storage.listeners.delete(fn);
}

export function setPages(storage: NotionStorage, pages: PageRef[]) {
  storage.pages = new Map(pages.map((p) => [p.id, p]));
  storage.listeners.forEach((fn) => fn());
}

export const noteHref = (id: string) => `/notes/${id}`;

/** "/notes/<uuid>" (or a full URL to it) → the uuid. */
export function noteIdFromUrl(url: string | null | undefined): string | null {
  const m = /\/notes\/([0-9a-f-]{36})/i.exec(url ?? "");
  return m ? m[1] : null;
}
