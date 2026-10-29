"use client";

// How image / video / audio / file / PDF / embed / bookmark blocks look and behave (Notion):
// empty block → "Add an image" with Upload / Embed link; images resize from their sides, align,
// have a caption and open full screen; bookmarks show title, description, icon and picture.
import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { embedUrl, isVideoFile, MEDIA_LABEL, type MediaType } from "@/lib/editor/nodes/media";
import { fetchLinkMeta } from "@/components/editor/Popovers";
import { Popover, MenuItem } from "@/components/editor/ui";

const ACCEPT: Partial<Record<MediaType, string>> = { image: "image/*", video: "video/*", audio: "audio/*", pdf: "application/pdf", file: "*/*" };

export function formatSize(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const hostOf = (u: string) => {
  try {
    return new URL(u, "https://x.invalid").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export default function MediaView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const type = node.type.name as MediaType;
  const a = node.attrs as {
    src: string;
    caption: string;
    width: number | null;
    height: number | null;
    align: string | null;
    name: string | null;
    size: number | null;
    title: string | null;
    description: string | null;
    image: string | null;
    icon: string | null;
    uploading: boolean;
  };
  const editable = editor.isEditable;
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [showCaption, setShowCaption] = useState(!!a.caption);
  const [full, setFull] = useState(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [w, setW] = useState<number | null>(a.width);
  const frame = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setW(a.width), [a.width]);
  useEffect(() => {
    if (a.caption) setShowCaption(true);
  }, [a.caption]);

  // Bookmarks fill in their title / description / picture once
  useEffect(() => {
    if (type !== "bookmark" || !a.src || a.title) return;
    let alive = true;
    void fetchLinkMeta(a.src).then((m) => {
      if (alive) updateAttributes({ title: m.title || hostOf(a.src), description: m.description ?? null, image: m.image ?? null, icon: m.icon ?? null });
    });
    return () => {
      alive = false;
    };
  }, [type, a.src, a.title, updateAttributes]);

  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [full]);

  const label = MEDIA_LABEL[type];

  // ---------- Empty block
  if (!a.src) {
    return (
      <NodeViewWrapper className="n-media" data-type={type}>
        <button
          type="button"
          data-media-empty
          contentEditable={false}
          className={`n-media-empty ${selected ? "is-selected" : ""}`}
          onClick={(e) => editable && setPicker((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          <span className="text-lg">{label.icon}</span>
          {label.add}
        </button>
        {picker && (
          <MediaPicker
            type={type}
            rect={picker}
            onClose={() => setPicker(null)}
            upload={editor.storage.notion.upload}
            onDone={(v) => {
              setPicker(null);
              if (v) updateAttributes(v);
            }}
          />
        )}
      </NodeViewWrapper>
    );
  }

  const captionEl =
    type !== "bookmark" && (showCaption || a.caption) ? (
      <input
        className="n-caption"
        value={a.caption}
        readOnly={!editable}
        placeholder="Write a caption…"
        onChange={(e) => updateAttributes({ caption: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            editor.commands.focus();
          }
        }}
        onBlur={() => !a.caption && setShowCaption(false)}
      />
    ) : null;

  const toolbar = editable ? (
    <div className="n-media-tools" contentEditable={false}>
      {type === "image" &&
        (["left", "center", "right"] as const).map((al) => (
          <button key={al} type="button" title={`Align ${al}`} className={(a.align ?? "center") === al ? "is-on" : ""} onClick={() => updateAttributes({ align: al === "center" ? null : al })}>
            {al === "left" ? "⇤" : al === "center" ? "↔" : "⇥"}
          </button>
        ))}
      {type !== "bookmark" && (
        <button type="button" title="Caption" onClick={() => setShowCaption(true)}>
          💬
        </button>
      )}
      {type === "image" && (
        <button type="button" title="View full screen" onClick={() => setFull(true)}>
          ⤢
        </button>
      )}
      <button type="button" title="More" onClick={(e) => setMenu((e.currentTarget as HTMLElement).getBoundingClientRect())}>
        ⋯
      </button>
    </div>
  ) : null;

  const moreMenu = menu && (
    <Popover rect={menu} onClose={() => setMenu(null)} width={220} className="n-menu">
      <div className="p-1">
        <MenuItem icon="⟳" label="Replace" onClick={() => (setMenu(null), updateAttributes({ src: "", title: null }))} />
        <MenuItem icon="↗" label="Original" onClick={() => (setMenu(null), window.open(a.src, "_blank", "noopener"))} />
        {a.src.startsWith("/api/files/") && <MenuItem icon="⬇" label="Download" onClick={() => (setMenu(null), window.open(`${a.src}?download=1`, "_blank"))} />}
        <MenuItem icon="🔗" label="Copy link" onClick={() => (setMenu(null), void navigator.clipboard?.writeText(new URL(a.src, window.location.origin).href))} />
        <MenuItem icon="🗑" label="Delete" danger onClick={() => (setMenu(null), deleteNode())} />
      </div>
    </Popover>
  );

  // ---------- Image
  if (type === "image") {
    const startResize = (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = frame.current?.getBoundingClientRect().width ?? 300;
      const max = wrap.current?.getBoundingClientRect().width ?? 700;
      const factor = (a.align ?? "center") === "center" ? 2 : 1;
      let cur = startW;
      const move = (ev: MouseEvent) => {
        const d = (ev.clientX - startX) * (side === "left" ? -1 : 1) * factor;
        cur = Math.round(Math.max(80, Math.min(max, startW + d)));
        setW(cur);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        updateAttributes({ width: cur >= max - 2 ? null : cur });
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    return (
      <NodeViewWrapper className={`n-media n-image align-${a.align ?? "center"} ${selected ? "is-selected" : ""}`} data-type="image">
        <div ref={wrap} className="n-image-row" contentEditable={false}>
          <div ref={frame} className="n-image-frame" style={{ width: w ? `${w}px` : undefined }} data-drag-handle>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.src} alt={a.caption || ""} draggable={false} className={a.uploading ? "is-uploading" : ""} onDoubleClick={() => setFull(true)} />
            {a.uploading && <span className="n-uploading">Uploading…</span>}
            {editable && (
              <>
                <span className="n-resize is-left" onMouseDown={startResize("left")} />
                <span className="n-resize is-right" onMouseDown={startResize("right")} />
              </>
            )}
            {toolbar}
          </div>
        </div>
        {captionEl}
        {moreMenu}
        {full && (
          <div className="n-lightbox" onClick={() => setFull(false)} contentEditable={false}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.src} alt={a.caption || ""} />
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  // ---------- Bookmark
  if (type === "bookmark") {
    const host = hostOf(a.src);
    return (
      <NodeViewWrapper className={`n-media ${selected ? "is-selected" : ""}`} data-type="bookmark">
        <div className="n-bookmark-row" contentEditable={false}>
          <a href={a.src} target="_blank" rel="noopener noreferrer" className="n-bookmark" data-drag-handle>
            <span className="n-bookmark-text">
              <span className="n-bookmark-title">{a.title || host || a.src}</span>
              {a.description && <span className="n-bookmark-desc">{a.description}</span>}
              <span className="n-bookmark-url">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.icon || `https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" onError={(e) => ((e.target as HTMLElement).style.display = "none")} />
                {a.src}
              </span>
            </span>
            {a.image && (
              <span className="n-bookmark-img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.image} alt="" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = "none")} />
              </span>
            )}
          </a>
          {toolbar}
        </div>
        {moreMenu}
      </NodeViewWrapper>
    );
  }

  // ---------- File
  if (type === "file") {
    return (
      <NodeViewWrapper className={`n-media ${selected ? "is-selected" : ""}`} data-type="file">
        <div className="n-file-row" contentEditable={false}>
          <a href={a.src} target="_blank" rel="noopener noreferrer" className="n-file" data-drag-handle>
            <span>📎</span>
            <span className="truncate">{a.name || decodeURIComponent(a.src.split("/").pop() ?? "File")}</span>
            {a.size ? <span className="n-file-size">{formatSize(a.size)}</span> : null}
            {a.uploading && <span className="n-file-size">Uploading…</span>}
          </a>
          {toolbar}
        </div>
        {captionEl}
        {moreMenu}
      </NodeViewWrapper>
    );
  }

  // ---------- Video / audio / PDF / embed
  let body: React.ReactNode;
  if (type === "audio") body = <audio controls src={a.src} className="w-full" />;
  else if (type === "video") {
    const em = embedUrl(a.src);
    body = em && !isVideoFile(a.src) ? <iframe src={em} className="n-embed-frame aspect-video" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" /> : <video controls src={a.src} className="w-full rounded" />;
  } else if (type === "pdf") body = <iframe src={a.src} className="n-embed-frame" style={{ height: a.height ?? 640 }} title={a.caption || "PDF"} />;
  else {
    const em = embedUrl(a.src) ?? a.src;
    body = (
      <>
        <iframe src={em} className="n-embed-frame" style={{ height: a.height ?? 420 }} sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" allowFullScreen />
        <a href={a.src} target="_blank" rel="noopener noreferrer" className="n-embed-open">
          {hostOf(a.src)} ↗
        </a>
      </>
    );
  }
  return (
    <NodeViewWrapper className={`n-media ${selected ? "is-selected" : ""}`} data-type={type}>
      <div className="n-embed" contentEditable={false} data-drag-handle>
        {body}
        {a.uploading && <span className="n-uploading">Uploading…</span>}
        {toolbar}
      </div>
      {captionEl}
      {moreMenu}
    </NodeViewWrapper>
  );
}

/** "Upload" / "Embed link" tabs of an empty media block. */
export function MediaPicker({
  type,
  rect,
  onClose,
  onDone,
  upload,
}: {
  type: MediaType;
  rect: DOMRect;
  onClose: () => void;
  onDone: (v: { src: string; name?: string; size?: number; title?: null } | null) => void;
  upload: ((f: File) => Promise<{ url: string; name: string; size: number } | null>) | null;
}) {
  const linkOnly = type === "bookmark" || type === "embed";
  const [tab, setTab] = useState<"upload" | "link">(linkOnly || !upload ? "link" : "upload");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const label = MEDIA_LABEL[type];
  return (
    <Popover rect={rect} onClose={onClose} width={Math.min(480, Math.max(320, rect.width))} className="n-menu">
      <div className="n-emoji-tabs">
        {!linkOnly && upload && (
          <button type="button" className={tab === "upload" ? "is-on" : ""} onClick={() => setTab("upload")}>
            Upload
          </button>
        )}
        <button type="button" className={tab === "link" ? "is-on" : ""} onClick={() => setTab("link")}>
          {linkOnly ? (type === "bookmark" ? "Bookmark" : "Embed") : "Embed link"}
        </button>
      </div>
      {tab === "upload" && upload ? (
        <div className="space-y-2 p-3">
          <button type="button" className="n-btn w-full" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : `Upload file`}
          </button>
          <p className="text-center text-xs text-faint">The maximum size per file is 50 MB.</p>
          {err && <p className="text-xs text-danger">{err}</p>}
          <input
            ref={input}
            type="file"
            hidden
            accept={ACCEPT[type]}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 50 * 1024 * 1024) return setErr("That file is larger than 50 MB.");
              setBusy(true);
              const r = await upload(f).catch(() => null);
              setBusy(false);
              if (!r) return setErr("Couldn't upload the file. Try again.");
              onDone({ src: r.url, name: r.name, size: r.size });
            }}
          />
        </div>
      ) : (
        <form
          className="space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const u = url.trim();
            if (!/^https?:\/\/\S+$/i.test(u)) return setErr("Paste a full link (https://…).");
            onDone({ src: u, title: null });
          }}
        >
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={label.link} className="n-input w-full" />
          {err && <p className="text-xs text-danger">{err}</p>}
          <button className="n-btn n-btn-primary w-full">{type === "bookmark" ? "Create bookmark" : type === "image" ? "Embed image" : "Embed link"}</button>
        </form>
      )}
    </Popover>
  );
}
