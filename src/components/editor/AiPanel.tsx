"use client";

// ✨ AI in the editor, like Notion AI: a menu for selected text and a panel that shows the AI's draft as a
// preview. Nothing changes in the note until you press Replace / Insert; you can also try again or ask for changes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { REPLACING_MODES, SELECTION_MODES, type AiMode, type AiRequest } from "@/lib/ai-notes";
import { askAi, previewHtml } from "@/lib/ai-client";
import { MenuItem, MenuLabel, Popover } from "@/components/editor/ui";

type Rect = { left: number; top: number; bottom: number; right?: number };

/** One AI request in progress: what to do and where the result goes. */
export type AiSession = {
  mode: AiMode;
  prompt?: string;
  /** The selection (from < to) or the insertion point (from = to). */
  from: number;
  to: number;
  /** selection: work on it · cursor: write at the cursor · top / end of the page. */
  at: "selection" | "cursor" | "top" | "end";
  rect: Rect;
  /** Opened from "/" on its own line: that empty line goes away when the result lands elsewhere. */
  emptyLine?: number;
};

const LABEL: Record<AiMode, string> = {
  summarize: "Summary of this page",
  "action-items": "Action items",
  continue: "Continue writing",
  write: "Ask AI",
  "summarize-selection": "Summary",
  improve: "Improve writing",
  fix: "Fix spelling & grammar",
  shorter: "Make shorter",
  longer: "Make longer",
  simplify: "Simplify language",
  tone: "Change tone",
  translate: "Translate",
  explain: "Explain",
  edit: "Edit with AI",
  "summarize-notes": "Summary",
};

// ---------------------------------------------------------------------------------------------
// The menu that opens from "✨ Ask AI" over selected text

const TONES = ["Professional", "Casual", "Friendly", "Confident", "Direct"];
const LANGS = ["English", "Spanish", "Portuguese", "French", "Italian", "German"];

type MenuEntry = { key: string; group: string; icon: string; label: string; mode: AiMode; prompt?: string; words: string };
const MENU: MenuEntry[] = [
  { key: "improve", group: "Edit", icon: "✨", label: "Improve writing", mode: "improve", words: "improve mejorar better" },
  { key: "fix", group: "Edit", icon: "✓", label: "Fix spelling & grammar", mode: "fix", words: "fix spelling grammar corregir ortografia" },
  { key: "shorter", group: "Edit", icon: "⇤", label: "Make shorter", mode: "shorter", words: "shorter acortar corto" },
  { key: "longer", group: "Edit", icon: "⇥", label: "Make longer", mode: "longer", words: "longer alargar largo" },
  { key: "simplify", group: "Edit", icon: "◎", label: "Simplify language", mode: "simplify", words: "simplify simple simplificar" },
  ...TONES.map((t) => ({ key: `tone-${t}`, group: "Change tone", icon: "🎙", label: t, mode: "tone" as const, prompt: t.toLowerCase(), words: `tone tono ${t}` })),
  ...LANGS.map((l) => ({ key: `tr-${l}`, group: "Translate", icon: "🌐", label: l, mode: "translate" as const, prompt: l, words: `translate traducir ${l}` })),
  { key: "sum", group: "Generate from selection", icon: "≡", label: "Summarize", mode: "summarize-selection", words: "summarize resumir summary resumen" },
  { key: "explain", group: "Generate from selection", icon: "?", label: "Explain this", mode: "explain", words: "explain explicar" },
  { key: "todo", group: "Generate from selection", icon: "☑", label: "Find action items", mode: "action-items", words: "action items todo tareas pendientes" },
];

export function AiMenu({ rect, onPick, onClose }: { rect: Rect; onPick: (mode: AiMode, prompt?: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const items = q.trim() ? MENU.filter((m) => fold(`${m.label} ${m.words} ${m.group}`).includes(fold(q.trim()))) : MENU;
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <Popover rect={rect} onClose={onClose} width={300} className="n-menu">
      <form
        className="n-ai-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onPick("edit", q.trim());
        }}
      >
        <span aria-hidden>✨</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask AI to edit… (Enter)" aria-label="Ask AI to edit the selection" />
      </form>
      <div className="max-h-[340px] overflow-y-auto p-1">
        {groups.map((g) => (
          <div key={g}>
            <MenuLabel>{g}</MenuLabel>
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <MenuItem key={i.key} icon={i.icon} label={i.label} onClick={() => onPick(i.mode, i.prompt)} />
              ))}
          </div>
        ))}
        {!items.length && <p className="px-2 py-1.5 text-sm text-faint">Press Enter to ask: “{q.trim()}”</p>}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------
// The panel: ask → writing… → preview with Replace / Insert / Try again / changes

const SUGGESTIONS: { label: string; icon: string; mode?: AiMode; fill?: string }[] = [
  { label: "Continue writing", icon: "✎", mode: "continue" },
  { label: "Summarize this page", icon: "≡", mode: "summarize" },
  { label: "Find action items", icon: "☑", mode: "action-items" },
  { label: "Brainstorm ideas about…", icon: "💡", fill: "Brainstorm ideas about " },
  { label: "Write an outline for…", icon: "☰", fill: "Write an outline for " },
  { label: "Draft a message to…", icon: "✉", fill: "Draft a message to " },
];

function markdownOf(editor: Editor, from: number, to: number) {
  try {
    const slice = editor.state.doc.cut(from, to);
    return editor.markdown?.serialize(slice.toJSON()) ?? editor.state.doc.textBetween(from, to, "\n\n");
  } catch {
    return editor.state.doc.textBetween(from, to, "\n\n");
  }
}

type Phase = "ask" | "loading" | "done" | "error";

export default function AiPanel({ editor, session, onClose }: { editor: Editor; session: AiSession; onClose: () => void }) {
  const [mode, setMode] = useState<AiMode>(session.mode);
  const [prompt, setPrompt] = useState(session.prompt ?? "");
  const [phase, setPhase] = useState<Phase>(session.mode === "write" && !session.prompt ? "ask" : "loading");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const range = useRef({ from: session.from, to: session.to, empty: session.emptyLine ?? -1 });
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Rect>(session.rect);
  const started = useRef(false);

  // Keep the target where it is while the note changes (autosave, typing elsewhere)
  useEffect(() => {
    const on = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number, assoc?: number) => number } } }) => {
      if (!transaction.docChanged) return;
      const r = range.current;
      range.current = { from: transaction.mapping.map(r.from, -1), to: transaction.mapping.map(r.to, 1), empty: r.empty < 0 ? -1 : transaction.mapping.map(r.empty) };
    };
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor]);

  // Follow the text while the page scrolls
  useEffect(() => {
    const place = () => {
      try {
        const pos = session.at === "top" ? 1 : session.at === "end" ? editor.state.doc.content.size - 1 : range.current.to;
        const c = editor.view.coordsAtPos(Math.max(0, Math.min(pos, editor.state.doc.content.size)));
        setAnchor({ left: session.at === "selection" ? editor.view.coordsAtPos(range.current.from).left : c.left, top: c.top, bottom: c.bottom });
      } catch {}
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [editor, session.at]);

  const run = useCallback(
    async (opts: { mode?: AiMode; prompt?: string; refine?: string } = {}) => {
      const m = opts.mode ?? mode;
      const p = opts.prompt ?? prompt;
      const { from, to } = range.current;
      const req: AiRequest = { mode: m, prompt: p || undefined, page: { title: editor.storage.notion.title || undefined, content: editor.getMarkdown() } };
      if (SELECTION_MODES.includes(m) || (m === "action-items" && from < to)) req.text = markdownOf(editor, from, to);
      if (m === "continue") req.text = markdownOf(editor, 0, Math.max(from, to));
      if (opts.refine) {
        req.previous = draft;
        req.refine = opts.refine;
      }
      setMode(m);
      setPrompt(p);
      setPhase("loading");
      setError(null);
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      const res = await askAi(req, ctrl.signal);
      if (abort.current !== ctrl) return; // a newer request (or Stop) replaced this one
      if ("text" in res) {
        setDraft(res.text);
        setPhase("done");
        setInput("");
      } else {
        setError(res.error);
        setPhase(draft ? "done" : "error");
      }
    },
    [editor, mode, prompt, draft],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (phase === "loading") void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === "ask" || phase === "done") setTimeout(() => inputRef.current?.focus(), 30);
  }, [phase]);

  const close = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    onClose();
  }, [onClose]);

  // A click outside closes the panel, except when a draft is ready (so it isn't lost by accident)
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (boxRef.current?.contains(t) || t.closest?.("[data-popover], .n-fmt")) return;
      if (phaseRef.current !== "done") close();
    };
    const id = setTimeout(() => window.addEventListener("mousedown", down, true), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", down, true);
    };
  }, [close]);

  // Esc discards (before the editor's own Esc)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [close]);

  // ----- Putting the draft in the note
  function blocks(md: string) {
    const json = editor.markdown?.parse(md);
    return (json?.content ?? [{ type: "paragraph", content: [{ type: "text", text: md }] }]) as Record<string, unknown>[];
  }

  function replace() {
    const { from, to } = range.current;
    const { doc } = editor.state;
    let content: unknown = blocks(draft);
    const $f = doc.resolve(from);
    const $t = doc.resolve(to);
    const list = content as { type?: string; content?: unknown[] }[];
    // A sentence inside a paragraph is replaced by text, not by a new paragraph
    if ($f.sameParent($t) && $f.parent.isTextblock && list.length === 1 && list[0].type === "paragraph") content = list[0].content ?? [];
    editor.chain().focus().insertContentAt({ from, to }, content as Record<string, unknown>[]).run();
    onClose();
  }

  function insert(where: "below" | "here") {
    const { from, to } = range.current;
    const { doc } = editor.state;
    const content = blocks(mode === "summarize" && session.at === "top" ? `<callout icon="✨" color="gray_bg">\n\n${draft}\n\n</callout>` : draft);
    const chain = editor.chain();
    // The empty line left by "/summarize" goes away (the summary lands at the top)
    const e = range.current.empty;
    if ((session.at === "top" || session.at === "end") && e >= 0 && doc.childCount > 1) {
      const $e = doc.resolve(Math.min(e, doc.content.size));
      if ($e.depth === 1 && $e.parent.type.name === "paragraph" && $e.parent.content.size === 0) chain.deleteRange({ from: $e.before(), to: $e.after() });
    }
    if (session.at === "top") chain.insertContentAt(0, content);
    else if (session.at === "end") chain.command(({ tr, commands }) => commands.insertContentAt(tr.doc.content.size, content));
    else if (where === "below" || from < to) {
      const $t = doc.resolve(to);
      chain.insertContentAt($t.depth > 0 ? $t.after(1) : to, content);
    } else {
      const $p = doc.resolve(from);
      if ($p.depth > 0 && $p.parent.isTextblock && $p.parent.content.size === 0) chain.insertContentAt({ from: $p.before(), to: $p.after() }, content);
      else chain.insertContentAt($p.depth > 0 ? $p.after(1) : from, content);
    }
    chain.focus().run();
    onClose();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  // ----- Layout: under the text on a computer, a sheet at the bottom on a phone
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 640) {
      setStyle({ left: 8, right: 8, bottom: 8 });
      return;
    }
    const width = Math.min(620, vw - 16);
    const h = boxRef.current?.offsetHeight ?? 220;
    const left = Math.max(8, Math.min(anchor.left - 8, vw - width - 8));
    const below = anchor.bottom + 10;
    const top = below + h > vh - 8 && anchor.top - h - 10 > 8 ? anchor.top - h - 10 : Math.min(below, vh - Math.min(h, vh * 0.6) - 8);
    setStyle({ left, top: Math.max(8, top), width });
  }, [anchor, phase, draft]);

  const replacing = REPLACING_MODES.includes(mode) && range.current.from < range.current.to;
  const fromSelection = range.current.from < range.current.to;
  const title = mode === "write" && prompt ? prompt : mode === "tone" ? `Tone: ${prompt}` : mode === "translate" ? `Translate to ${prompt}` : mode === "edit" ? prompt : LABEL[mode];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={boxRef} className="n-ai-panel n-pop" style={style} role="dialog" aria-label="AI" onMouseDown={(e) => e.stopPropagation()}>
      {phase === "ask" && (
        <>
          <form
            className="n-ai-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) void run({ mode: "write", prompt: input.trim() });
            }}
          >
            <span aria-hidden>✨</span>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask AI to write anything…" aria-label="Ask AI to write" />
            <button type="submit" disabled={!input.trim()} className="n-ai-send" aria-label="Send">↑</button>
          </form>
          <div className="p-1">
            <MenuLabel>Suggested</MenuLabel>
            {SUGGESTIONS.map((s) => (
              <MenuItem
                key={s.label}
                icon={s.icon}
                label={s.label}
                onClick={() => {
                  if (s.mode) void run({ mode: s.mode, prompt: "" });
                  else {
                    setInput(s.fill ?? "");
                    inputRef.current?.focus();
                  }
                }}
              />
            ))}
          </div>
        </>
      )}

      {phase !== "ask" && (
        <>
          <div className="n-ai-head">
            <span className="truncate">✨ {title}</span>
            <button type="button" onClick={close} aria-label="Discard" className="n-ai-x">✕</button>
          </div>
          {phase === "loading" && (
            <div className="n-ai-loading">
              <span className="n-ai-dots" aria-hidden><i /><i /><i /></span>
              AI is writing…
              <button type="button" onClick={() => {
                const c = abort.current;
                abort.current = null;
                c?.abort();
                if (draft) setPhase("done");
                else close();
              }}>Stop</button>
            </div>
          )}
          {phase === "error" && (
            <div className="n-ai-error">
              <p>{error}</p>
              <div className="n-ai-actions">
                <button type="button" className="is-primary" onClick={() => void run()}>Try again</button>
                <button type="button" onClick={close}>Close</button>
              </div>
            </div>
          )}
          {phase === "done" && (
            <>
              <div className="n-ai-draft rich-prose" dangerouslySetInnerHTML={{ __html: previewHtml(draft) }} />
              {error && <p className="n-ai-note">{error}</p>}
              <div className="n-ai-actions">
                {replacing && <button type="button" className="is-primary" onClick={replace}>Replace selection</button>}
                {session.at === "top" ? (
                  <button type="button" className="is-primary" onClick={() => insert("here")}>Insert at top</button>
                ) : (
                  <button type="button" className={replacing ? "" : "is-primary"} onClick={() => insert(fromSelection ? "below" : "here")}>
                    {fromSelection ? "Insert below" : "Insert"}
                  </button>
                )}
                <button type="button" onClick={() => void run()}>↻ Try again</button>
                <button type="button" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy"}</button>
                <button type="button" className="ml-auto text-faint" onClick={close}>Discard</button>
              </div>
              <form
                className="n-ai-ask is-follow"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (input.trim()) void run({ refine: input.trim() });
                }}
              >
                <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell AI what to change… (e.g. shorter, more formal, in Spanish)" aria-label="Ask for changes" />
                <button type="submit" disabled={!input.trim()} className="n-ai-send" aria-label="Send">↑</button>
              </form>
            </>
          )}
          <p className="n-ai-foot">AI can make mistakes. Nothing changes until you insert it.</p>
        </>
      )}
    </div>,
    document.body,
  );
}
