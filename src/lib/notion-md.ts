// The editor writes Notion's Markdown dialect (callouts, columns, colors, mentions…). Places that read
// notes without the editor — Telegram, exports, the quick preview, the notes list — first turn it into
// plain Markdown with this, so nothing shows raw tags.
import { matchBlockTag, parseAttrs } from "@/lib/editor/tags";

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function dateText(start: string, end?: string) {
  const f = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return s;
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  return `@${f(start)}${end ? ` → ${f(end)}` : ""}`;
}

/** Inline tags → plain Markdown (mentions, colored text, {attrs}). */
export function simplifyInline(line: string): string {
  return line
    .replace(/<mention-page\b[^>]*>([\s\S]*?)<\/mention-page>/gi, (_m, t: string) => `@${unesc(t)}`)
    .replace(/<mention-date\b([^>]*)\/?>(?:<\/mention-date>)?/gi, (_m, a: string) => {
      const at = parseAttrs(a);
      return dateText(at.start ?? "", at.end);
    })
    .replace(/<mention-link\b([^>]*)>([\s\S]*?)<\/mention-link>/gi, (_m, a: string, t: string) => `[${unesc(t) || parseAttrs(a).url}](${parseAttrs(a).url ?? ""})`)
    .replace(/<span\b[^>]*>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/[ \t]*\{(?:\s*[\w-]+="[^"]*")+\s*\}[ \t]*$/, "");
}

const BLOCK_TAGS = ["callout", "columns", "column", "table_of_contents", "breadcrumb", "page", "video", "audio", "file", "pdf", "embed", "bookmark", "button"];

/** Whole note → plain Markdown. Callouts become quotes ("> 💡 …"), columns one after another. */
export function simplifyNotionMarkdown(md: string): string {
  const src = (md ?? "").replace(/\r\n?/g, "\n");
  if (!/<(callout|columns|column|table_of_contents|breadcrumb|page|video|audio|file|pdf|embed|bookmark|button|mention-|span)\b|\{[\w-]+="/.test(src)) return src;
  const out: string[] = [];
  let i = 0;
  let fence = false;
  while (i < src.length) {
    const nl = src.indexOf("\n", i);
    const lineEnd = nl < 0 ? src.length : nl;
    const line = src.slice(i, lineEnd);
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence) {
      const rest = src.slice(i);
      const tag = BLOCK_TAGS.find((t) => new RegExp(`^<${t}\\b`, "i").test(rest));
      const m = tag ? matchBlockTag(rest, tag) : null;
      if (tag && m) {
        out.push(blockToMarkdown(tag, m.attrs, m.inner));
        i += m.raw.length;
        continue;
      }
    }
    out.push(fence ? line : simplifyInline(line.replace(/^(<details)\b[^>]*>/i, "$1>")));
    i = lineEnd + 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function blockToMarkdown(tag: string, a: Record<string, string>, inner: string): string {
  const text = unesc(inner.trim());
  switch (tag) {
    case "callout": {
      const body = simplifyNotionMarkdown(inner.trim()).split("\n");
      body[0] = `${a.icon ? `${a.icon} ` : ""}${body[0] ?? ""}`;
      return `${body.map((l) => `> ${l}`.trimEnd()).join("\n")}\n`;
    }
    case "columns":
    case "column":
      return `${simplifyNotionMarkdown(inner.trim())}\n`;
    case "page":
      return `📄 ${text || "Untitled"}\n`;
    case "bookmark":
      return `🔖 [${a.title || a.url}](${a.url ?? ""})\n`;
    case "video":
    case "audio":
    case "file":
    case "pdf":
    case "embed": {
      const icon = { video: "🎬", audio: "🎵", file: "📎", pdf: "📕", embed: "🔗" }[tag];
      return `${icon} [${text || a.name || a.src}](${a.src ?? ""})\n`;
    }
    default:
      return "";
  }
}
