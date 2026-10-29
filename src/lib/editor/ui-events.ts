// Node views (plain DOM inside ProseMirror) ask the React editor to open a menu or popover:
// they fire a "n-ui" event that RichEditor listens to.
import type { EditorView } from "@tiptap/pm/view";
import type { AiMode } from "@/lib/ai-notes";

export type UiRequest =
  | { kind: "emoji"; rect: DOMRect; onPick: (emoji: string | null) => void; allowRemove?: boolean }
  | { kind: "math"; rect: DOMRect; latex: string; block: boolean; onSave: (latex: string) => void; onRemove: () => void }
  | { kind: "color"; rect: DOMRect; current: string | null; onPick: (color: string | null) => void }
  | {
      kind: "date";
      rect: DOMRect;
      start: string;
      end: string | null;
      time: string | null;
      onSave: (v: { start: string; end: string | null; time: string | null } | null) => void;
    }
  | { kind: "link" }
  | { kind: "pasteUrl"; url: string; from: number; to: number; rect: DOMRect }
  | { kind: "toast"; text: string }
  /** ✨ AI: at = where the result goes (default: the selection or the cursor). */
  | { kind: "ai"; mode: AiMode; prompt?: string; at?: "cursor" | "top" | "end"; rect?: DOMRect }
  /** The ✨ menu for the selected text. */
  | { kind: "aiMenu" }
  | { kind: "blockMenu"; pos: number; rect: DOMRect }
  | { kind: "media"; pos: number; rect: DOMRect; type: string; onDone: (src: { url: string; name?: string; size?: number } | null) => void };

export function requestUi(view: EditorView, req: UiRequest) {
  view.dom.dispatchEvent(new CustomEvent<UiRequest>("n-ui", { detail: req, bubbles: true }));
}

export const isUiEvent = (e: Event): e is CustomEvent<UiRequest> => e.type === "n-ui";
