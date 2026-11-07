// Portfolio publishing — search text, reading time and table of contents of a page.
import type { TocItem } from "./render";

const WORDS_PER_MINUTE = 200;
export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const readingMinutes = (text: string) => Math.max(1, Math.round(wordCount(text) / WORDS_PER_MINUTE));
/** Title + visible text, one line, capped (the site searches this column). */
export const searchText = (title: string, text: string) => `${title}\n${text}`.replace(/\s+/g, " ").trim().slice(0, 30000);
/** Headings h1–h3 for the table of contents (h4 and deeper are too fine for a side list). */
export const publicToc = (toc: TocItem[]): TocItem[] => toc.filter((t) => t.level <= 3 && t.text).slice(0, 60).map((t) => ({ ...t, text: t.text.slice(0, 120) }));
