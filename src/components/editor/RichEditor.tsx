"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import DragHandle from "@tiptap/extension-drag-handle-react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MdDetails, MdDetailsContent, MdDetailsSummary } from "@/lib/editor/details";
import { SlashCommand, type SlashOpen } from "@/lib/editor/slash";
import { BLOCK_ITEMS, type BlockItem } from "@/lib/editor/blocks";

/**
 * Note editor in the style of Notion, saved as Markdown:
 * "/" opens the block list · select text for the format bar · ⋮⋮ beside each block to drag it
 * or open its menu (turn into, duplicate, delete) · + adds a block below.
 * Markdown shortcuts work too: "# ", "- ", "1. ", "[] ", "> ", "```", "---".
 */
export default function RichEditor({
  value,
  onChange,
  onBlur,
  placeholder = "Write, or type “/” for blocks…",
  minHeight = 96,
  className = "",
}: {
  /** Markdown */
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}) {
  const lastMd = useRef(value);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  // "/" menu state (the extension calls these refs)
  const [slash, setSlash] = useState<SlashOpen | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<{ open: SlashOpen | null; index: number }>({ open: null, index: 0 });
  slashRef.current = { open: slash, index: slashIndex };

  // ⋮⋮ menu
  const hovered = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; node: PMNode; pos: number } | null>(null);

  // Link field in the format bar
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      TableKit.configure({ table: { resizable: false } }),
      MdDetails.configure({ persist: false, HTMLAttributes: { class: "rich-details" } }),
      MdDetailsSummary,
      MdDetailsContent,
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? `Heading ${node.attrs.level}`
            : node.type.name === "detailsSummary"
              ? "Toggle title"
              : placeholder,
      }),
      SlashCommand.configure({
        onChange: (s) => {
          setSlash(s);
          if (!s || !slashRef.current.open) setSlashIndex(0);
        },
        onKeyDown: (event) => {
          const { open, index } = slashRef.current;
          if (!open || !open.items.length) return false;
          if (event.key === "ArrowDown") {
            setSlashIndex((index + 1) % open.items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            setSlashIndex((index - 1 + open.items.length) % open.items.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            open.pick(open.items[Math.min(index, open.items.length - 1)]);
            return true;
          }
          return false;
        },
      }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "rich-prose focus:outline-none", style: `min-height:${minHeight}px` },
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      if (md === lastMd.current) return;
      lastMd.current = md;
      onChangeRef.current(md);
    },
    onBlur: () => onBlurRef.current?.(),
  });

  // New content from outside (another device, another block) while you are not writing
  useEffect(() => {
    if (!editor || editor.isFocused || value === lastMd.current) return;
    lastMd.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  // Keep the selected "/" item in range when the list shrinks
  useEffect(() => {
    if (slash && slashIndex >= slash.items.length) setSlashIndex(0);
  }, [slash, slashIndex]);

  // Close the ⋮⋮ menu on any click elsewhere
  useEffect(() => {
    if (!blockMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-block-menu]")) setBlockMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setBlockMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [blockMenu]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            highlight: e.isActive("highlight"),
            link: e.isActive("link"),
            table: e.isActive("table"),
          }
        : null,
  });

  if (!editor) {
    return <div className={`rich-prose text-faint ${className}`} style={{ minHeight }}>Loading…</div>;
  }

  function openBlockMenu(e: React.MouseEvent) {
    const { node, pos } = hovered.current;
    if (!node || pos < 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setBlockMenu({ x: r.left, y: r.bottom + 4, node, pos });
  }

  function addBelow() {
    const { node, pos } = hovered.current;
    if (!editor || !node || pos < 0) return;
    const at = pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .focus(at + 2)
      .run();
  }

  function turnInto(item: BlockItem) {
    if (!editor || !blockMenu) return;
    editor.chain().focus().setTextSelection(blockMenu.pos + 1).run();
    item.run(editor);
    setBlockMenu(null);
  }

  function duplicate() {
    if (!editor || !blockMenu) return;
    editor.chain().focus().insertContentAt(blockMenu.pos + blockMenu.node.nodeSize, blockMenu.node.toJSON()).run();
    setBlockMenu(null);
  }

  function remove() {
    if (!editor || !blockMenu) return;
    editor.chain().focus().deleteRange({ from: blockMenu.pos, to: blockMenu.pos + blockMenu.node.nodeSize }).run();
    setBlockMenu(null);
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

  const markBtn = (active: boolean | undefined) =>
    `grid h-7 min-w-7 place-items-center rounded px-1.5 text-sm transition-colors ${active ? "bg-accent-soft text-accent" : "hover:bg-subtle"}`;

  return (
    <div className={`rich-editor relative ${className}`}>
      <DragHandle editor={editor} onNodeChange={({ node, pos }) => (hovered.current = { node, pos })}>
        <div className="rich-handle flex items-center">
          <button type="button" tabIndex={-1} onClick={addBelow} title="Add a block below" className="rich-handle-btn">
            +
          </button>
          <button type="button" tabIndex={-1} onClick={openBlockMenu} title="Drag to move · click for options" className="rich-handle-btn cursor-grab">
            ⋮⋮
          </button>
        </div>
      </DragHandle>

      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: e, from, to }) => from !== to && !e.isActive("codeBlock")}
        className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-pop"
      >
        {linkOpen ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setLinkOpen(false)}
              placeholder="Paste a link…"
              className="w-52 rounded border border-line-strong bg-surface px-2 py-1 text-sm"
            />
            <button className={markBtn(false)}>OK</button>
          </form>
        ) : (
          <>
            <button type="button" title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()} className={`${markBtn(state?.bold)} font-bold`}>B</button>
            <button type="button" title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()} className={`${markBtn(state?.italic)} italic`}>I</button>
            <button type="button" title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()} className={`${markBtn(state?.underline)} underline`}>U</button>
            <button type="button" title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} className={`${markBtn(state?.strike)} line-through`}>S</button>
            <button type="button" title="Inline code" onClick={() => editor.chain().focus().toggleCode().run()} className={`${markBtn(state?.code)} font-mono text-xs`}>{"</>"}</button>
            <button type="button" title="Highlight" onClick={() => editor.chain().focus().toggleHighlight().run()} className={markBtn(state?.highlight)}>
              <span className="rounded bg-yellow-200 px-1 text-black">A</span>
            </button>
            <button
              type="button"
              title="Link"
              onClick={() => {
                setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
                setLinkOpen(true);
              }}
              className={markBtn(state?.link)}
            >
              🔗
            </button>
          </>
        )}
      </BubbleMenu>

      {state?.table && (
        <div className="mb-1 flex flex-wrap gap-1 text-xs text-muted">
          <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} className="rounded border border-line px-1.5 py-0.5 hover:bg-subtle">+ Row</button>
          <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} className="rounded border border-line px-1.5 py-0.5 hover:bg-subtle">+ Column</button>
          <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} className="rounded border border-line px-1.5 py-0.5 hover:bg-subtle">− Row</button>
          <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()} className="rounded border border-line px-1.5 py-0.5 hover:bg-subtle">− Column</button>
          <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} className="rounded border border-line px-1.5 py-0.5 text-danger hover:bg-subtle">Delete table</button>
        </div>
      )}

      <EditorContent editor={editor} />

      {slash && slash.rect && (
        <div
          role="listbox"
          aria-label="Blocks"
          className="fixed z-[80] max-h-72 w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop"
          style={{
            left: Math.min(slash.rect.left, window.innerWidth - 270),
            top: slash.rect.bottom + 280 > window.innerHeight ? Math.max(8, slash.rect.top - 290) : slash.rect.bottom + 6,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {slash.items.length === 0 && <p className="px-2 py-1.5 text-sm text-faint">No matching block</p>}
          {slash.items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={i === slashIndex}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => slash.pick(item)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${i === slashIndex ? "bg-subtle" : ""}`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-line bg-surface text-xs font-semibold text-muted">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm">{item.label}</span>
                <span className="block truncate text-xs text-faint">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {blockMenu && (
        <div
          data-block-menu
          className="fixed z-[80] w-56 rounded-lg border border-line bg-surface p-1 text-sm shadow-pop"
          style={{ left: Math.min(blockMenu.x, window.innerWidth - 232), top: Math.min(blockMenu.y, window.innerHeight - 380) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Turn into</p>
          {BLOCK_ITEMS.filter((i) => i.turnInto).map((item) => (
            <button key={item.key} type="button" onClick={() => turnInto(item)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-subtle">
              <span className="w-6 text-center text-xs font-semibold text-muted">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button type="button" onClick={duplicate} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-subtle">
            <span className="w-6 text-center">⧉</span>Duplicate
          </button>
          <button type="button" onClick={remove} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-danger hover:bg-subtle">
            <span className="w-6 text-center">🗑</span>Delete
          </button>
        </div>
      )}
    </div>
  );
}

export type { Editor };
