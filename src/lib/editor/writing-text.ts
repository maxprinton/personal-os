// Pure helpers of the editor writing check (no browser APIs): safe in tests.
import type { Node as PMNode } from "@tiptap/pm/model";
import { MASK } from "@/lib/writing/types";

/** The text of a paragraph for the checker + the document position of each character. */
export function blockText(node: PMNode, start: number) {
  let text = "";
  const pos: number[] = [];
  node.forEach((child, offset) => {
    const p = start + offset;
    if (child.isText) {
      const skip = child.marks.some((m) => m.type.name === "code" || m.type.name === "link");
      const t = child.text ?? "";
      for (let i = 0; i < t.length; i++) {
        text += skip ? MASK : t[i];
        pos.push(p + i);
      }
    } else if (child.type.name === "hardBreak") {
      text += "\n";
      pos.push(p);
    } else {
      text += MASK; // mention, date, math… (one character)
      pos.push(p);
    }
  });
  return { text, pos };
}

export const hereKey = (word: string, text: string) => `${word.toLocaleLowerCase()}|${text}`;

