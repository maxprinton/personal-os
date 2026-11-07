// What a page's HTML goes through before it is shown: sanitized AGAIN (the OS already did it), and headings moved
// one level down (the page title is the h1; a note's "# Title" becomes an h2).
import { sanitizeHtml } from "./sanitize";

export function shiftHeadings(html: string): string {
  let out = html;
  for (let n = 5; n >= 1; n--) out = out.replace(new RegExp(`<h${n}(\\s|>)`, "g"), `<h${n + 1}$1`).replace(new RegExp(`</h${n}>`, "g"), `</h${n + 1}>`);
  return out;
}
/** Images below the fold load late and decode off the main thread. */
export const lazyImages = (html: string) => html.replace(/<img\b(?![^>]*\bloading=)([^>]*?)(\/?)>/gi, '<img loading="lazy" decoding="async"$1$2>');
export const safeBody = (html: string) => lazyImages(shiftHeadings(sanitizeHtml(html).html));
export const plain = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return (/\s/.test(t[max - 1]) ? cut : cut.replace(/\s+\S*$/, "")) + "…";
};

/** JSON for a <script type="application/ld+json"> block: "<" and the line separators are escaped so the text can never close the tag. */
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
