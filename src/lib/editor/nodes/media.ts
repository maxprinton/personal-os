// Media blocks (Notion): image, video, audio, file, PDF, embed and web bookmark.
//   ![Caption](url) {width="480" align="center"}
//   <video src="url" width="640">Caption</video>      <audio src="url">Caption</audio>
//   <file src="url" name="report.pdf" size="20480">Caption</file>      <pdf src="url" height="600">Caption</pdf>
//   <embed src="url" height="400">Caption</embed>
//   <bookmark url="https://…" title="…" description="…" image="…" icon="…"/>
// The views (React) are plugged in by RichEditor. A block without src shows "Add an image…".
import { Node, mergeAttributes, type MarkdownToken } from "@tiptap/core";
import { attrString, blockTagTokenizer, escAttr, type TagToken } from "@/lib/editor/tags";

export const MEDIA_TYPES = ["image", "video", "audio", "file", "pdf", "embed", "bookmark"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

const num = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const align = (v: unknown) => (v === "left" || v === "right" ? v : v === "center" ? "center" : null);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** Unsaved uploads (blob:) are never written to the note. */
const saved = (src: unknown) => (typeof src === "string" && !src.startsWith("blob:") ? src : "");

function base(name: MediaType) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      const a: Record<string, { default: unknown; rendered?: boolean }> = {
        src: { default: "" },
        caption: { default: "" },
        width: { default: null },
        height: { default: null },
        align: { default: null },
        name: { default: null },
        size: { default: null },
        title: { default: null },
        description: { default: null },
        image: { default: null },
        icon: { default: null },
        uploading: { default: false, rendered: false },
      };
      return a;
    },
    parseHTML() {
      return [{ tag: `div[data-type="${name}"]`, getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("data-src") ?? "" }) }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": name, "data-src": node.attrs.src })];
    },
  });
}

/** Image: Markdown image on its own line, plus {width align}. */
export const ImageBlock = base("image").extend({
  parseHTML() {
    return [
      { tag: 'div[data-type="image"]', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("data-src") ?? "" }) },
      { tag: "img[src]", getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("src"), caption: (el as HTMLElement).getAttribute("alt") ?? "" }) },
    ];
  },
  markdownTokenName: "image",
  markdownTokenizer: {
    name: "image",
    level: "block",
    start: (src: string) => {
      const i = src.search(/(^|\n)!\[/);
      return i < 0 ? -1 : src[i] === "\n" ? i + 1 : i;
    },
    tokenize(src: string) {
      const m = /^!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)(?:[ \t]*\{([^}\n]*)\})?[ \t]*(?:\n|$)/.exec(src);
      if (!m) return undefined;
      const attrs: Record<string, string> = {};
      const re = /([\w-]+)="([^"]*)"/g;
      let a: RegExpExecArray | null;
      while ((a = re.exec(m[3] ?? ""))) attrs[a[1]] = a[2];
      return { type: "image", raw: m[0], href: m[2], text: m[1], attrs } as unknown as MarkdownToken;
    },
  },
  parseMarkdown: (token, h) => {
    const t = token as unknown as { href?: string; text?: string; attrs?: Record<string, string> };
    return h.createNode("image", { src: t.href ?? "", caption: unesc(t.text ?? ""), width: num(t.attrs?.width), align: align(t.attrs?.align) });
  },
  renderMarkdown: (node) => {
    const src = saved(node.attrs?.src);
    if (!src) return "";
    const extra = attrString({ width: num(node.attrs?.width), align: align(node.attrs?.align) }).trim();
    const caption = String(node.attrs?.caption ?? "").replace(/[\[\]\n]/g, " ");
    return `![${caption}](${src.replace(/[()\s]/g, encodeURIComponent)})${extra ? ` {${extra}}` : ""}`;
  },
});

/** <tag src="…" …>Caption</tag> blocks. */
function tagMedia(name: Exclude<MediaType, "image" | "bookmark">, keys: string[]) {
  return base(name).extend({
    markdownTokenName: name,
    markdownTokenizer: blockTagTokenizer(name, name, "raw"),
    parseMarkdown: (token, h) => {
      const t = token as unknown as TagToken;
      const attrs: Record<string, unknown> = { src: t.attrs.src ?? t.attrs.url ?? "", caption: unesc((t.inner ?? "").trim()) };
      for (const k of keys) attrs[k] = k === "name" ? t.attrs[k] ?? null : num(t.attrs[k]);
      return h.createNode(name, attrs);
    },
    renderMarkdown: (node) => {
      const src = saved(node.attrs?.src);
      if (!src) return "";
      const extra: Record<string, string | number | null> = { src };
      for (const k of keys) extra[k] = (node.attrs?.[k] as string | number | null) ?? null;
      return `<${name}${attrString(extra)}>${esc(String(node.attrs?.caption ?? ""))}</${name}>`;
    },
  });
}

export const VideoBlock = tagMedia("video", ["width"]);
export const AudioBlock = tagMedia("audio", []);
export const FileBlock = tagMedia("file", ["name", "size"]);
export const PdfBlock = tagMedia("pdf", ["height"]);
export const EmbedBlock = tagMedia("embed", ["height"]);

export const BookmarkBlock = base("bookmark").extend({
  markdownTokenName: "bookmark",
  markdownTokenizer: blockTagTokenizer("bookmark", "bookmark", "raw"),
  parseMarkdown: (token, h) => {
    const a = (token as unknown as TagToken).attrs;
    return h.createNode("bookmark", { src: a.url ?? a.src ?? "", title: a.title ?? null, description: a.description ?? null, image: a.image ?? null, icon: a.icon ?? null });
  },
  renderMarkdown: (node) => {
    const a = node.attrs ?? {};
    if (!a.src) return "";
    return `<bookmark${attrString({ url: a.src as string, title: a.title as string, description: a.description as string, image: a.image as string, icon: a.icon as string })}/>`;
  },
});

export const MEDIA_LABEL: Record<MediaType, { add: string; icon: string; link: string }> = {
  image: { add: "Add an image", icon: "🖼️", link: "Paste the image link…" },
  video: { add: "Embed or upload a video", icon: "🎬", link: "Paste in https://… (YouTube, Vimeo, Loom or a video file)" },
  audio: { add: "Embed or upload audio", icon: "🎵", link: "Paste the audio link…" },
  file: { add: "Upload or embed a file", icon: "📎", link: "Paste the file link…" },
  pdf: { add: "Embed or upload a PDF", icon: "📕", link: "Paste the PDF link…" },
  embed: { add: "Embed anything (Google Maps, Figma, Spotify…)", icon: "🔗", link: "Paste in https://…" },
  bookmark: { add: "Add a web bookmark", icon: "🔖", link: "Paste in https://…" },
};

/** YouTube / Vimeo / Loom / Figma / Spotify / Google Maps / CodePen / Drive links → embeddable URL. */
export function embedUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v) return `https://www.youtube.com/embed/${v}`;
    const s = /^\/(shorts|live)\/([\w-]+)/.exec(u.pathname);
    if (s) return `https://www.youtube.com/embed/${s[2]}`;
    if (u.pathname.startsWith("/embed/")) return raw;
  }
  if (host === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
  if (host === "vimeo.com") {
    const id = /\/(\d+)/.exec(u.pathname)?.[1];
    if (id) return `https://player.vimeo.com/video/${id}`;
  }
  if (host === "loom.com" && u.pathname.startsWith("/share/")) return `https://www.loom.com/embed/${u.pathname.split("/")[2]}`;
  if (host === "figma.com") return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(raw)}`;
  if (host === "open.spotify.com" && !u.pathname.startsWith("/embed")) return `https://open.spotify.com/embed${u.pathname}`;
  if (host === "codepen.io") return raw.replace("/pen/", "/embed/");
  if (host === "docs.google.com" || host === "drive.google.com") return raw.replace(/\/(edit|view)(\?.*)?$/, "/preview");
  if ((host === "google.com" || host.startsWith("google.")) && u.pathname.startsWith("/maps")) return `https://maps.google.com/maps?q=${encodeURIComponent(u.searchParams.get("q") ?? decodeURIComponent(u.pathname.split("/place/")[1]?.split("/")[0] ?? ""))}&output=embed`;
  return null;
}

export const isVideoFile = (src: string) => /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(src);
export const escapeAttr = escAttr;
