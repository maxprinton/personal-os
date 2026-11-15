// Personal OS Clipper: page → Markdown helpers. Uses only basic DOM members (nodeType, nodeName, childNodes,
// nodeValue, getAttribute, hasAttribute) so it runs in the browser and in the Node tests with a fake DOM.
(function (root) {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "BUTTON", "SVG", "NAV", "INPUT", "SELECT", "TEXTAREA", "IFRAME", "VIDEO", "AUDIO", "CANVAS", "TEMPLATE", "OBJECT", "LABEL"]);
  const INLINE = new Set(["A", "SPAN", "STRONG", "B", "EM", "I", "CODE", "IMG", "BR", "S", "DEL", "STRIKE", "SUP", "SUB", "U", "MARK", "SMALL", "ABBR", "FONT", "TIME", "CITE", "Q", "KBD", "VAR", "SAMP"]);

  const isEl = (n) => n && n.nodeType === 1;
  const isText = (n) => n && n.nodeType === 3;
  const name = (n) => String(n.nodeName || "").toUpperCase();
  const kids = (n) => Array.from(n.childNodes || []);
  const attr = (n, a) => (n.getAttribute ? n.getAttribute(a) : null);
  const hidden = (n) => (n.hasAttribute && n.hasAttribute("hidden")) || attr(n, "aria-hidden") === "true" && !textOf(n).trim();

  function textOf(n) {
    if (isText(n)) return n.nodeValue || "";
    if (!isEl(n) || SKIP.has(name(n))) return "";
    return kids(n).map(textOf).join("");
  }

  function abs(src, base) {
    if (!src) return "";
    try {
      const u = new URL(src, base || undefined);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
    } catch {
      return "";
    }
  }

  function imgMd(el, base) {
    let src = attr(el, "src") || attr(el, "data-src");
    if (!src) {
      const set = attr(el, "srcset");
      if (set) src = set.split(",")[0].trim().split(/\s+/)[0];
    }
    const url = abs(src, base);
    if (!url) return "";
    const alt = (attr(el, "alt") || "").replace(/[\[\]\n]/g, " ").replace(/\s+/g, " ").trim();
    return `![${alt}](${url})`;
  }

  function wrap(mark, inner) {
    if (!inner.trim()) return inner;
    const lead = inner.match(/^\s*/)[0];
    const trail = inner.match(/\s*$/)[0];
    return lead + mark + inner.trim() + mark + trail;
  }

  function inline(node, base) {
    if (isText(node)) return (node.nodeValue || "").replace(/\s+/g, " ");
    if (!isEl(node)) return "";
    const tag = name(node);
    if (SKIP.has(tag) || hidden(node)) return "";
    const inner = () => kids(node).map((k) => inline(k, base)).join("");
    switch (tag) {
      case "BR":
        return "\n";
      case "IMG":
        return imgMd(node, base);
      case "STRONG":
      case "B":
        return wrap("**", inner());
      case "EM":
      case "I":
        return wrap("*", inner());
      case "S":
      case "DEL":
      case "STRIKE":
        return wrap("~~", inner());
      case "CODE":
      case "KBD":
      case "SAMP": {
        const t = textOf(node).replace(/\s+/g, " ");
        return t.trim() ? "`" + t.trim().replace(/`/g, "'") + "`" : "";
      }
      case "A": {
        const href = abs(attr(node, "href"), base);
        const text = inner();
        if (!href || !text.trim()) return text;
        if (/!\[/.test(text)) return text; // a picture inside a link: keep the picture
        return `[${text.trim().replace(/[\[\]]/g, "")}](${href})`;
      }
      default:
        return inner();
    }
  }

  const clean = (s) =>
    s
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/ {2,}/g, " ")
      .replace(/\n{1,}/g, "  \n")
      .trim();

  function list(el, base, depth) {
    const ordered = name(el) === "OL";
    let i = 1;
    const lines = [];
    for (const li of kids(el)) {
      if (!isEl(li) || name(li) !== "LI" || hidden(li)) continue;
      let text = "";
      const nested = [];
      for (const c of kids(li)) {
        if (isEl(c) && (name(c) === "UL" || name(c) === "OL")) nested.push(list(c, base, depth + 1));
        else if (isEl(c) && !INLINE.has(name(c))) text += " " + inline(c, base);
        else text += inline(c, base);
      }
      const body = clean(text);
      if (!body && !nested.length) continue;
      lines.push("   ".repeat(depth) + (ordered ? `${i++}. ` : "- ") + body);
      for (const n of nested) lines.push(n);
    }
    return lines.join("\n");
  }

  function table(el, base) {
    const rows = [];
    const walk = (n) => {
      for (const c of kids(n)) {
        if (!isEl(c)) continue;
        const t = name(c);
        if (t === "TR") rows.push(kids(c).filter((x) => isEl(x) && (name(x) === "TD" || name(x) === "TH")));
        else if (t === "THEAD" || t === "TBODY" || t === "TFOOT") walk(c);
      }
    };
    walk(el);
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const cell = (c) => (c ? clean(inline(c, base)).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ") : "");
    const line = (r) => "| " + Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ") + " |";
    const out = [line(rows[0]), "| " + Array.from({ length: width }, () => "---").join(" | ") + " |"];
    for (const r of rows.slice(1)) out.push(line(r));
    return out.join("\n");
  }

  function blocks(node, base, out) {
    let run = [];
    const flush = () => {
      const t = clean(run.join(""));
      run = [];
      if (t) out.push(t);
    };
    for (const c of kids(node)) {
      if (isText(c)) {
        run.push((c.nodeValue || "").replace(/\s+/g, " "));
        continue;
      }
      if (!isEl(c)) continue;
      const tag = name(c);
      if (SKIP.has(tag) || hidden(c)) continue;
      if (tag === "IMG") {
        flush();
        const m = imgMd(c, base);
        if (m) out.push(m);
        continue;
      }
      if (INLINE.has(tag)) {
        run.push(inline(c, base));
        continue;
      }
      flush();
      if (/^H[1-6]$/.test(tag)) {
        const t = clean(inline(c, base)).replace(/\*\*/g, "");
        if (t) out.push("#".repeat(Number(tag[1])) + " " + t);
      } else if (tag === "P") {
        const t = clean(kids(c).map((k) => inline(k, base)).join(""));
        if (t) out.push(t);
      } else if (tag === "UL" || tag === "OL") {
        const t = list(c, base, 0);
        if (t) out.push(t);
      } else if (tag === "BLOCKQUOTE") {
        const inner = [];
        blocks(c, base, inner);
        if (inner.length) out.push(inner.join("\n\n").split("\n").map((l) => "> " + l).join("\n"));
      } else if (tag === "PRE") {
        const t = textOf(c).replace(/\n+$/, "");
        if (t.trim()) out.push("```\n" + t + "\n```");
      } else if (tag === "TABLE") {
        const t = table(c, base);
        if (t) out.push(t);
      } else if (tag === "HR") {
        out.push("---");
      } else {
        blocks(c, base, out);
      }
    }
    flush();
  }

  const IMG_ONLY = /^!\[[^\]]*\]\((\S+?)\)$/;
  const identity = (u) => u.split("?")[0].split("#")[0];

  /** Coursera repeats the same picture (once with its caption, once without): keep the first of a consecutive pair. */
  function finalize(list) {
    const out = [];
    for (const b of list) {
      const m = IMG_ONLY.exec(b);
      const prev = out.length ? IMG_ONLY.exec(out[out.length - 1]) : null;
      if (m && prev && identity(m[1]) === identity(prev[1])) continue;
      out.push(b);
    }
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function htmlToMd(el, baseUrl) {
    const out = [];
    blocks(el, baseUrl, out);
    return finalize(out);
  }

  /** Caption lines (cut in the middle of sentences) → readable paragraphs of ~4 sentences. */
  function transcriptToMd(lines) {
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const sentences = text.split(/(?<=[.!?])\s+/);
    const paras = [];
    for (let i = 0; i < sentences.length; i += 4) paras.push(sentences.slice(i, i + 4).join(" "));
    return paras.join("\n\n");
  }

  const STOP = new Set(
    "about after again also and are because been before being between both build but can come could course does doing during each every from have having here how into just know like make many more most much need only other over please same should some such than that their them then there these they this those through today under until very want were what when where which while who will with would your you the for use using video lesson reading week module part step learn learning introduction overview para como esto esta este pero porque cuando donde sobre entre desde hasta tiene tiene".split(
      /\s+/
    )
  );
  const stem = (w) => w.replace(/ies$/, "y").replace(/([^s])s$/, "$1");
  const words = (t) =>
    String(t || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z]{4,}/g)
      ?.filter((w) => !STOP.has(w)) ?? [];

  /** The tag that links a reading with its video: a word both titles share (longest first), else the last keyword used. */
  function guessKeyword(title, previousTitle, previousKeyword) {
    const a = words(title);
    const b = new Set(words(previousTitle).map(stem));
    const common = a.filter((w) => b.has(stem(w))).sort((x, y) => y.length - x.length);
    if (common.length) return common[0];
    return previousKeyword || "";
  }

  function fillTitle(pattern, vars) {
    const t = String(pattern || "{title}").replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
    return t.replace(/\s+/g, " ").trim();
  }

  const api = { htmlToMd, transcriptToMd, guessKeyword, fillTitle, textOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PosMd = api;
})(typeof self !== "undefined" ? self : globalThis);
