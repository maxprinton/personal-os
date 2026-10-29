"use client";

// Popovers of the editor: equation editor, date picker, link editor, and the "paste a link" menu.
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { loadKatex } from "@/lib/editor/nodes/math";
import { embedUrl, isVideoFile } from "@/lib/editor/nodes/media";
import { MenuItem, MenuLabel, Popover, useListKeys } from "@/components/editor/ui";

type Rect = { left: number; top: number; bottom: number; right?: number };

export function MathPopover({ rect, latex, block, onSave, onRemove, onClose }: { rect: Rect; latex: string; block: boolean; onSave: (l: string) => void; onRemove: () => void; onClose: () => void }) {
  const [v, setV] = useState(latex);
  const [err, setErr] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const vRef = useRef(v);
  vRef.current = v;

  useEffect(() => {
    let alive = true;
    void loadKatex()
      .then((k) => {
        if (!alive || !preview.current) return;
        try {
          k.render(v || "\\text{…}", preview.current, { displayMode: block, throwOnError: true });
          setErr(null);
        } catch (e) {
          setErr(e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : "Invalid equation");
        }
      })
      .catch(() => setErr("The equation library isn't installed yet (INSTALAR-EDITOR-NOTION.cmd)."));
    return () => {
      alive = false;
    };
  }, [v, block]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (!vRef.current.trim() && !block) onRemove();
    else onSave(vRef.current);
    onClose();
  };

  return (
    <Popover rect={rect} onClose={finish} width={block ? 460 : 360} className="n-menu">
      <div className="space-y-2 p-2">
        <textarea
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (!block || e.ctrlKey || e.metaKey) && !e.shiftKey) {
              e.preventDefault();
              finish();
            }
          }}
          rows={block ? 4 : 2}
          spellCheck={false}
          placeholder={block ? "E = mc^2" : "x^2"}
          className="n-input w-full font-mono text-sm"
        />
        <div ref={preview} className={`n-math-preview ${block ? "is-block" : ""}`} />
        {err && <p className="text-xs text-danger">{err}</p>}
        <div className="flex items-center gap-2">
          <a href="https://katex.org/docs/supported.html" target="_blank" rel="noreferrer" className="text-xs text-faint underline">
            Supported TeX
          </a>
          <span className="flex-1" />
          <button type="button" className="n-btn" onClick={() => (onRemove(), onClose())}>
            Delete
          </button>
          <button type="button" className="n-btn n-btn-primary" onClick={finish}>
            Done {block ? "Ctrl+↵" : "↵"}
          </button>
        </div>
      </div>
    </Popover>
  );
}

export function DatePopover({
  rect,
  start,
  end,
  time,
  onSave,
  onClose,
}: {
  rect: Rect;
  start: string;
  end: string | null;
  time: string | null;
  onSave: (v: { start: string; end: string | null; time: string | null } | null) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end ?? "");
  const [t, setT] = useState(time ?? "");
  const [withEnd, setWithEnd] = useState(!!end);
  const [withTime, setWithTime] = useState(!!time);
  const save = () => {
    if (s) onSave({ start: s, end: withEnd && e ? e : null, time: withTime && t ? t : null });
    onClose();
  };
  return (
    <Popover rect={rect} onClose={save} width={260} className="n-menu">
      <div className="space-y-2 p-2 text-sm">
        <input type="date" value={s} onChange={(x) => setS(x.target.value)} className="n-input w-full" />
        {withTime && <input type="time" value={t} onChange={(x) => setT(x.target.value)} className="n-input w-full" />}
        {withEnd && <input type="date" value={e} min={s} onChange={(x) => setE(x.target.value)} className="n-input w-full" />}
        <label className="flex items-center justify-between">
          End date <input type="checkbox" checked={withEnd} onChange={(x) => setWithEnd(x.target.checked)} />
        </label>
        <label className="flex items-center justify-between">
          Include time <input type="checkbox" checked={withTime} onChange={(x) => setWithTime(x.target.checked)} />
        </label>
        <div className="flex gap-2 pt-1">
          <button type="button" className="n-btn" onClick={() => (onSave(null), onClose())}>
            Remove
          </button>
          <span className="flex-1" />
          <button type="button" className="n-btn n-btn-primary" onClick={save}>
            Done
          </button>
        </div>
      </div>
    </Popover>
  );
}

/** Ctrl+K / 🔗: edit the link of the selected text. */
export function LinkPopover({ editor, rect, onClose }: { editor: Editor; rect: Rect; onClose: () => void }) {
  const [url, setUrl] = useState((editor.getAttributes("link").href as string | undefined) ?? "");
  const apply = () => {
    const u = url.trim();
    const { empty } = editor.state.selection;
    if (!u) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      const href = /^(https?:|mailto:|\/)/i.test(u) ? u : `https://${u}`;
      if (empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: u, marks: [{ type: "link", attrs: { href } }] }).run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  };
  return (
    <Popover rect={rect} onClose={onClose} width={340} className="n-menu">
      <form
        className="flex gap-1.5 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste link or search pages…" className="n-input flex-1" />
        <button className="n-btn n-btn-primary">Link</button>
      </form>
      {editor.isActive("link") && (
        <div className="px-1 pb-1">
          <MenuItem icon="🗑" label="Remove link" onClick={() => (editor.chain().focus().extendMarkRange("link").unsetLink().run(), onClose())} />
        </div>
      )}
    </Popover>
  );
}

export type LinkMeta = { title?: string | null; description?: string | null; image?: string | null; icon?: string | null };
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  try {
    const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
    if (!r.ok) return {};
    return (await r.json()) as LinkMeta;
  } catch {
    return {};
  }
}

/** After pasting a link alone (Notion): Dismiss · Mention · Bookmark · Embed. */
export function PasteUrlMenu({ editor, url, from, to, rect, onClose }: { editor: Editor; url: string; from: number; to: number; rect: Rect; onClose: () => void }) {
  const isImage = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(url);
  const canEmbed = !!embedUrl(url) || isVideoFile(url);
  const stillThere = () => editor.state.doc.textBetween(from, Math.min(to, editor.state.doc.content.size)) === url;
  const replaceWithBlock = (node: Record<string, unknown>) => {
    if (!stillThere()) return onClose();
    const $f = editor.state.doc.resolve(from);
    const lineEmpty = $f.parent.textContent === url;
    if (lineEmpty) editor.chain().focus().insertContentAt({ from: $f.before(), to: $f.after() }, node).run();
    else editor.chain().focus().deleteRange({ from, to }).insertContentAt(editor.state.selection.$from.after(), node).run();
  };
  const options = [
    { key: "dismiss", icon: "↩", label: "Dismiss", hint: "Keep it as a link", run: () => onClose() },
    {
      key: "mention",
      icon: "@",
      label: "Mention",
      hint: "Title and icon of the page",
      run: async () => {
        onClose();
        const meta = await fetchLinkMeta(url);
        if (!stillThere()) return;
        editor.chain().focus().insertContentAt({ from, to }, { type: "linkMention", attrs: { url, title: meta.title ?? "", icon: meta.icon ?? null } }).run();
      },
    },
    ...(isImage ? [{ key: "image", icon: "🖼️", label: "Image", hint: "Show the image", run: () => (replaceWithBlock({ type: "image", attrs: { src: url } }), onClose()) }] : []),
    {
      key: "bookmark",
      icon: "🔖",
      label: "Bookmark",
      hint: "Visual card with a preview",
      run: async () => {
        onClose();
        replaceWithBlock({ type: "bookmark", attrs: { src: url } });
      },
    },
    ...(canEmbed || !isImage
      ? [{ key: "embed", icon: "🔗", label: "Embed", hint: canEmbed ? "Play or view it inside the page" : "Show the page inside this one", run: () => (replaceWithBlock({ type: isVideoFile(url) || /youtu|vimeo|loom/.test(url) ? "video" : "embed", attrs: { src: url } }), onClose()) }]
      : []),
  ];
  const [index, setIndex] = useListKeys(options.length, (i) => void options[i].run());
  // Typing goes on writing: the menu just goes away (like Notion)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "Enter", "Escape", "Shift", "Control", "Alt", "Meta"].includes(e.key)) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <Popover rect={rect} onClose={onClose} width={250} className="n-menu">
      <div className="p-1">
        <MenuLabel>Paste as</MenuLabel>
        {options.map((o, i) => (
          <MenuItem key={o.key} icon={o.icon} label={o.label} hint={o.hint} active={i === index} onHover={() => setIndex(i)} onClick={() => void o.run()} />
        ))}
      </div>
    </Popover>
  );
}
