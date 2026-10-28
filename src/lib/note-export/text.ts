// Notes as Markdown, plain text, HTML and Mermaid mind maps.
import { noteBlocks, noteMeta, noteTitle, runsText, safeHref, type Block, type ExportNote, type Run } from "./model";

// ---------- Markdown ----------

/** "# Title" + the note exactly as written (toggles, tables and checkboxes stay as they are). */
export function noteMarkdown(n: ExportNote) {
  const body = (n.content ?? "").replace(/\r\n?/g, "\n").trim();
  const head = `# ${noteTitle(n)}`;
  const tags = n.tags?.length ? `\n\n${n.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ")}` : "";
  const repeats = body.split("\n", 1)[0].trim().toLowerCase() === head.toLowerCase();
  return `${head}${tags}\n\n${repeats ? body.slice(body.indexOf("\n") + 1).trim() : body}\n`;
}

export const notesMarkdown = (notes: ExportNote[]) => notes.map(noteMarkdown).join("\n---\n\n");

// ---------- Plain text ----------

function plainRuns(runs: Run[]) {
  let s = "";
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    s += r.text;
    const href = safeHref(r.href);
    const endOfLink = href && runs[k + 1]?.href !== r.href;
    if (endOfLink && !r.text.includes(href.replace(/^mailto:|^tel:/i, ""))) s += ` (${href.replace(/^mailto:/i, "")})`;
  }
  return s.replace(/ /g, " ");
}

const indentLines = (text: string, pad: string, first = pad) =>
  text
    .split("\n")
    .map((l, i) => (i === 0 ? first : l ? pad : "") + l)
    .join("\n");

function plainTable(b: Extract<Block, { t: "table" }>) {
  const rows = [b.head, ...b.rows].map((r) => r.map((c) => plainRuns(c).replace(/\n/g, " ")));
  const n = Math.max(...rows.map((r) => r.length));
  const w = Array.from({ length: n }, (_, i) => Math.max(3, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    w
      .map((cw, i) => {
        const v = r[i] ?? "";
        const a = b.align[i];
        return a === "right" ? v.padStart(cw) : a === "center" ? v.padStart(Math.floor((cw + v.length) / 2)).padEnd(cw) : v.padEnd(cw);
      })
      .join(" | ")
      .trimEnd();
  return [line(rows[0]), w.map((cw) => "-".repeat(cw)).join("-+-"), ...rows.slice(1).map(line)].join("\n");
}

function plainBlocks(blocks: Block[], depth = 0): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "h": {
        const t = plainRuns(b.runs);
        out.push(b.level <= 2 ? `${t}\n${(b.level === 1 ? "=" : "-").repeat(Math.min(60, t.length))}` : t.toUpperCase());
        break;
      }
      case "p":
        out.push(plainRuns(b.runs));
        break;
      case "list": {
        let n = b.start;
        const items = b.items.map((it) => {
          const mark = it.checked === true ? "[x] " : it.checked === false ? "[ ] " : b.ordered ? `${n}. ` : depth % 2 ? "- " : "• ";
          n++;
          const pad = " ".repeat(mark.length);
          const head = indentLines(plainRuns(it.runs), pad, mark);
          const sub = it.blocks.length ? `\n${indentLines(plainBlocks(it.blocks, depth + 1).replace(/\n\n/g, "\n"), pad)}` : "";
          return head + sub;
        });
        out.push(items.join("\n"));
        break;
      }
      case "quote":
        out.push(indentLines(plainBlocks(b.blocks, depth), "| "));
        break;
      case "code":
        out.push(indentLines(b.text, "    "));
        break;
      case "hr":
        out.push("—".repeat(20));
        break;
      case "table":
        out.push(plainTable(b));
        break;
      case "details":
        out.push(`▸ ${plainRuns(b.summary)}${b.blocks.length ? `\n${indentLines(plainBlocks(b.blocks, depth), "  ")}` : ""}`);
        break;
    }
  }
  return out.join("\n\n");
}

export function noteText(n: ExportNote, withMeta = true) {
  const title = noteTitle(n);
  const meta = withMeta ? noteMeta(n) : "";
  const body = plainBlocks(noteBlocks(n));
  return `${title}\n${"=".repeat(Math.min(60, Math.max(3, title.length)))}\n${meta ? `${meta}\n` : ""}\n${body}\n`;
}

export const notesText = (notes: ExportNote[], withMeta = true) =>
  notes.map((n) => noteText(n, withMeta)).join(`\n${"_".repeat(48)}\n\n`);

// ---------- HTML ----------

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** clip: for the clipboard (inline styles, ☐/☑ instead of form fields), so it pastes well in Word, Docs or email. */
type HtmlOpts = { clip: boolean };

const CLIP = {
  code: "font-family:Consolas,Menlo,monospace;background:#f1f1f4;padding:0 3px;border-radius:3px;font-size:0.92em",
  pre: "font-family:Consolas,Menlo,monospace;background:#f3f4f6;padding:10px 12px;border-radius:6px;font-size:13px;white-space:pre-wrap",
  quote: "border-left:3px solid #c7d2fe;margin:0 0 0 2px;padding-left:12px;color:#4b5563",
  table: "border-collapse:collapse",
  cell: "border:1px solid #d1d5db;padding:4px 8px;vertical-align:top",
  th: "border:1px solid #d1d5db;padding:4px 8px;background:#f3f4f6;text-align:left",
  mark: "background:#fde68a",
};

function htmlRuns(runs: Run[], o: HtmlOpts) {
  return runs
    .map((r) => {
      let h = escHtml(r.text.replace(/ /g, " ")).replace(/\n/g, "<br>");
      if (r.code) h = o.clip ? `<code style="${CLIP.code}">${h}</code>` : `<code>${h}</code>`;
      if (r.hl) h = o.clip ? `<mark style="${CLIP.mark}">${h}</mark>` : `<mark>${h}</mark>`;
      if (r.u) h = `<u>${h}</u>`;
      if (r.s) h = `<s>${h}</s>`;
      if (r.i) h = `<em>${h}</em>`;
      if (r.b) h = `<strong>${h}</strong>`;
      const href = safeHref(r.href);
      if (href) h = `<a href="${escHtml(href)}">${h}</a>`;
      return h;
    })
    .join("");
}

function htmlBlocks(blocks: Block[], o: HtmlOpts): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case "h": {
          const l = Math.min(6, b.level + 1); // the note's title is the <h1>
          return `<h${l}>${htmlRuns(b.runs, o)}</h${l}>`;
        }
        case "p":
          return `<p>${htmlRuns(b.runs, o)}</p>`;
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
          const items = b.items
            .map((it) => {
              const sub = htmlBlocks(it.blocks, o);
              if (it.checked === null) return `<li>${htmlRuns(it.runs, o)}${sub}</li>`;
              const text = it.checked ? `<s>${htmlRuns(it.runs, o)}</s>` : htmlRuns(it.runs, o);
              if (o.clip) return `<li style="list-style:none">${it.checked ? "☑" : "☐"} ${text}${sub}</li>`;
              return `<li class="task${it.checked ? " done" : ""}"><input type="checkbox" disabled${it.checked ? " checked" : ""}>${text}${sub}</li>`;
            })
            .join("");
          return `<${tag}${start}>${items}</${tag}>`;
        }
        case "quote":
          return o.clip ? `<blockquote style="${CLIP.quote}">${htmlBlocks(b.blocks, o)}</blockquote>` : `<blockquote>${htmlBlocks(b.blocks, o)}</blockquote>`;
        case "code": {
          const cls = b.lang ? ` class="language-${escHtml(b.lang)}"` : "";
          return o.clip ? `<pre style="${CLIP.pre}"><code>${escHtml(b.text)}</code></pre>` : `<pre><code${cls}>${escHtml(b.text)}</code></pre>`;
        }
        case "hr":
          return "<hr>";
        case "table": {
          const al = (i: number) => (b.align[i] ? `text-align:${b.align[i]}` : "");
          const st = (base: string, i: number) => (o.clip ? ` style="${base};${al(i)}"` : al(i) ? ` style="${al(i)}"` : "");
          const head = `<tr>${b.head.map((c, i) => `<th${st(CLIP.th, i)}>${htmlRuns(c, o)}</th>`).join("")}</tr>`;
          const rows = b.rows.map((r) => `<tr>${r.map((c, i) => `<td${st(CLIP.cell, i)}>${htmlRuns(c, o)}</td>`).join("")}</tr>`).join("");
          return `<table${o.clip ? ` style="${CLIP.table}"` : ""}><thead>${head}</thead><tbody>${rows}</tbody></table>`;
        }
        case "details":
          return o.clip
            ? `<p><strong>▸ ${htmlRuns(b.summary, o)}</strong></p><div style="margin-left:1.5em">${htmlBlocks(b.blocks, o)}</div>`
            : `<details open><summary>${htmlRuns(b.summary, o)}</summary>${htmlBlocks(b.blocks, o)}</details>`;
      }
    })
    .join("\n");
}

/** For the clipboard: each note as a heading + its content. */
export function notesHtmlFragment(notes: ExportNote[]) {
  return notes
    .map((n) => `<h1>${escHtml(noteTitle(n))}</h1>\n${htmlBlocks(noteBlocks(n), { clip: true })}`)
    .join("\n<hr>\n");
}

const PAGE_CSS = `
:root{color-scheme:light dark;--fg:#1f2330;--muted:#6b7280;--line:#e5e7eb;--soft:#f3f4f6;--accent:#4f46e5;--bg:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#e7e8ee;--muted:#9ca3af;--line:#2e3140;--soft:#1d2030;--accent:#a5b4fc;--bg:#12141c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:3rem 1rem 4rem}
article+article{margin-top:3.5rem;padding-top:2.5rem;border-top:1px solid var(--line)}
h1{font-size:2rem;line-height:1.2;margin:0 0 .25rem;letter-spacing:-.01em}
h2{font-size:1.45rem;margin:1.8rem 0 .5rem}h3{font-size:1.2rem;margin:1.5rem 0 .4rem}h4,h5,h6{font-size:1.05rem;margin:1.2rem 0 .3rem}
.meta{color:var(--muted);font-size:.85rem;margin:0 0 1.5rem}
p{margin:.6rem 0}a{color:var(--accent)}
ul,ol{padding-left:1.5rem;margin:.5rem 0}li{margin:.2rem 0}li>ul,li>ol{margin:.2rem 0}
li.task{list-style:none;position:relative}li.task>input{position:absolute;left:-1.4rem;top:.38em;margin:0}li.task.done>s{color:var(--muted)}
blockquote{margin:.8rem 0;padding:.1rem 0 .1rem 1rem;border-left:3px solid var(--accent);color:var(--muted)}
code{font-family:ui-monospace,Consolas,Menlo,monospace;font-size:.9em;background:var(--soft);padding:.1em .35em;border-radius:4px}
pre{background:var(--soft);padding:.9rem 1rem;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
mark{background:#fde68a;color:#1f2330;border-radius:2px;padding:0 .1em}
hr{border:0;border-top:1px solid var(--line);margin:1.5rem 0}
table{border-collapse:collapse;width:100%;margin:.8rem 0;font-size:.95rem;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.4rem .65rem;vertical-align:top;text-align:left}th{background:var(--soft)}
details{margin:.6rem 0}summary{cursor:pointer;font-weight:600}details>:not(summary){margin-left:1.2rem}
footer{color:var(--muted);font-size:.8rem;margin-top:3rem}
@media print{body{background:#fff;color:#000}main{padding:0}article+article{break-before:page;border:0;margin:0;padding:0}a{color:inherit}}
`;

/** A complete web page (works offline, light and dark). */
export function notesHtmlPage(notes: ExportNote[]) {
  const title = notes.length === 1 ? noteTitle(notes[0]) : `Notes (${notes.length})`;
  const articles = notes
    .map((n) => {
      const meta = noteMeta(n);
      return `<article>\n<h1>${escHtml(noteTitle(n))}</h1>\n${meta ? `<p class="meta">${escHtml(meta)}</p>\n` : ""}${htmlBlocks(noteBlocks(n), { clip: false })}\n</article>`;
    })
    .join("\n");
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escHtml(title)}</title>\n<style>${PAGE_CSS}</style>\n</head>\n<body>\n<main>\n${articles}\n<footer>Exported from Personal OS · ${escHtml(new Date().toLocaleString("en-US"))}</footer>\n</main>\n</body>\n</html>\n`;
}

// ---------- Mermaid (mind map of the note's structure) ----------

const MAX_NODES = 150;
// Mermaid reads <tags> inside labels as HTML; brackets and parentheses are fine inside quotes
const MM_SUB: Record<string, string> = { "<": "‹", ">": "›" };

function mmText(s: string) {
  const t = s
    .replace(/ /g, " ")
    .replace(/["`]/g, "'")
    .replace(/[<>]/g, (c) => MM_SUB[c] ?? c)
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 70 ? `${t.slice(0, 69).trimEnd()}…` : t;
}

function mindmapLines(n: ExportNote, depth: number, ids: { n: number }): string[] {
  const out: string[] = [];
  const node = (d: number, text: string) => {
    const t = mmText(text);
    if (!t || out.length >= MAX_NODES) return false;
    out.push(`${"  ".repeat(d)}n${ids.n++}["${t}"]`);
    return true;
  };
  const firstSentence = (s: string) => (/^(.{12,}?[.!?])(\s|$)/.exec(s)?.[1] ?? s);

  const walk = (blocks: Block[], base: number) => {
    const heads: number[] = []; // levels of the open headings
    for (const b of blocks) {
      if (b.t === "h") {
        while (heads.length && heads[heads.length - 1] >= b.level) heads.pop();
        node(base + heads.length, runsText(b.runs));
        heads.push(b.level);
        continue;
      }
      const d = base + heads.length;
      if (b.t === "p") node(d, firstSentence(runsText(b.runs)));
      else if (b.t === "list") {
        const items = (list: Extract<Block, { t: "list" }>, dd: number) => {
          for (const it of list.items) {
            const mark = it.checked === true ? "☑ " : it.checked === false ? "☐ " : "";
            node(dd, mark + runsText(it.runs));
            for (const sub of it.blocks) if (sub.t === "list") items(sub, dd + 1);
          }
        };
        items(b, d);
      } else if (b.t === "quote") walk(b.blocks, d);
      else if (b.t === "code") node(d, b.lang ? `Code · ${b.lang}` : "Code");
      else if (b.t === "table") node(d, `Table: ${b.head.map(runsText).join(" · ")}`);
      else if (b.t === "details") {
        if (node(d, `▸ ${runsText(b.summary)}`)) walk(b.blocks, d + 1);
      }
    }
  };
  walk(noteBlocks(n), depth);
  return out;
}

/** Mermaid "mindmap": the title in the middle, its headings, lists and paragraphs around it. */
export function notesMermaid(notes: ExportNote[]) {
  const ids = { n: 1 };
  const lines = ["mindmap"];
  if (notes.length === 1) {
    lines.push(`  root(("${mmText(noteTitle(notes[0])) || "Note"}"))`);
    lines.push(...mindmapLines(notes[0], 2, ids));
  } else {
    lines.push(`  root(("Notes"))`);
    for (const n of notes) {
      lines.push(`    n${ids.n++}["${mmText(noteTitle(n))}"]`);
      lines.push(...mindmapLines(n, 3, ids));
    }
  }
  return `${lines.join("\n")}\n`;
}
