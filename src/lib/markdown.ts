// Small, safe Markdown -> HTML renderer for notes (no dependencies).
// Everything is HTML-escaped first; only http(s)/mailto links are allowed.

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inline(text: string): string {
  const codes: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code class="rounded bg-subtle px-1 font-mono text-[0.9em]">${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const u = url.replace(/&amp;/g, "&");
    if (!/^(https?:\/\/|mailto:)/i.test(u)) return m;
    return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" class="underline">${label}</a>`;
  });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

/** interactiveTasks: checkboxes can be clicked; each carries data-task-line (its line in the source). */
export function renderMarkdown(src: string, opts: { interactiveTasks?: boolean } = {}): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="overflow-x-auto rounded-md bg-subtle p-3 font-mono text-sm"><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      const size = ["text-2xl", "text-xl", "text-lg"][h[1].length - 1];
      out.push(`<h${h[1].length} class="${size} font-semibold mt-4">${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push('<hr class="my-4 border-line" />');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote class="border-l-4 border-edge pl-3 text-muted">${body.map(inline).join("<br />")}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      const sameType = (l: string) => (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/).test(l);
      while (i < lines.length && sameType(lines[i])) {
        const lineNo = i;
        let item = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        const task = /^\[( |x|X)\]\s+/.exec(item);
        if (task) {
          item = item.slice(task[0].length);
          const done = task[1] !== " ";
          items.push(`<li class="list-none -ml-5"><input type="checkbox" ${opts.interactiveTasks ? `data-task-line="${lineNo}"` : "disabled"} ${done ? "checked" : ""} class="mr-2 align-middle${opts.interactiveTasks ? " cursor-pointer" : ""}" />${done ? `<span class="line-through text-faint">${inline(item)}</span>` : inline(item)}</li>`);
        } else items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol class="list-decimal pl-5 space-y-1">${items.join("")}</ol>` : `<ul class="list-disc pl-5 space-y-1">${items.join("")}</ul>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*([-*+]|\d+\.)\s+|\s*(---|\*\*\*)\s*$)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(`<p>${para.map(inline).join("<br />")}</p>`);
  }
  return out.join("\n");
}

/** Ticks or unticks the "- [ ]" item on that line of the source. */
export function toggleTaskLine(src: string, line: number): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const l = lines[line];
  if (l === undefined) return src;
  lines[line] = l.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/, (_, pre: string, mark: string) => `${pre}[${mark === " " ? "x" : " "}]`);
  return lines.join("\n");
}
