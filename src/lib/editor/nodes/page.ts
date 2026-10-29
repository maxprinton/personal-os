// Links between notes, like Notion pages:
//   block    <page url="/notes/ID">Title</page>                (a sub-page or "Link to page")
//   inline   <mention-page url="/notes/ID">Title</mention-page> (@ mention, [[ link)
//            <mention-date start="2026-10-28"/>                 (@today, @next monday…)
//            <mention-link url="https://…">Title</mention-link> (a pasted web link shown as a mention)
//   block    <breadcrumb/>                                     (Notes / Parent / This page)
// Titles and icons are drawn live from the list of notes; the saved title is only a fallback.
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { attrString, blockTagTokenizer, escAttr, inlineTagTokenizer, type TagToken } from "@/lib/editor/tags";
import { noteHref, noteIdFromUrl, onPagesChange, type PageRef } from "@/lib/editor/context";
import { requestUi } from "@/lib/editor/ui-events";

const pageOf = (editor: Editor, url: string) => {
  const id = noteIdFromUrl(url);
  return id ? editor.storage.notion?.pages.get(id) ?? null : null;
};

function escText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function unescText(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function iconEl(icon: string | null | undefined, fallback = "📄") {
  const span = document.createElement("span");
  span.className = "n-page-icon";
  const v = icon || fallback;
  if (/^(https?:|\/)/.test(v)) {
    const img = document.createElement("img");
    img.src = v;
    img.alt = "";
    span.append(img);
  } else span.textContent = v;
  return span;
}

function go(editor: Editor, url: string, e: MouseEvent) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) window.open(url, "_blank", "noopener");
  else editor.storage.notion.navigate(url);
}

// ---------- Page block ----------

export const PageLink = Node.create({
  name: "pageLink",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "", parseHTML: (el) => el.getAttribute("data-url") ?? "" },
      title: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "page", "data-url": node.attrs.url }), node.attrs.title || "Untitled"];
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "n-page-block";
      dom.contentEditable = "false";
      const a = document.createElement("a");
      a.className = "n-page-link";
      dom.append(a);
      const paint = () => {
        const p = pageOf(editor, current.attrs.url);
        a.href = current.attrs.url;
        a.replaceChildren(iconEl(p?.icon), Object.assign(document.createElement("span"), { className: "n-page-title", textContent: p?.title || current.attrs.title || "Untitled" }));
        dom.classList.toggle("is-missing", !!noteIdFromUrl(current.attrs.url) && editor.storage.notion.pages.size > 0 && !p);
      };
      paint();
      a.addEventListener("click", (e) => go(editor, current.attrs.url, e));
      const off = onPagesChange(editor.storage.notion, paint);
      return {
        dom,
        update: (n: PMNode) => {
          if (n.type !== current.type) return false;
          current = n;
          paint();
          return true;
        },
        destroy: () => off(),
        stopEvent: (e) => e.type === "click",
        ignoreMutation: () => true,
      };
    };
  },
  markdownTokenizer: blockTagTokenizer("page", "pageLink", "raw"),
  markdownTokenName: "pageLink",
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    return h.createNode("pageLink", { url: t.attrs.url ?? "", title: unescText((t.inner ?? "").trim()) });
  },
  renderMarkdown: (node) => `<page url="${escAttr(String(node.attrs?.url ?? ""))}">${escText(String(node.attrs?.title || "Untitled"))}</page>`,
});

/** Keeps the saved fallback titles of page blocks and mentions up to date (called before saving). */
export function refreshPageTitles(editor: Editor) {
  const { pages } = editor.storage.notion;
  if (!pages.size) return;
  const tr = editor.state.tr;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "pageLink" || n.type.name === "mentionPage") {
      const p = pages.get(noteIdFromUrl(n.attrs.url) ?? "");
      if (p && p.title && p.title !== n.attrs.title) tr.setNodeMarkup(pos, undefined, { ...n.attrs, title: p.title });
    }
    return true;
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

// ---------- Inline mentions ----------

export const MentionPage = Node.create({
  name: "mentionPage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      url: { default: "", parseHTML: (el) => el.getAttribute("data-url") ?? "" },
      title: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="mention-page"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-type": "mention-page", "data-url": node.attrs.url, href: node.attrs.url }), node.attrs.title || "Untitled"];
  },
  renderText: ({ node }) => `@${node.attrs.title || "Untitled"}`,
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("a");
      dom.className = "n-mention-page";
      dom.contentEditable = "false";
      const paint = () => {
        const p = pageOf(editor, current.attrs.url);
        dom.href = current.attrs.url;
        dom.replaceChildren(iconEl(p?.icon), Object.assign(document.createElement("span"), { className: "n-mention-title", textContent: p?.title || current.attrs.title || "Untitled" }));
      };
      paint();
      dom.addEventListener("click", (e) => go(editor, current.attrs.url, e));
      const off = onPagesChange(editor.storage.notion, paint);
      return {
        dom,
        update: (n: PMNode) => {
          if (n.type !== current.type) return false;
          current = n;
          paint();
          return true;
        },
        destroy: () => off(),
        stopEvent: (e) => e.type === "click",
        ignoreMutation: () => true,
      };
    };
  },
  markdownTokenName: "mentionPage",
  markdownTokenizer: inlineTagTokenizer("mention-page", "mentionPage", "text"),
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    return h.createNode("mentionPage", { url: t.attrs.url ?? "", title: unescText((t.inner ?? "").trim()) });
  },
  renderMarkdown: (node) => `<mention-page url="${escAttr(String(node.attrs?.url ?? ""))}">${escText(String(node.attrs?.title || "Untitled"))}</mention-page>`,
});

const DAY = 86400000;
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function dateLabel(start: string, end?: string | null, time?: string | null) {
  const label = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return s;
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const diff = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };
  return `${label(start)}${time ? ` ${time}` : ""}${end ? ` → ${label(end)}` : ""}`;
}

/** "today", "tomorrow", "next monday", "oct 30", "2026-11-02", "30/10" → YYYY-MM-DD (null if not a date). */
export function parseDateQuery(q: string, now = new Date()): string | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (n: number) => ymd(new Date(base.getTime() + n * DAY));
  if (/^(today|hoy|now)$/.test(s)) return plus(0);
  if (/^(tomorrow|tmr|mañana|manana)$/.test(s)) return plus(1);
  if (/^(yesterday|ayer)$/.test(s)) return plus(-1);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const es = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const wd = /^(next |last |this |el |próximo |proximo )?([a-zé]+)$/.exec(s.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  if (wd) {
    let i = days.findIndex((d) => d.startsWith(wd[2]) && wd[2].length >= 2);
    if (i < 0) i = es.findIndex((d) => d.startsWith(wd[2]) && wd[2].length >= 2);
    if (i >= 0) {
      const cur = base.getDay();
      let diff = (i - cur + 7) % 7;
      if (wd[1]?.startsWith("last")) diff = diff === 0 ? -7 : diff - 7;
      else if (diff === 0 || wd[1]?.startsWith("next") || wd[1]?.startsWith("pr")) diff = diff === 0 ? 7 : diff;
      return plus(diff);
    }
  }
  const inN = /^in (\d+) (day|days|week|weeks)$/.exec(s);
  if (inN) return plus(Number(inN[1]) * (inN[2].startsWith("week") ? 7 : 1));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return ymd(new Date(+iso[1], +iso[2] - 1, +iso[3]));
  const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (dm) {
    const y = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : base.getFullYear();
    const a = +dm[1];
    const b = +dm[2];
    const [d, m] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]; // day first, like Ecuador
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return ymd(new Date(y, m - 1, d));
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mesesEs = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const md = /^([a-z]{3,})\.? (\d{1,2})(?:,? (\d{4}))?$/.exec(s) ?? null;
  const dmn = /^(\d{1,2}) (?:de )?([a-z]{3,})(?: (?:de )?(\d{4}))?$/.exec(s) ?? null;
  const pick = (name: string) => {
    const k = name.slice(0, 3);
    const i = months.indexOf(k);
    return i >= 0 ? i : mesesEs.indexOf(k);
  };
  if (md && pick(md[1]) >= 0) return ymd(new Date(md[3] ? +md[3] : base.getFullYear(), pick(md[1]), +md[2]));
  if (dmn && pick(dmn[2]) >= 0) return ymd(new Date(dmn[3] ? +dmn[3] : base.getFullYear(), pick(dmn[2]), +dmn[1]));
  return null;
}

export const MentionDate = Node.create({
  name: "mentionDate",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      start: { default: "", parseHTML: (el) => el.getAttribute("data-start") ?? "" },
      end: { default: null, parseHTML: (el) => el.getAttribute("data-end") },
      time: { default: null, parseHTML: (el) => el.getAttribute("data-time") },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mention-date"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "mention-date", "data-start": node.attrs.start }), `@${dateLabel(node.attrs.start, node.attrs.end, node.attrs.time)}`];
  },
  renderText: ({ node }) => `@${dateLabel(node.attrs.start, node.attrs.end, node.attrs.time)}`,
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.className = "n-mention-date";
      dom.contentEditable = "false";
      const paint = () => {
        dom.textContent = `@${dateLabel(current.attrs.start, current.attrs.end, current.attrs.time)}`;
      };
      paint();
      dom.addEventListener("click", () => {
        if (!editor.isEditable) return;
        requestUi(editor.view, {
          kind: "date",
          rect: dom.getBoundingClientRect(),
          start: current.attrs.start,
          end: current.attrs.end,
          time: current.attrs.time,
          onSave: (v) => {
            const p = typeof getPos === "function" ? getPos() : undefined;
            if (typeof p !== "number") return;
            if (!v) editor.chain().deleteRange({ from: p, to: p + current.nodeSize }).focus().run();
            else editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, v));
          },
        });
      });
      return {
        dom,
        update: (n: PMNode) => {
          if (n.type !== current.type) return false;
          current = n;
          paint();
          return true;
        },
        stopEvent: (e) => e.type === "click",
        ignoreMutation: () => true,
      };
    };
  },
  markdownTokenName: "mentionDate",
  markdownTokenizer: inlineTagTokenizer("mention-date", "mentionDate", "text"),
  parseMarkdown: (token, h) => {
    const a = (token as unknown as TagToken).attrs;
    return h.createNode("mentionDate", { start: a.start ?? "", end: a.end ?? null, time: a.startTime ?? null });
  },
  renderMarkdown: (node) => `<mention-date${attrString({ start: node.attrs?.start as string, end: node.attrs?.end as string, startTime: node.attrs?.time as string })}/>`,
});

export const LinkMention = Node.create({
  name: "linkMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      url: { default: "", parseHTML: (el) => el.getAttribute("href") ?? "" },
      title: { default: "", parseHTML: (el) => el.textContent ?? "" },
      icon: { default: null, parseHTML: (el) => el.getAttribute("data-icon") },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="mention-link"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-type": "mention-link", href: node.attrs.url, target: "_blank", rel: "noopener noreferrer" }), node.attrs.title || node.attrs.url];
  },
  renderText: ({ node }) => node.attrs.title || node.attrs.url,
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("a");
      dom.className = "n-mention-link";
      dom.contentEditable = "false";
      dom.href = node.attrs.url;
      dom.target = "_blank";
      dom.rel = "noopener noreferrer";
      let host = "";
      try {
        host = new URL(node.attrs.url).hostname;
      } catch {}
      const icon = document.createElement("img");
      icon.className = "n-mention-favicon";
      icon.alt = "";
      icon.src = node.attrs.icon || (host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : "");
      icon.onerror = () => icon.remove();
      const title = Object.assign(document.createElement("span"), { className: "n-mention-title", textContent: node.attrs.title || host || node.attrs.url });
      dom.append(icon, title);
      return { dom, stopEvent: (e) => e.type === "click", ignoreMutation: () => true };
    };
  },
  markdownTokenName: "linkMention",
  markdownTokenizer: inlineTagTokenizer("mention-link", "linkMention", "text"),
  parseMarkdown: (token, h) => {
    const t = token as unknown as TagToken;
    return h.createNode("linkMention", { url: t.attrs.url ?? "", icon: t.attrs.icon ?? null, title: unescText((t.inner ?? "").trim()) });
  },
  renderMarkdown: (node) =>
    `<mention-link${attrString({ url: node.attrs?.url as string, icon: node.attrs?.icon as string })}>${escText(String(node.attrs?.title || node.attrs?.url || ""))}</mention-link>`,
});

// ---------- Breadcrumb ----------

export function ancestors(pages: Map<string, PageRef>, id: string | null): PageRef[] {
  const chain: PageRef[] = [];
  const seen = new Set<string>();
  let cur = id ? pages.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? pages.get(cur.parentId) : undefined;
  }
  return chain;
}

export const Breadcrumb = Node.create({
  name: "breadcrumb",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="breadcrumb"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "breadcrumb" })];
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement("div");
      dom.className = "n-breadcrumb";
      dom.contentEditable = "false";
      const paint = () => {
        const s = editor.storage.notion;
        const chain = ancestors(s.pages, s.noteId);
        dom.replaceChildren();
        const root = Object.assign(document.createElement("a"), { href: "/notes", textContent: "Notes", className: "n-crumb" });
        dom.append(root);
        for (const p of chain) {
          dom.append(Object.assign(document.createElement("span"), { className: "n-crumb-sep", textContent: "/" }));
          const a = Object.assign(document.createElement("a"), { href: noteHref(p.id), className: "n-crumb" });
          a.append(iconEl(p.icon), Object.assign(document.createElement("span"), { textContent: p.title || "Untitled" }));
          a.addEventListener("click", (e) => go(editor, noteHref(p.id), e));
          dom.append(a);
        }
      };
      paint();
      const off = onPagesChange(editor.storage.notion, paint);
      return { dom, destroy: () => off(), stopEvent: (e) => e.type === "click", ignoreMutation: () => true };
    };
  },
  markdownTokenizer: blockTagTokenizer("breadcrumb", "breadcrumb", "none"),
  parseMarkdown: (_t, h) => h.createNode("breadcrumb"),
  renderMarkdown: () => "<breadcrumb/>",
});
