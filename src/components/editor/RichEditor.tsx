"use client";

import "katex/dist/katex.min.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import DragHandle from "@tiptap/extension-drag-handle-react";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MdDetails, MdDetailsContent, MdDetailsSummary } from "@/lib/editor/details";
import { BlockAttrs, NHeading, NParagraph, TextColor } from "@/lib/editor/nodes/text";
import { Callout } from "@/lib/editor/nodes/callout";
import { Column, ColumnList } from "@/lib/editor/nodes/columns";
import { ColumnsDrop } from "@/lib/editor/columns-drop";
import { TableOfContents, scrollToPos } from "@/lib/editor/nodes/toc";
import { BlockMath, InlineMath } from "@/lib/editor/nodes/math";
import { Breadcrumb, LinkMention, MentionDate, MentionPage, PageLink, dateLabel, parseDateQuery, refreshPageTitles } from "@/lib/editor/nodes/page";
import { NotionButton } from "@/lib/editor/nodes/button";
import { AudioBlock, BookmarkBlock, EmbedBlock, FileBlock, ImageBlock, PdfBlock, VideoBlock } from "@/lib/editor/nodes/media";
import { NotionContext, setPages, type PageRef } from "@/lib/editor/context";
import { NotionKeymap } from "@/lib/editor/keymap";
import { NotionPaste, insertFiles } from "@/lib/editor/paste";
import { SuggestMenus, type SuggestState } from "@/lib/editor/slash";
import { filterBlocks, rememberBlock, TURN_INTO, createSubpageBlock, type BlockItem } from "@/lib/editor/blocks";
import { searchEmoji } from "@/lib/editor/emoji";
import { currentBlock, setBlockColor, turnInto } from "@/lib/editor/transform";
import { isUiEvent, type UiRequest } from "@/lib/editor/ui-events";
import BlockMenu, { blockTypeLabel } from "@/components/editor/BlockMenu";
import ColorMenu from "@/components/editor/ColorMenu";
import EmojiPicker from "@/components/editor/EmojiPicker";
import MediaView from "@/components/editor/MediaView";
import CodeBlockView from "@/components/editor/CodeBlockView";
import { PageIcon } from "@/components/editor/PagePicker";
import { DatePopover, LinkPopover, MathPopover, PasteUrlMenu } from "@/components/editor/Popovers";
import { MenuItem, MenuLabel, Popover, Swatch } from "@/components/editor/ui";
import { uploadNoteFile } from "@/lib/note-files";

const lowlight = createLowlight(common);

export type RichEditorProps = {
  /** Markdown */
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  editable?: boolean;
  /** The note being edited (sub-pages, "Copy link to block", breadcrumb). */
  noteId?: string | null;
  /** All notes, for @ mentions, page links and Move to. */
  pages?: PageRef[];
  createSubpage?: (title: string) => Promise<PageRef | null>;
  upload?: (file: File) => Promise<{ url: string; name: string; size: number } | null>;
  moveBlockTo?: (noteId: string, markdown: string) => Promise<boolean>;
  navigate?: (href: string) => void;
  onReady?: (editor: Editor | null) => void;
};

type Rect = { left: number; top: number; bottom: number; right?: number };
const toRect = (r: DOMRect | { left: number; top: number; bottom: number; right?: number }): Rect => ({ left: r.left, top: r.top, bottom: r.bottom, right: r.right });

type Entry = { key: string; group?: string; icon: React.ReactNode; label: string; hint?: string; shortcut?: string; run: () => void };

/**
 * Note editor that works like a Notion page, saved as Markdown (Notion's own Markdown dialect for
 * callouts, columns, colors, mentions…). "/" for blocks · "@" mentions and dates · "[[" page links ·
 * ":" emoji · select text for the format bar · ⋮⋮ to drag or open a block's menu · + adds a block.
 */
export default function RichEditor({
  value,
  onChange,
  onBlur,
  placeholder = "Write, or press '/' for commands…",
  minHeight = 96,
  className = "",
  editable = true,
  noteId = null,
  pages,
  createSubpage,
  upload,
  moveBlockTo,
  navigate,
  onReady,
}: RichEditorProps) {
  const lastMd = useRef(value);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [sIndex, setSIndex] = useState(0);
  const entriesRef = useRef<Entry[]>([]);
  const sIndexRef = useRef(0);
  sIndexRef.current = sIndex;

  const hovered = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const [blockMenu, setBlockMenu] = useState<{ pos: number; rect: Rect; startIn?: "turn" | "move" } | null>(null);
  const [ui, setUi] = useState<UiRequest | null>(null);
  const [linkRect, setLinkRect] = useState<Rect | null>(null);
  const [fmt, setFmt] = useState<{ which: "turn" | "color"; rect: Rect } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 2600);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        paragraph: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        dropcursor: { color: "rgba(35, 131, 226, 0.6)", width: 3 },
      }),
      NParagraph,
      NHeading,
      BlockAttrs,
      TextColor,
      Blockquote.extend({ addInputRules: () => [] }),
      CodeBlockLowlight.extend({ addNodeView: () => ReactNodeViewRenderer(CodeBlockView) }).configure({ lowlight, defaultLanguage: "plaintext" }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      TableKit.configure({ table: { resizable: false } }),
      MdDetails.configure({ persist: true, HTMLAttributes: { class: "rich-details" } }),
      MdDetailsSummary,
      MdDetailsContent,
      Callout,
      ColumnList,
      Column,
      ColumnsDrop,
      TableOfContents,
      InlineMath,
      BlockMath,
      PageLink,
      MentionPage,
      MentionDate,
      LinkMention,
      Breadcrumb,
      NotionButton,
      ...[ImageBlock, VideoBlock, AudioBlock, FileBlock, PdfBlock, EmbedBlock, BookmarkBlock].map((n) => n.extend({ addNodeView: () => ReactNodeViewRenderer(MediaView) })),
      CharacterCount,
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node, editor: e, pos }) => {
          const parent = pos > 0 ? e.state.doc.resolve(pos).parent : null;
          if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
          if (node.type.name === "detailsSummary") {
            const lvl = parent?.attrs.heading as number | undefined;
            return lvl ? `Toggle heading ${lvl}` : "Toggle";
          }
          if (parent?.type.name === "taskItem") return "To-do";
          if (parent?.type.name === "listItem") return "List";
          if (parent?.type.name === "blockquote") return "Empty quote";
          if (parent?.type.name === "callout") return "Type something…";
          if (parent?.type.name === "detailsContent") return "Empty toggle. Click or drop blocks inside.";
          return placeholder;
        },
      }),
      NotionContext,
      NotionKeymap,
      NotionPaste,
      SuggestMenus.configure({
        onChange: (s) => {
          setSuggest(s);
          if (!s) setSIndex(0);
        },
        onKeyDown: (event) => {
          const list = entriesRef.current;
          if (!list.length) return false;
          const i = sIndexRef.current;
          if (event.key === "ArrowDown") {
            setSIndex((i + 1) % list.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            setSIndex((i - 1 + list.length) % list.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            list[Math.min(i, list.length - 1)]?.run();
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
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        const a = (event.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
        if (a && (event.ctrlKey || event.metaKey || !editable)) {
          window.open(a.href, "_blank", "noopener");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown();
      if (md === lastMd.current) return;
      lastMd.current = md;
      onChangeRef.current(md);
    },
    onBlur: () => onBlurRef.current?.(),
  });

  // Hand the app's context to the editor (notes, sub-pages, uploads…)
  useEffect(() => {
    if (!editor) return;
    const s = editor.storage.notion;
    s.noteId = noteId;
    s.createSubpage = createSubpage ?? null;
    s.upload = upload ?? uploadNoteFile;
    s.moveBlockTo = moveBlockTo ?? null;
    if (navigate) s.navigate = navigate;
  }, [editor, noteId, createSubpage, upload, moveBlockTo, navigate]);

  useEffect(() => {
    if (!editor || !pages) return;
    setPages(editor.storage.notion, pages);
    refreshPageTitles(editor);
  }, [editor, pages]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onReady?.(editor ?? null);
    return () => onReady?.(null);
  }, [editor, onReady]);

  useEffect(() => {
    if (editor) editor.storage.notion.menuOpen = !!suggest;
  }, [editor, suggest]);

  // New content from outside (another device, another block) while you are not writing
  useEffect(() => {
    if (!editor || editor.isFocused || value === lastMd.current) return;
    lastMd.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  // Link to a block (#b-xxxx): scroll there and flash it
  useEffect(() => {
    if (!editor) return;
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id.startsWith("b-")) return;
      let found = -1;
      editor.state.doc.descendants((n, p) => {
        if (found >= 0) return false;
        if (n.attrs?.blockId === id.slice(2)) found = p;
        return true;
      });
      if (found >= 0) setTimeout(() => scrollToPos(editor, found), 150);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [editor]);

  // Node views ask for menus through "n-ui" events
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !editor) return;
    const on = (e: Event) => {
      if (!isUiEvent(e)) return;
      const req = e.detail;
      if (req.kind === "toast") return showToast(req.text);
      if (req.kind === "link") {
        const { from } = editor.state.selection;
        const c = editor.view.coordsAtPos(from);
        setLinkRect({ left: c.left, top: c.top, bottom: c.bottom });
        return;
      }
      if (req.kind === "blockMenu") {
        setBlockMenu({ pos: req.pos, rect: toRect(req.rect) });
        return;
      }
      setUi(req);
    };
    el.addEventListener("n-ui", on);
    return () => el.removeEventListener("n-ui", on);
  }, [editor, showToast]);

  const fmtState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            link: e.isActive("link"),
            table: e.isActive("table"),
            color: (e.getAttributes("textColor").color as string | undefined) ?? (e.isActive("highlight") ? "yellow_bg" : null),
            block: (() => {
              const b = currentBlock(e);
              return b ? blockTypeLabel(b.node) : "Text";
            })(),
            words: e.storage.characterCount?.words?.() ?? 0,
          }
        : null,
  });

  // ----- Typing menus ("/", "@", "[[", ":")
  const entries: Entry[] = useMemo(() => {
    if (!editor || !suggest) return [];
    const { kind, query, range } = suggest;
    const s = editor.storage.notion;
    if (kind === "slash") {
      const items = filterBlocks(query, {
        openTurnInto: () => {
          const b = currentBlock(editor);
          if (b) setBlockMenu({ pos: b.pos, rect: toRect((editor.view.nodeDOM(b.pos) as HTMLElement).getBoundingClientRect()), startIn: "turn" });
        },
        openMoveTo: () => {
          const b = currentBlock(editor);
          if (b) setBlockMenu({ pos: b.pos, rect: toRect((editor.view.nodeDOM(b.pos) as HTMLElement).getBoundingClientRect()), startIn: "move" });
        },
      }, { canCreatePage: !!s.createSubpage });
      return items.slice(0, 60).map((i: BlockItem) => ({
        key: `${i.group}-${i.key}`,
        group: i.group,
        icon: i.swatch ? <Swatch color={i.swatch.color} bg={i.swatch.bg} /> : <span className="n-type-icon">{i.icon}</span>,
        label: i.label,
        hint: i.hint,
        shortcut: i.shortcut,
        run: () => {
          rememberBlock(i.key);
          i.run(editor, range);
        },
      }));
    }
    const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const q = fold(query.trim());
    const pageList = [...s.pages.values()].filter((p) => p.id !== s.noteId);
    const matches = pageList.filter((p) => !q || fold(p.title || "Untitled").includes(q)).slice(0, q ? 10 : 6);
    const insertMention = (p: PageRef) => editor.chain().focus().deleteRange(range).insertContent([{ type: "mentionPage", attrs: { url: `/notes/${p.id}`, title: p.title } }, { type: "text", text: " " }]).run();
    const newSub = (): Entry[] =>
      s.createSubpage && query.trim()
        ? [
            {
              key: "new-sub",
              group: "New",
              icon: "＋",
              label: `Add new sub-page “${query.trim()}”`,
              run: async () => {
                editor.chain().focus().deleteRange(range).run();
                const p = await s.createSubpage!(query.trim());
                if (p) editor.chain().focus().insertContent([{ type: "mentionPage", attrs: { url: `/notes/${p.id}`, title: p.title } }, { type: "text", text: " " }]).run();
              },
            } as Entry,
          ]
        : [];
    if (kind === "mention") {
      const out: Entry[] = [];
      const date = parseDateQuery(query);
      const dates = date ? [date] : !q ? [parseDateQuery("today")!, parseDateQuery("tomorrow")!] : [];
      for (const d of dates)
        out.push({
          key: `date-${d}`,
          group: "Date",
          icon: "📅",
          label: dateLabel(d),
          hint: d,
          run: () => editor.chain().focus().deleteRange(range).insertContent([{ type: "mentionDate", attrs: { start: d } }, { type: "text", text: " " }]).run(),
        });
      for (const p of matches) out.push({ key: p.id, group: q ? "Link to page" : "Recent pages", icon: <PageIcon icon={p.icon} />, label: p.title || "Untitled", run: () => insertMention(p) });
      return [...out, ...newSub()];
    }
    if (kind === "link") {
      return [
        ...matches.map((p) => ({ key: p.id, group: "Link to page", icon: <PageIcon icon={p.icon} />, label: p.title || "Untitled", run: () => insertMention(p) })),
        ...newSub(),
      ];
    }
    return searchEmoji(query, 8).map((em) => ({
      key: em.char,
      group: "Emoji",
      icon: <span className="text-lg">{em.char}</span>,
      label: `:${em.name.replace(/\s+/g, "_")}`,
      run: () => editor.chain().focus().deleteRange(range).insertContent(em.char).run(),
    }));
  }, [editor, suggest]);
  // Arrow keys / Enter follow the grouped order on screen
  const ordered = useMemo(() => {
    const names: string[] = [];
    for (const e of entries) if (!names.includes(e.group ?? "")) names.push(e.group ?? "");
    return names.flatMap((n) => entries.filter((e) => (e.group ?? "") === n));
  }, [entries]);
  entriesRef.current = ordered;

  useEffect(() => {
    if (sIndex >= entries.length) setSIndex(0);
  }, [entries.length, sIndex]);

  if (!editor) {
    return <div className={`rich-prose text-faint ${className}`} style={{ minHeight }}>Loading…</div>;
  }

  // ----- ⋮⋮ and +
  function openBlockMenu(e: React.MouseEvent) {
    if (!editor) return;
    const { node, pos } = hovered.current;
    if (!node || pos < 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    try {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    } catch {}
    setBlockMenu({ pos, rect: { left: r.left, top: r.top, bottom: r.bottom, right: r.right } });
  }

  function addBlock(e: React.MouseEvent) {
    if (!editor) return;
    const { node, pos } = hovered.current;
    if (!node || pos < 0) return;
    const above = e.altKey;
    // An empty text line: just open "/" there
    if (node.isTextblock && node.content.size === 0) {
      editor.chain().focus(pos + 1).insertContent("/").run();
      return;
    }
    const at = above ? pos : pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, at + 2));
        return true;
      })
      .focus()
      .run();
  }

  /** Where the bar of the table being edited goes (just above it). */
  function tableBox(): { top: number; left: number } | null {
    if (!editor || !wrapRef.current) return null;
    try {
      const at = editor.view.domAtPos(editor.state.selection.from).node as Node;
      const el = (at.nodeType === 1 ? (at as HTMLElement) : at.parentElement)?.closest(".tableWrapper, table") as HTMLElement | null;
      if (!el) return null;
      const a = el.getBoundingClientRect();
      const w = wrapRef.current.getBoundingClientRect();
      return { top: a.top - w.top - 28, left: a.left - w.left };
    } catch {
      return null;
    }
  }

  const markBtn = (active: boolean | undefined) => `n-fmt-btn ${active ? "is-on" : ""}`;
  const fmtRect = (e: React.MouseEvent): Rect => toRect((e.currentTarget as HTMLElement).getBoundingClientRect());

  // Group the entries (first-seen order); the keyboard index follows the drawn order
  const groups: { name: string; items: { e: Entry; i: number }[] }[] = [];
  for (const e of entries) {
    const g = e.group ?? "";
    const found = groups.find((x) => x.name === g);
    if (found) found.items.push({ e, i: -1 });
    else groups.push({ name: g, items: [{ e, i: -1 }] });
  }
  let drawn = 0;
  for (const g of groups) for (const it of g.items) it.i = drawn++;

  return (
    <div ref={wrapRef} className={`rich-editor relative ${className}`}>
      {editable && (
        <DragHandle
          editor={editor}
          nested
          onNodeChange={({ node, pos }) => (hovered.current = { node, pos })}
        >
          <div className="rich-handle flex items-center">
            <button type="button" tabIndex={-1} onClick={addBlock} title="Click to add below · Alt-click to add a block above" className="rich-handle-btn">
              +
            </button>
            <button type="button" tabIndex={-1} onClick={openBlockMenu} title="Drag to move · Click to open menu" className="rich-handle-btn cursor-grab">
              ⋮⋮
            </button>
          </div>
        </DragHandle>
      )}

      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: e, from, to, state }) => from !== to && e.isEditable && !e.isActive("codeBlock") && !(state.selection instanceof NodeSelection)}
        className="n-fmt"
        options={{ placement: "top-start", offset: 8 }}
      >
        <button type="button" className="n-fmt-btn n-fmt-turn" onClick={(e) => setFmt({ which: "turn", rect: fmtRect(e) })}>
          {fmtState?.block ?? "Text"} <span className="opacity-60">▾</span>
        </button>
        <span className="n-fmt-sep" />
        <button type="button" title="Link (Ctrl+K)" className={markBtn(fmtState?.link)} onClick={(e) => setLinkRect(fmtRect(e))}>
          🔗 <span className="text-[13px]">Link</span>
        </button>
        <span className="n-fmt-sep" />
        <button type="button" title="Bold (Ctrl+B)" onClick={() => editor.chain().focus().toggleBold().run()} className={`${markBtn(fmtState?.bold)} font-bold`}>B</button>
        <button type="button" title="Italic (Ctrl+I)" onClick={() => editor.chain().focus().toggleItalic().run()} className={`${markBtn(fmtState?.italic)} font-serif italic`}>i</button>
        <button type="button" title="Underline (Ctrl+U)" onClick={() => editor.chain().focus().toggleUnderline().run()} className={`${markBtn(fmtState?.underline)} underline`}>U</button>
        <button type="button" title="Strike-through (Ctrl+Shift+S)" onClick={() => editor.chain().focus().toggleStrike().run()} className={`${markBtn(fmtState?.strike)} line-through`}>S</button>
        <button type="button" title="Mark as code (Ctrl+E)" onClick={() => editor.chain().focus().toggleCode().run()} className={`${markBtn(fmtState?.code)} font-mono text-xs`}>{"<>"}</button>
        <button
          type="button"
          title="Create equation (Ctrl+Shift+E)"
          onClick={() => {
            const { from, to } = editor.state.selection;
            const text = editor.state.doc.textBetween(from, to, " ");
            editor.chain().focus().deleteSelection().insertInlineMath(text).run();
          }}
          className="n-fmt-btn text-[13px]"
        >
          √x
        </button>
        <span className="n-fmt-sep" />
        <button type="button" title="Text color" className="n-fmt-btn" onClick={(e) => setFmt({ which: "color", rect: fmtRect(e) })}>
          <span className={`n-color-a ${fmtState?.color ? "" : ""}`} data-color={fmtState?.color ?? undefined}>A</span> <span className="opacity-60">▾</span>
        </button>
      </BubbleMenu>

      {fmt?.which === "turn" && (
        <Popover rect={fmt.rect} onClose={() => setFmt(null)} width={240} className="n-menu">
          <div className="max-h-[400px] overflow-y-auto p-1">
            <MenuLabel>Turn into</MenuLabel>
            {TURN_INTO.map((i) => (
              <MenuItem
                key={i.key}
                icon={<span className="n-type-icon">{i.icon}</span>}
                label={i.label}
                onClick={() => {
                  const b = currentBlock(editor);
                  if (b) turnInto(editor, b.pos, i.kind!);
                  setFmt(null);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
      {fmt?.which === "color" && (
        <Popover rect={fmt.rect} onClose={() => setFmt(null)} width={230} className="n-menu">
          <ColorMenu
            current={fmtState?.color ?? null}
            last={editor.storage.notion.lastColor}
            onPick={(c) => {
              const chain = editor.chain().focus().unsetHighlight();
              if (c) chain.setTextColor(c).run();
              else chain.unsetTextColor().run();
              editor.storage.notion.lastColor = c;
              setFmt(null);
            }}
          />
        </Popover>
      )}
      {linkRect && <LinkPopover editor={editor} rect={linkRect} onClose={() => setLinkRect(null)} />}

      {fmtState?.table && editable && editor.isFocused && tableBox() && (
        <div className="n-table-tools" contentEditable={false} style={{ position: "absolute", zIndex: 5, ...tableBox()! }}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>− Row</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>− Column</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className="text-danger" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button>
        </div>
      )}

      <EditorContent editor={editor} />

      {suggest && suggest.rect && (entries.length > 0 || (suggest.kind === "slash" && !/\s/.test(suggest.query))) && (
        <div
          role="listbox"
          aria-label="Suggestions"
          className={`n-pop n-menu fixed z-[80] overflow-y-auto p-1 ${suggest.kind === "slash" ? "w-[324px]" : "w-[300px]"}`}
          style={{
            maxHeight: 360,
            left: Math.max(8, Math.min(suggest.rect.left, window.innerWidth - 332)),
            top: suggest.rect.bottom + 370 > window.innerHeight ? Math.max(8, suggest.rect.top - 376) : suggest.rect.bottom + 6,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {entries.length === 0 && <p className="px-2 py-1.5 text-sm text-faint">No results</p>}
          {groups.map((g) => (
            <div key={g.name}>
              {g.name && <MenuLabel>{g.name}</MenuLabel>}
              {g.items.map(({ e, i }) => (
                <MenuItem
                  key={e.key}
                  icon={e.icon}
                  big={suggest.kind === "slash" && !!e.hint && !e.group?.includes("color")}
                  label={e.label}
                  hint={e.hint}
                  shortcut={e.shortcut}
                  active={i === sIndex}
                  onHover={() => setSIndex(i)}
                  onClick={() => e.run()}
                />
              ))}
            </div>
          ))}
          {suggest.kind === "slash" && <div className="n-menu-footer">Type “/” on the page · esc to close</div>}
        </div>
      )}

      {blockMenu && (
        <BlockMenu
          editor={editor}
          pos={blockMenu.pos}
          rect={blockMenu.rect}
          startIn={blockMenu.startIn}
          onToast={showToast}
          onClose={() => {
            setBlockMenu(null);
            editor.commands.focus();
          }}
        />
      )}

      {ui?.kind === "emoji" && (
        <Popover rect={toRect(ui.rect)} onClose={() => setUi(null)} width={352} className="n-menu">
          <EmojiPicker
            onPick={(e) => {
              ui.onPick(e);
              setUi(null);
            }}
            onRemove={ui.allowRemove ? () => (ui.onPick(null), setUi(null)) : undefined}
          />
        </Popover>
      )}
      {ui?.kind === "math" && <MathPopover rect={toRect(ui.rect)} latex={ui.latex} block={ui.block} onSave={ui.onSave} onRemove={ui.onRemove} onClose={() => setUi(null)} />}
      {ui?.kind === "date" && <DatePopover rect={toRect(ui.rect)} start={ui.start} end={ui.end} time={ui.time} onSave={ui.onSave} onClose={() => setUi(null)} />}
      {ui?.kind === "color" && (
        <Popover rect={toRect(ui.rect)} onClose={() => setUi(null)} width={230} className="n-menu">
          <ColorMenu current={ui.current} last={editor.storage.notion.lastColor} onPick={(c) => (ui.onPick(c), setUi(null))} />
        </Popover>
      )}
      {ui?.kind === "pasteUrl" && <PasteUrlMenu editor={editor} url={ui.url} from={ui.from} to={ui.to} rect={toRect(ui.rect)} onClose={() => setUi(null)} />}

      {editable && <MobileToolbar editor={editor} onBlockMenu={(pos, rect) => setBlockMenu({ pos, rect })} onColor={(rect) => {
        const b = currentBlock(editor);
        if (b) setUi({ kind: "color", rect: new DOMRect(rect.left, rect.top, 0, rect.bottom - rect.top), current: null, onPick: (c) => setBlockColor(editor, b.pos, c) });
      }} />}

      {toast && <div className="n-toast" role="status">{toast}</div>}
    </div>
  );
}

/** Phone: a bar above the keyboard with Notion's mobile tools (no hover, no "/" needed). */
function MobileToolbar({ editor, onBlockMenu, onColor }: { editor: Editor; onBlockMenu: (pos: number, rect: Rect) => void; onColor: (rect: Rect) => void }) {
  const [focused, setFocused] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [bottom, setBottom] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const f = () => setFocused(true);
    const b = () => setTimeout(() => setFocused(editor.isFocused), 150);
    editor.on("focus", f);
    editor.on("blur", b);
    const vv = window.visualViewport;
    const place = () => vv && setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      editor.off("focus", f);
      editor.off("blur", b);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [editor]);
  if (!coarse || !focused) return null;
  const keep = (e: React.MouseEvent | React.TouchEvent) => e.preventDefault();
  const rectOf = (e: React.MouseEvent): Rect => toRect((e.currentTarget as HTMLElement).getBoundingClientRect());
  return (
    <div className="n-mobile-bar" style={{ bottom }} onMouseDown={keep}>
      <button type="button" onClick={() => editor.chain().focus().insertContent("/").run()}>＋</button>
      <button
        type="button"
        onClick={(e) => {
          const b = currentBlock(editor);
          if (b) onBlockMenu(b.pos, rectOf(e));
        }}
      >
        Aa
      </button>
      <button type="button" onClick={() => editor.chain().focus().insertContent("@").run()}>@</button>
      <button type="button" onClick={() => file.current?.click()}>🖼</button>
      <button type="button" onClick={() => editor.chain().focus().sinkListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run()}>⇥</button>
      <button type="button" onClick={() => editor.chain().focus().liftListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run()}>⇤</button>
      <button type="button" onClick={(e) => onColor(rectOf(e))}>
        <span className="n-color-a">A</span>
      </button>
      <button
        type="button"
        onClick={() => {
          const b = currentBlock(editor);
          if (b) turnInto(editor, b.pos, editor.isActive("taskItem") ? "text" : "todo");
        }}
      >
        ☑
      </button>
      <button type="button" onClick={() => editor.chain().focus().undo().run()}>↶</button>
      <button type="button" onClick={() => editor.chain().focus().redo().run()}>↷</button>
      <button type="button" onClick={() => editor.commands.blur()}>⌄</button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = Array.from(e.target.files ?? []);
          if (f.length) insertFiles(editor, f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export type { Editor };
// used by the page header
export { createSubpageBlock };
