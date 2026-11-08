// Portfolio add-on, Phase 8 — ✨ translate a page into the other language (pure logic; the AI call is passed in).
// Anything that must not change (code, math, links, image paths, the editor's block tags) is swapped for a numbered
// marker before the text goes to the AI and put back afterwards. If a marker comes back missing or duplicated, the
// result is refused instead of being saved broken.
import type { Lang } from "@/lib/portfolio/constants";

export const MAX_CHARS = 15_000; // longer pages: translate them in parts
export const CHUNK_CHARS = 3_000;

const NAME: Record<Lang, string> = { en: "English", es: "Spanish" };
export const otherLang = (l: Lang): Lang => (l === "en" ? "es" : "en");

const OPEN = "⟦"; // ⟦
const CLOSE = "⟧"; // ⟧
const MARK = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");

/** Replaces the parts that must stay exactly as they are. */
export function protect(md: string): { text: string; saved: string[] } {
  const saved: string[] = [];
  const keep = (s: string) => {
    saved.push(s);
    return `${OPEN}${saved.length - 1}${CLOSE}`;
  };
  let t = md.replace(/\r\n?/g, "\n");
  t = t.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g, (m, lead: string) => lead + keep(m.slice(lead.length))); // fenced code
  t = t.replace(/\$\$[\s\S]+?\$\$/g, (m) => keep(m)); // block math
  t = t.replace(/`[^`\n]+`/g, (m) => keep(m)); // inline code
  t = t.replace(/<\/?[a-z_][\w-]*(?:\s+[\w-]+(?:\s*=\s*"[^"]*")?)*\s*\/?>/gi, (m) => keep(m)); // the editor's block tags
  t = t.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_m, url: string, title: string) => `](${keep(url)}${title})`); // link and image addresses
  t = t.replace(/https?:\/\/[^\s)\]>"]+/g, (m) => keep(m)); // bare addresses
  return { text: t, saved };
}

export function restore(text: string, saved: string[]): string {
  return text.replace(MARK, (m, n: string) => saved[Number(n)] ?? m);
}

/** Every marker that was sent must come back exactly once. */
export function markersOk(sent: string, got: string): boolean {
  const count = (s: string) => {
    const c = new Map<string, number>();
    for (const m of s.matchAll(MARK)) c.set(m[1], (c.get(m[1]) ?? 0) + 1);
    return c;
  };
  const a = count(sent);
  const b = count(got);
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Cuts one long paragraph into pieces of at most `max` characters, at a space or line break when there is one. */
function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max));
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[ \t]+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/** Splits at blank lines (never inside a marker), pieces of about `max` characters. */
export function chunk(text: string, max = CHUNK_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    for (const p of para.length > max ? hardSplit(para, max) : [para]) {
      if (cur && cur.length + p.length + 2 > max) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function systemPrompt(from: Lang, to: Lang): string {
  return [
    `You translate pages of a personal portfolio website from ${NAME[from]} to ${NAME[to]}.`,
    "The text is Markdown. Keep its structure exactly: headings, lists, tables, quotes, bold and italics, line breaks, blank lines.",
    `Markers like ${OPEN}0${CLOSE} stand for code, links, addresses or formatting tags. Copy every marker unchanged, exactly once, in the same place.`,
    "Write the way a person would write it, in the first person if the original does. Keep names of people, products, projects and technologies as they are.",
    "Do not add, remove, summarise or explain anything. Do not add notes, comments or a preface.",
    "If the first line starts with TITLE:, translate that title too and keep the TITLE: prefix on the first line.",
    `Reply with the translation only.`,
  ].join("\n");
}

/** Removes things models like to add around a translation. */
export function cleanOutput(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n").trim();
  t = t.replace(/^(?:here(?:'s| is) the translation|aqu[ií] (?:est[aá]|tienes) la traducci[oó]n|sure|claro)[^\n]*:\s*\n+/i, "");
  const wrapped = t.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/i);
  if (wrapped) t = wrapped[1].trim();
  return t.trim();
}

export type Ask = (system: string, user: string) => Promise<{ text: string } | { error: string }>;
export type Translated = { ok: true; title: string; content: string; parts: number } | { ok: false; error: string };

/** Translates a title and a Markdown body. Calls `ask` once per piece (about 3,000 characters each). */
export async function translatePage(input: { title: string; content: string; from: Lang; to: Lang }, ask: Ask): Promise<Translated> {
  const body = input.content.replace(/\r\n?/g, "\n").trim();
  if (!body && !input.title.trim()) return { ok: false, error: "The note is empty: write something first." };
  if (body.length > MAX_CHARS) return { ok: false, error: `This page is too long to translate in one go (${Math.round(body.length / 1000)}K characters; the limit is ${MAX_CHARS / 1000}K). Translate it in parts.` };
  if (input.from === input.to) return { ok: false, error: "Pick two different languages." };
  const { text, saved } = protect(body);
  const pieces = chunk(text);
  if (!pieces.length) pieces.push("");
  const system = systemPrompt(input.from, input.to);
  const out: string[] = [];
  let title = input.title.trim();
  for (let i = 0; i < pieces.length; i++) {
    const first = i === 0;
    const user = first ? `TITLE: ${input.title.trim().replace(/\n/g, " ")}\n\n${pieces[i]}` : pieces[i];
    const r = await ask(system, user);
    if (!("text" in r)) return { ok: false, error: r.error };
    let got = cleanOutput(r.text);
    if (first) {
      const m = got.match(/^TITLE:[ \t]*([^\n]*)\n*/i);
      if (m) {
        title = m[1].trim().slice(0, 200) || title;
        got = got.slice(m[0].length);
      }
    }
    if (!got.trim() && pieces[i].trim()) return { ok: false, error: "The AI returned nothing for part of the page. Try again." };
    if (!markersOk(pieces[i], got)) return { ok: false, error: "The AI changed or dropped a code block, link or image. Nothing was saved. Try again." };
    const ratio = got.length / Math.max(1, pieces[i].length);
    if (pieces[i].length > 200 && (ratio < 0.35 || ratio > 2.8)) return { ok: false, error: "The translation came back with a very different length, so I did not trust it. Try again." };
    out.push(got);
  }
  return { ok: true, title, content: restore(out.join("\n\n"), saved), parts: pieces.length };
}
