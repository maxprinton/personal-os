// Notes as a small document model (headings, paragraphs, lists, tables, toggles…) read from their Markdown,
// so every export format (text, HTML, PDF, Word, Mermaid) draws the same thing. Runs in the browser.
import { Marked, type Token, type TokenizerAndRendererExtension } from "marked";
import { simplifyNotionMarkdown } from "@/lib/notion-md";

/** A note ready to export. */
export type ExportNote = {
  id: string;
  title: string;
  content: string; // Markdown, as the editor saves it
  updatedAt?: string | null;
  tags?: string[];
  kind?: "note" | "block";
};

/** A piece of text with one style. "\n" inside text is a hard line break. */
export type Run = {
  text: string;
  b?: boolean;
  i?: boolean;
  s?: boolean; // strikethrough
  u?: boolean; // underline
  hl?: boolean; // highlight
  code?: boolean;
  href?: string;
};

export type Item = { runs: Run[]; checked: boolean | null; blocks: Block[] };

export type Block =
  | { t: "h"; level: number; runs: Run[] }
  | { t: "p"; runs: Run[] }
  | { t: "list"; ordered: boolean; start: number; items: Item[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "code"; text: string; lang: string }
  | { t: "hr" }
  | { t: "table"; align: (string | null)[]; head: Run[][]; rows: Run[][][] }
  | { t: "details"; summary: Run[]; blocks: Block[] };

// ---------- Markdown reading (marked, the same reader the editor uses) ----------

/** ==highlight== and ++underline++, the way the editor writes them. */
function inlineMark(name: "mark" | "ins", re: RegExp, delim: string): TokenizerAndRendererExtension {
  return {
    name,
    level: "inline",
    start(src: string) {
      const i = src.indexOf(delim);
      return i < 0 ? undefined : i;
    },
    tokenizer(src: string) {
      const m = re.exec(src);
      if (!m) return undefined;
      return { type: name, raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer() {
      return "";
    },
  };
}

const reader = new Marked({
  gfm: true,
  extensions: [inlineMark("mark", /^==(?=\S)([\s\S]*?\S)==/, "=="), inlineMark("ins", /^\+\+(?=\S)([\s\S]*?\S)\+\+/, "++")],
});

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

type Style = Omit<Run, "text">;
type Tk = Token & { tokens?: Token[]; text?: string; href?: string };

const same = (a: Style, b: Style) =>
  !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.u === !!b.u && !!a.hl === !!b.hl && !!a.code === !!b.code && (a.href ?? "") === (b.href ?? "");

function push(out: Run[], text: string, st: Style) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && same(last, st)) last.text += text;
  else out.push({ ...st, text });
}

function runsOf(tokens: Token[] | undefined, st: Style = {}, out: Run[] = []): Run[] {
  for (const tk of tokens ?? []) {
    const t = tk as Tk;
    switch (tk.type) {
      case "text":
        if (t.tokens?.length) runsOf(t.tokens, st, out);
        else push(out, decodeEntities(t.text ?? "").replace(/\n/g, " "), st);
        break;
      case "escape":
        push(out, t.text ?? "", st);
        break;
      case "strong":
        runsOf(t.tokens, { ...st, b: true }, out);
        break;
      case "em":
        runsOf(t.tokens, { ...st, i: true }, out);
        break;
      case "del":
        runsOf(t.tokens, { ...st, s: true }, out);
        break;
      case "mark":
        runsOf(t.tokens, { ...st, hl: true }, out);
        break;
      case "ins":
        runsOf(t.tokens, { ...st, u: true }, out);
        break;
      case "codespan":
        push(out, decodeEntities(t.text ?? "").replace(/\n/g, " "), { ...st, code: true });
        break;
      case "link":
        runsOf(t.tokens, { ...st, href: t.href }, out);
        break;
      case "image":
        push(out, t.text ? `[${t.text}]` : "[image]", { ...st, href: t.href });
        break;
      case "br":
        push(out, "\n", st);
        break;
      case "html":
        if (/^<br\s*\/?>$/i.test((t.text ?? "").trim())) push(out, "\n", st);
        break; // other tags (<u>, <span>…) are dropped, their text stays
      case "checkbox":
        break;
      default:
        if (t.tokens?.length) runsOf(t.tokens, st, out);
        else if (typeof t.text === "string") push(out, decodeEntities(t.text), st);
    }
  }
  return out;
}

export const runsText = (runs: Run[]) => runs.map((r) => r.text).join("");
const blank = (runs: Run[]) => !runsText(runs).replace(/ /g, " ").trim();

function blocksOf(tokens: Token[]): Block[] {
  const out: Block[] = [];
  for (const tk of tokens) {
    const t = tk as Tk;
    switch (tk.type) {
      case "heading": {
        const runs = runsOf(t.tokens);
        if (!blank(runs)) out.push({ t: "h", level: (tk as Token & { depth: number }).depth, runs });
        break;
      }
      case "paragraph":
      case "text": {
        const runs = t.tokens?.length ? runsOf(t.tokens) : [{ text: decodeEntities(t.text ?? "") }];
        if (!blank(runs)) out.push({ t: "p", runs });
        break;
      }
      case "list": {
        const l = tk as Token & { ordered: boolean; start: number | ""; items: (Token & { task: boolean; checked?: boolean; tokens: Token[] })[] };
        out.push({
          t: "list",
          ordered: l.ordered,
          start: typeof l.start === "number" ? l.start : 1,
          items: l.items.map((it) => {
            const rest = it.tokens.filter((x) => x.type !== "checkbox");
            const first = rest[0] as Tk | undefined;
            const lead = first && (first.type === "text" || first.type === "paragraph");
            return {
              checked: it.task ? Boolean(it.checked) : null,
              runs: lead ? (first.tokens?.length ? runsOf(first.tokens) : [{ text: decodeEntities(first.text ?? "") }]) : [],
              blocks: blocksOf(lead ? rest.slice(1) : rest),
            };
          }),
        });
        break;
      }
      case "blockquote":
        out.push({ t: "quote", blocks: blocksOf(t.tokens ?? []) });
        break;
      case "code": {
        const c = tk as Token & { text: string; lang?: string };
        out.push({ t: "code", text: c.text, lang: (c.lang ?? "").trim() });
        break;
      }
      case "hr":
        out.push({ t: "hr" });
        break;
      case "table": {
        const tb = tk as Token & { align: (string | null)[]; header: { tokens: Token[] }[]; rows: { tokens: Token[] }[][] };
        out.push({
          t: "table",
          align: tb.align,
          head: tb.header.map((c) => runsOf(c.tokens)),
          rows: tb.rows.map((r) => r.map((c) => runsOf(c.tokens))),
        });
        break;
      }
      case "html": {
        // Loose HTML: keep only its text
        const txt = decodeEntities((t.text ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
        if (txt) out.push({ t: "p", runs: [{ text: txt }] });
        break;
      }
      default:
        break; // space, def…
    }
  }
  return out;
}

/** Where the <details> that opens at 0 closes (nested toggles count). */
function closingIndex(src: string) {
  const re = /<\/?details\b[^>]*>/gi;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/** First "<details>" at the start of a line that is not inside a ``` code block. */
function findDetails(s: string) {
  const re = /^[ \t]*<details\b[^>]*>/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const fences = s.slice(0, m.index).match(/^[ \t]*(```|~~~)/gm)?.length ?? 0;
    if (fences % 2 === 0) return m.index + (m[0].length - m[0].trimStart().length);
  }
  return -1;
}

function inlineOf(text: string): Run[] {
  for (const b of blocksOf(reader.lexer(text))) if (b.t === "p" || b.t === "h") return b.runs;
  return [];
}

/** Markdown of a note → blocks. Toggles (<details>) become real blocks with their own content. */
export function parseNote(src: string): Block[] {
  const out: Block[] = [];
  let rest = (src ?? "").replace(/\r\n?/g, "\n");
  while (rest.trim()) {
    const at = findDetails(rest);
    const close = at < 0 ? null : closingIndex(rest.slice(at));
    if (at < 0 || !close) {
      out.push(...blocksOf(reader.lexer(rest)));
      break;
    }
    if (at > 0) out.push(...blocksOf(reader.lexer(rest.slice(0, at))));
    const block = rest.slice(at);
    const inner = block.slice(block.indexOf(">") + 1, close.start);
    const sum = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(inner);
    const body = (sum ? inner.slice(sum[0].length) : inner).trim();
    out.push({ t: "details", summary: inlineOf(sum ? sum[1].trim() : "") , blocks: body ? parseNote(body) : [] });
    rest = block.slice(close.end);
  }
  return out;
}

/** The note's blocks without a first heading that only repeats its title. */
export function noteBlocks(n: ExportNote): Block[] {
  const blocks = parseNote(simplifyNotionMarkdown(n.content));
  const first = blocks[0];
  if (first?.t === "h" && runsText(first.runs).trim().toLowerCase() === (n.title || "").trim().toLowerCase()) return blocks.slice(1);
  return blocks;
}

export const noteTitle = (n: ExportNote) => (n.title || "").trim() || "Untitled";

export function formatDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Block note · Edited Oct 28, 2026 · #work #ideas" */
export function noteMeta(n: ExportNote) {
  return [
    n.kind === "block" ? "Block note" : null,
    n.updatedAt ? `Edited ${formatDay(n.updatedAt)}` : null,
    n.tags?.length ? n.tags.map((t) => `#${t}`).join(" ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Only web, mail and phone links are kept as links. */
export const safeHref = (href?: string) => (href && /^(https?:|mailto:|tel:)/i.test(href.trim()) ? href.trim() : null);
