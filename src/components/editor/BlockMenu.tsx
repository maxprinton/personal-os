"use client";

// The ⋮⋮ menu of a block (Notion): search actions, Turn into ▸, Color ▸, Copy link to block,
// Duplicate, Move to, Delete, and the block's word count.
import { useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TURN_INTO, type BlockItem } from "@/lib/editor/blocks";
import { COLOR_ITEMS } from "@/lib/editor/blocks";
import { countWords, deleteBlock, duplicateBlock, newBlockId, setBlockColor, turnInto } from "@/lib/editor/transform";
import { Popover, MenuItem, MenuLabel, Swatch, useListKeys } from "@/components/editor/ui";
import ColorMenu from "@/components/editor/ColorMenu";
import PagePicker from "@/components/editor/PagePicker";

type Rect = { left: number; top: number; bottom: number; right?: number };

/** Label of a block's type, like the header of Notion's menu. */
export function blockTypeLabel(node: PMNode): string {
  switch (node.type.name) {
    case "paragraph":
      return "Text";
    case "heading":
      return `Heading ${node.attrs.level}`;
    case "listItem":
      return "List";
    case "taskItem":
      return "To-do list";
    case "details":
      return node.attrs.heading ? `Toggle heading ${node.attrs.heading}` : "Toggle list";
    case "blockquote":
      return "Quote";
    case "callout":
      return "Callout";
    case "codeBlock":
      return "Code";
    case "columnList":
      return "Columns";
    case "tableOfContents":
      return "Table of contents";
    case "blockMath":
      return "Equation";
    case "pageLink":
      return "Page";
    case "table":
      return "Table";
    case "horizontalRule":
      return "Divider";
    default:
      return node.type.name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
}

/** "Bulleted list" / "Numbered list" for a list item (its list says which). */
function listLabel(editor: Editor, pos: number): string | null {
  try {
    const parent = editor.state.doc.resolve(pos).parent.type.name;
    return parent === "bulletList" ? "Bulleted list" : parent === "orderedList" ? "Numbered list" : null;
  } catch {
    return null;
  }
}

function blockColor(node: PMNode): string | null {
  if ("color" in node.attrs) return (node.attrs.color as string) ?? null;
  const first = node.firstChild;
  return first && "color" in first.attrs ? ((first.attrs.color as string) ?? null) : null;
}

const canTurn = (node: PMNode) => ["paragraph", "heading", "listItem", "taskItem", "details", "blockquote", "callout", "codeBlock"].includes(node.type.name);
const canColor = (node: PMNode) => !["codeBlock", "horizontalRule", "table", "image", "video", "audio", "pdf", "embed", "blockMath", "breadcrumb", "pageLink"].includes(node.type.name);

/** Gives the block an anchor id (saved as {id="…"}) and returns the link to it. */
export function copyBlockLink(editor: Editor, pos: number): string | null {
  const node = editor.state.doc.nodeAt(pos);
  const noteId = editor.storage.notion.noteId;
  if (!node || !noteId) return null;
  let target = -1;
  let id: string | null = null;
  node.descendants((n, p) => {
    if (target >= 0) return false;
    if (n.type.name === "paragraph" || n.type.name === "heading") {
      target = pos + 1 + p;
      id = (n.attrs.blockId as string) ?? null;
      return false;
    }
    return true;
  });
  if (node.type.name === "paragraph" || node.type.name === "heading") {
    target = pos;
    id = (node.attrs.blockId as string) ?? null;
  }
  if (target < 0) return null;
  if (!id) {
    id = newBlockId();
    const n = editor.state.doc.nodeAt(target)!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(target, undefined, { ...n.attrs, blockId: id }));
  }
  const url = `${window.location.origin}/notes/${noteId}#b-${id}`;
  void navigator.clipboard?.writeText(url);
  return url;
}

export default function BlockMenu({
  editor,
  pos,
  rect,
  onClose,
  onToast,
  startIn,
}: {
  editor: Editor;
  pos: number;
  rect: Rect;
  onClose: () => void;
  onToast: (t: string) => void;
  startIn?: "turn" | "move";
}) {
  const node = editor.state.doc.nodeAt(pos);
  const [q, setQ] = useState("");
  const [sub, setSub] = useState<null | "turn" | "color" | "move">(startIn ?? null);
  const [subRect, setSubRect] = useState<Rect | null>(startIn ? { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.left + 250 } : null);
  const rows = useRef<Record<string, HTMLElement | null>>({});
  const s = editor.storage.notion;

  type Act = { key: string; icon: React.ReactNode; label: string; shortcut?: string; sub?: "turn" | "color" | "move"; danger?: boolean; run?: () => void };
  const actions: Act[] = useMemo(() => {
    if (!node) return [];
    const list: Act[] = [];
    if (canTurn(node)) list.push({ key: "turn", icon: "⇄", label: "Turn into", sub: "turn" });
    if (canColor(node)) list.push({ key: "color", icon: "🎨", label: "Color", sub: "color" });
    if (s.noteId)
      list.push({
        key: "link",
        icon: "🔗",
        label: "Copy link to block",
        shortcut: "Alt+Shift+L",
        run: () => {
          if (copyBlockLink(editor, pos)) onToast("Copied link to block");
          onClose();
        },
      });
    list.push({ key: "dup", icon: "⧉", label: "Duplicate", shortcut: "Ctrl+D", run: () => (duplicateBlock(editor, pos), onClose()) });
    if (s.moveBlockTo) list.push({ key: "move", icon: "↪", label: "Move to", shortcut: "Ctrl+Shift+P", sub: "move" });
    list.push({ key: "del", icon: "🗑", label: "Delete", shortcut: "Del", danger: true, run: () => (deleteBlock(editor, pos), onClose()) });
    return list;
  }, [node, editor, pos, onClose, onToast, s.noteId, s.moveBlockTo]);

  // Searching shows matching actions, block types and colors in one list
  const found: { key: string; icon: React.ReactNode; label: string; run: () => void }[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !node) return [];
    const out: { key: string; icon: React.ReactNode; label: string; run: () => void }[] = [];
    for (const a of actions) if (a.label.toLowerCase().includes(t) && a.run) out.push({ key: a.key, icon: a.icon, label: a.label, run: a.run });
    if (canTurn(node))
      for (const i of TURN_INTO)
        if (i.label.toLowerCase().includes(t) || i.keywords.some((k) => k.startsWith(t)))
          out.push({ key: `t-${i.key}`, icon: <span className="n-type-icon">{i.icon}</span>, label: `Turn into ${i.label}`, run: () => (turnInto(editor, pos, i.kind!), onClose()) });
    if (canColor(node))
      for (const c of COLOR_ITEMS as BlockItem[])
        if (c.label.toLowerCase().includes(t) || c.keywords.some((k) => k.startsWith(t)))
          out.push({
            key: c.key,
            icon: c.swatch ? <Swatch color={c.swatch.color} bg={c.swatch.bg} /> : "A",
            label: c.group === "Background color" ? c.label : `${c.label} text`,
            run: () => {
              const v = c.swatch?.color === "default" ? null : c.swatch?.bg ? `${c.swatch.color}_bg` : c.swatch?.color ?? null;
              setBlockColor(editor, pos, v);
              s.lastColor = v;
              onClose();
            },
          });
    return out;
  }, [q, actions, node, editor, pos, onClose, s]);

  const visible = q.trim() ? found : actions.map((a) => ({ key: a.key, icon: a.icon, label: a.label, run: a.run ?? (() => openSub(a.key, a.sub!)) }));
  const [index, setIndex] = useListKeys(visible.length, (i) => visible[i]?.run(), !sub);

  function openSub(key: string, which: "turn" | "color" | "move") {
    const el = rows.current[key];
    const r = el?.getBoundingClientRect();
    if (r) setSubRect({ left: r.left, top: r.top, bottom: r.bottom, right: r.right });
    setSub(which);
  }

  if (!node) return null;
  const words = countWords(node.textContent);
  const currentKind = (() => {
    switch (node.type.name) {
      case "paragraph":
        return "text";
      case "heading":
        return `h${node.attrs.level}`;
      case "taskItem":
        return "todo";
      case "details":
        return node.attrs.heading ? `th${node.attrs.heading}` : "toggle";
      case "blockquote":
        return "quote";
      case "callout":
        return "callout";
      case "codeBlock":
        return "code";
      default:
        return "";
    }
  })();

  return (
    <>
      <Popover rect={rect} onClose={onClose} width={265} className="n-menu">
        <div className="p-1.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSub(null);
            }}
            placeholder="Search actions…"
            className="n-input w-full"
          />
        </div>
        <MenuLabel>{listLabel(editor, pos) ?? blockTypeLabel(node)}</MenuLabel>
        <div className="max-h-[360px] overflow-y-auto px-1 pb-1">
          {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-faint">No results</p>}
          {visible.map((a, i) => {
            const act = actions.find((x) => x.key === a.key);
            return (
              <div key={a.key} ref={(el) => void (rows.current[a.key] = el)}>
                <MenuItem
                  icon={a.icon}
                  label={a.label}
                  shortcut={act?.shortcut}
                  danger={act?.danger}
                  active={i === index || (act?.sub !== undefined && sub === act.sub)}
                  onHover={() => {
                    setIndex(i);
                    if (act?.sub && !q) openSub(a.key, act.sub);
                    else if (!q && sub) setSub(null);
                  }}
                  onClick={a.run}
                  right={act?.sub ? <span className="text-faint">›</span> : undefined}
                />
              </div>
            );
          })}
        </div>
        <div className="n-menu-footer">
          {words.words} {words.words === 1 ? "word" : "words"} · {words.chars} characters
        </div>
      </Popover>
      {sub === "turn" && subRect && (
        <Popover rect={subRect} placement="right" onClose={() => setSub(null)} width={240} className="n-menu">
          <div className="max-h-[420px] overflow-y-auto p-1">
            <MenuLabel>Turn into</MenuLabel>
            {TURN_INTO.map((i) => (
              <MenuItem
                key={i.key}
                icon={<span className="n-type-icon">{i.icon}</span>}
                label={i.label}
                right={currentKind === i.key ? <span className="text-xs">✓</span> : undefined}
                onClick={() => {
                  turnInto(editor, pos, i.kind!);
                  onClose();
                }}
              />
            ))}
          </div>
        </Popover>
      )}
      {sub === "color" && subRect && (
        <Popover rect={subRect} placement="right" onClose={() => setSub(null)} width={230} className="n-menu">
          <ColorMenu
            current={blockColor(node)}
            last={s.lastColor}
            onPick={(c) => {
              setBlockColor(editor, pos, c);
              s.lastColor = c;
              onClose();
            }}
          />
        </Popover>
      )}
      {sub === "move" && subRect && (
        <Popover rect={subRect} placement="right" onClose={() => setSub(null)} width={290} className="n-menu">
          <PagePicker
            pages={[...s.pages.values()].filter((p) => p.id !== s.noteId)}
            placeholder="Move block to…"
            onPick={async (p) => {
              const n = editor.state.doc.nodeAt(pos);
              if (!n || !s.moveBlockTo || !editor.markdown) return;
              const md = editor.markdown.serialize({ type: "doc", content: [n.toJSON()] });
              const ok = await s.moveBlockTo(p.id, md);
              if (ok) {
                deleteBlock(editor, pos);
                onToast(`Moved to ${p.title || "Untitled"}`);
              } else onToast("Couldn't move the block.");
              onClose();
            }}
          />
        </Popover>
      )}
    </>
  );
}
