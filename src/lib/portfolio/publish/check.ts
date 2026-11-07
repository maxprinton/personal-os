// Portfolio publishing — cleanup rules that need more than the rendered HTML: title, body, address, never-public words.
import type { Lang, SlotKind } from "@/lib/portfolio/constants";
import { SLUG_RE, isSingleton, slugFor, slugProblem, slugTaken } from "@/lib/portfolio/slots";
import type { Slot } from "@/lib/portfolio/types";
import { Warnings } from "./warnings";

/** One character → its plain lowercase letter (é → e). Keeps the length, so positions line up with the original text. */
const flat = (s: string) =>
  [...s].map((ch) => {
    if (ch.length !== 1) return ch;
    const m = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return m.length === 1 ? m : ch;
  }).join("");

export type Blocked = { word: string; snippet: string };

/** Every place a never-public word appears (case and accent insensitive). */
export function findBlocked(text: string, words: string[]): Blocked[] {
  const hay = flat(text);
  const out: Blocked[] = [];
  for (const w of words.map((x) => x.trim()).filter((x) => x.length >= 2)) {
    const needle = flat(w);
    for (let at = hay.indexOf(needle); at !== -1 && out.length < 200; at = hay.indexOf(needle, at + needle.length)) {
      out.push({ word: w, snippet: text.slice(Math.max(0, at - 25), at + needle.length + 25).replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

/** Wraps those words in <mark class="n-flag"> inside the text of an HTML string (for the preview in the OS only). */
export function highlightWords(html: string, words: string[]): string {
  const ws = words.map((x) => flat(x.trim())).filter((x) => x.length >= 2);
  if (!ws.length) return html;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<")) return part;
      const f = flat(part);
      const spans: [number, number][] = [];
      for (const w of ws) for (let at = f.indexOf(w); at !== -1; at = f.indexOf(w, at + w.length)) spans.push([at, at + w.length]);
      if (!spans.length) return part;
      spans.sort((a, b) => a[0] - b[0]);
      let out = "";
      let pos = 0;
      for (const [a, b] of spans) {
        if (a < pos) continue;
        out += part.slice(pos, a) + `<mark class="n-flag">${part.slice(a, b)}</mark>`;
        pos = b;
      }
      return out + part.slice(pos);
    })
    .join("");
}

const EMPTY_TITLES = new Set(["", "untitled", "sin titulo", "sin título"]);

export type CheckInput = {
  title: string;
  /** visible text of the page body */
  text: string;
  /** does the body hold anything visible besides text (image, embed)? */
  hasMedia: boolean;
  slot: Pick<Slot, "id" | "kind" | "key" | "langs">;
  lang: Lang;
  /** all the user's slots, to find an address already taken */
  slots: Pick<Slot, "id" | "kind" | "key" | "langs" | "archived">[];
  blockedWords: string[];
};

export function checkPage(input: CheckInput, w: Warnings) {
  const { title, text, hasMedia, slot, lang, slots, blockedWords } = input;
  if (EMPTY_TITLES.has(title.trim().toLowerCase())) w.add("empty_title");
  if (!text.trim() && !hasMedia) w.add("empty_body");
  if (!isSingleton(slot.kind)) {
    const slug = slugFor(slot, lang);
    if (!SLUG_RE.test(slug) || slugProblem(slug)) w.add("bad_slug", slug);
    else if (slugTaken(slots, slot.id, slot.kind as SlotKind, lang, slug)) w.add("duplicate_slug", slug);
  }
  for (const b of findBlocked(`${title}\n${text}`, blockedWords)) w.add("never_public", `${b.word}: …${b.snippet}…`);
}
