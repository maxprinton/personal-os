// Search helpers (pure). The database does the filtering; these clean the query, build a snippet and rank the hits.

/** What we let into a query: letters, numbers and spaces, 80 characters at most. Empty when it is too short to search. */
export function cleanQuery(raw: string | null | undefined): string {
  const q = String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F%_\\,()"'*:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return q.length >= 2 ? q : "";
}

/** Distinct lowercase words of 2+ letters, 5 at most. */
export function termsOf(q: string): string[] {
  const out: string[] = [];
  for (const w of q.toLowerCase().split(" ")) if (w.length >= 2 && !out.includes(w)) out.push(w);
  return out.slice(0, 5);
}

/** A short piece of the text around the first match (or the start when nothing matches). */
export function snippet(text: string, terms: string[], len = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= len) return t;
  const low = t.toLowerCase();
  let at = -1;
  for (const w of terms) {
    const i = low.indexOf(w);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  let start = Math.max(0, at - Math.floor(len / 3));
  let end = Math.min(t.length, start + len);
  start = Math.max(0, end - len);
  // do not cut words in half
  if (start > 0) {
    const sp = t.indexOf(" ", start);
    if (sp !== -1 && sp < at) start = sp + 1;
  }
  if (end < t.length) {
    const sp = t.lastIndexOf(" ", end);
    if (sp > at) end = sp;
  }
  return (start > 0 ? "… " : "") + t.slice(start, end).trim() + (end < t.length ? " …" : "");
}

const count = (hay: string, w: string) => {
  let n = 0;
  let i = hay.indexOf(w);
  while (i !== -1 && n < 5) {
    n++;
    i = hay.indexOf(w, i + w.length);
  }
  return n;
};

/** Higher is better: title matches count most, then the summary, then the body (capped so long pages do not win by length). */
export function score(item: { title: string; summary: string | null; text: string }, terms: string[]): number {
  const title = item.title.toLowerCase();
  const summary = (item.summary ?? "").toLowerCase();
  const text = item.text.toLowerCase();
  let s = 0;
  for (const w of terms) s += (title.includes(w) ? 10 : 0) + (summary.includes(w) ? 4 : 0) + count(text, w);
  return s;
}

export function rank<T extends { title: string; summary: string | null; text: string }>(items: T[], terms: string[]): T[] {
  return items
    .map((it) => ({ it, s: score(it, terms) }))
    .sort((a, b) => b.s - a.s || a.it.title.localeCompare(b.it.title))
    .map((x) => x.it);
}
