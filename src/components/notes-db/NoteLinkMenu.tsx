"use client";
// The Kind / Block menu of a note (Oct 2026): link it to a block (Replace or Merge when the block
// already has a note), detach it, or move it between pages. Also "Change note…" for the block window
// of the calendar. Each action is confirmed with one line that says what will happen.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@/components/editor/ui";
import { moveNote } from "@/app/note-actions";
import { searchRelationTargets } from "@/app/notes-db-actions";
import {
  detachFromBlock,
  linkNoteToBlock,
  listBlocksForLinking,
  searchPagesForMove,
  startNewBlockNote,
  type BlockChoice,
  type LinkResult,
  type PageChoice,
} from "@/app/block-link-actions";
import { emitCalendarChanged } from "@/components/calendar/util";
import type { NoteKind, RelatedItem } from "@/lib/notes-db/types";
import { anchorOf, errorText, fitWidth, toast, type Anchor } from "./prop-ui";
import "./properties.css";

type Choice = { block: string; blockTypeId: string; noteId: string; current: { id: string; title: string; preview: string } };
type View =
  | { v: "menu" }
  | { v: "blocks" }
  | { v: "pages"; mode: "inside" | "another" }
  | { v: "confirm"; text: ReactNode; action: string; run: () => Promise<void>; danger?: boolean }
  | { v: "choice"; c: Choice };

const btn = "rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";
const btn2 = "rounded-md border border-line px-2.5 py-1 text-xs hover:bg-subtle disabled:opacity-50";

function Row({ icon, label, hint, onClick }: { icon: string; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" className="np-row-btn" onClick={onClick}>
      <span className="np-icon">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="np-right">{hint}</span>}
    </button>
  );
}

function Confirm({ text, action, busy, danger, onOk, onBack }: { text: ReactNode; action: string; busy: boolean; danger?: boolean; onOk: () => void; onBack: () => void }) {
  return (
    <div className="space-y-3 p-3 text-sm">
      <p className="leading-snug">{text}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={btn2} disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="button" className={danger ? `${btn} bg-danger hover:bg-danger` : btn} disabled={busy} onClick={onOk} autoFocus>
          {busy ? "Working…" : action}
        </button>
      </div>
    </div>
  );
}

/** Replace or Merge, when the block already has a note with text. */
function ChoiceView({ c, busy, onPick, onBack }: { c: Choice; busy: boolean; onPick: (mode: "replace" | "merge") => void; onBack: () => void }) {
  return (
    <div className="space-y-3 p-3 text-sm">
      <p className="leading-snug">
        “{c.block}” already has a note{c.current.preview ? ":" : "."} {c.current.preview && <span className="text-muted">“{c.current.preview}…”</span>}
      </p>
      <button type="button" className="np-row-btn !h-auto !items-start !py-2 text-left" disabled={busy} onClick={() => onPick("replace")}>
        <span className="np-icon">⇄</span>
        <span className="min-w-0 flex-1">
          <b>Replace</b>
          <span className="block text-xs text-muted">This note becomes the “{c.block}” note. The old one stays in Notes as “Former · {c.block} · today”.</span>
        </span>
      </button>
      <button type="button" className="np-row-btn !h-auto !items-start !py-2 text-left" disabled={busy} onClick={() => onPick("merge")}>
        <span className="np-icon">⊕</span>
        <span className="min-w-0 flex-1">
          <b>Merge</b>
          <span className="block text-xs text-muted">This note’s text, properties, tags and links go to the end of the “{c.block}” note. This note is removed and its link opens the merged one.</span>
        </span>
      </button>
      <div className="flex justify-end">
        <button type="button" className={btn2} disabled={busy} onClick={onBack}>
          {busy ? "Working…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function useBlocks(active: boolean) {
  const [blocks, setBlocks] = useState<BlockChoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!active || blocks) return;
    let live = true;
    void listBlocksForLinking()
      .then((r) => {
        if (!live) return;
        if (r.ok) setBlocks(r.blocks);
        else setErr(errorText(r, "Couldn't load your blocks."));
      })
      .catch((e) => live && setErr(errorText(e, "Couldn't load your blocks.")));
    return () => {
      live = false;
    };
  }, [active, blocks]);
  return { blocks, err };
}

function BlockList({ noteId, onPick }: { noteId: string; onPick: (b: BlockChoice) => void }) {
  const { blocks, err } = useBlocks(true);
  const [q, setQ] = useState("");
  const shown = useMemo(() => (blocks ?? []).filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())), [blocks, q]);
  return (
    <>
      <div className="np-search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your blocks…" aria-label="Search blocks" />
      </div>
      <div className="np-section" style={{ maxHeight: 300, overflowY: "auto" }}>
        {err && <p className="np-hint np-err">{err}</p>}
        {!blocks && !err && <p className="np-hint">Loading…</p>}
        {shown.map((b) => (
          <button key={b.id} type="button" className="np-row-btn" disabled={b.noteId === noteId} onClick={() => onPick(b)}>
            <span className="np-icon">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
            </span>
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            <span className="np-right">{b.noteId === noteId ? "this note ✓" : b.noteId && !b.noteEmpty ? "has a note" : ""}</span>
          </button>
        ))}
        {blocks && !shown.length && <p className="np-hint">{q ? "No block with that name." : "You have no blocks yet. Create one in the calendar."}</p>}
      </div>
    </>
  );
}

function PageList({ noteId, onPick }: { noteId: string; onPick: (p: PageChoice) => void }) {
  const [q, setQ] = useState("");
  const [pages, setPages] = useState<PageChoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void searchPagesForMove(q, noteId)
        .then((r) => {
          if (!live) return;
          if (r.ok) (setPages(r.pages), setErr(null));
          else setErr(errorText(r, "Couldn't search."));
        })
        .catch((e) => live && setErr(errorText(e, "Couldn't search.")));
    }, q ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, noteId]);
  return (
    <>
      <div className="np-search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Move inside…" aria-label="Search pages" />
      </div>
      <div className="np-section" style={{ maxHeight: 300, overflowY: "auto" }}>
        {err && <p className="np-hint np-err">{err}</p>}
        {!pages && !err && <p className="np-hint">Loading…</p>}
        {(pages ?? []).map((p) => (
          <button key={p.id} type="button" className="np-row-btn" onClick={() => onPick(p)}>
            <span className="np-icon">{p.icon || "📄"}</span>
            <span className="min-w-0 flex-1 truncate">{p.title}</span>
          </button>
        ))}
        {pages && !pages.length && <p className="np-hint">Nothing found.</p>}
      </div>
    </>
  );
}

/** Runs a link and turns its answer into: done, a Replace/Merge question, or an error. */
async function runLink(noteId: string, blockTypeId: string, mode?: "replace" | "merge"): Promise<{ done?: string; notice?: string; choice?: Choice }> {
  const r: LinkResult = await linkNoteToBlock({ noteId, blockTypeId, mode });
  if ("needsChoice" in r && r.needsChoice) return { choice: { block: r.block, blockTypeId, noteId, current: r.current } };
  if (r.ok) return { done: r.noteId, notice: r.notice };
  throw r;
}

/**
 * The button that opens the menu (a note's Kind / Block value, or the "✏️ Block note" header).
 * navigate: after a change, open the resulting note (the note page) instead of just refreshing.
 */
export default function NoteLinkButton({
  noteId,
  kind,
  blockName,
  isTemplate,
  label,
  className,
  navigate = true,
}: {
  noteId: string;
  kind: NoteKind;
  blockName?: string | null;
  isTemplate?: boolean;
  label: ReactNode;
  className?: string;
  navigate?: boolean;
}) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [view, setView] = useState<View>({ v: "menu" });
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const close = () => {
    setAnchor(null);
    setView({ v: "menu" });
    setBusy(false);
  };
  const finish = (id: string, notice?: string) => {
    close();
    if (notice) toast(notice, false);
    emitCalendarChanged();
    if (navigate && id !== noteId) router.push(`/notes/${id}`);
    else router.refresh();
  };
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e, "Couldn't do that. Try again."));
      setBusy(false);
    }
  };

  const linkTo = (b: BlockChoice) =>
    setView({
      v: "confirm",
      action: "Link",
      text: (
        <>
          This note becomes the note of every “<b>{b.name}</b>” block and takes its name.
          {kind === "subpage" && " It leaves its page (the page keeps a link to it)."}
          {kind === "block" && blockName && ` “${blockName}” starts with an empty note.`}
        </>
      ),
      run: async () => {
        const r = await runLink(noteId, b.id);
        if (r.choice) {
          setBusy(false);
          setView({ v: "choice", c: r.choice });
        } else if (r.done) finish(r.done, r.notice);
      },
    });

  const moveTo = (p: PageChoice | null) =>
    setView({
      v: "confirm",
      action: "Move",
      text: p ? (
        <>
          This page moves inside “<b>{p.title}</b>”, with its own sub-pages.
        </>
      ) : (
        <>This page moves to the top level of Notes, with its own sub-pages.</>
      ),
      run: async () => {
        const r = await moveNote(noteId, p ? p.id : null);
        if (!r.ok) throw r;
        finish(noteId, p ? `Moved inside “${p.title}”.` : "Moved to the top level.");
      },
    });

  const detach = () =>
    setView({
      v: "confirm",
      action: "Detach",
      text: (
        <>
          This note becomes a normal page called “Former · {blockName} · today”. “{blockName}” starts with an empty note.
        </>
      ),
      run: async () => {
        const r = await detachFromBlock(noteId);
        if (!r.ok) throw r;
        finish(noteId, r.notice);
      },
    });

  function body(): ReactNode {
    if (isTemplate)
      return (
        <div className="np-section">
          <p className="np-hint">Templates can&apos;t be linked to a block or moved from here.</p>
        </div>
      );
    switch (view.v) {
      case "menu":
        return (
          <div className="np-section">
            <p className="n-menu-label">{kind === "block" ? `Block note · ${blockName ?? ""}` : kind === "subpage" ? "Sub-page" : "Page"}</p>
            {kind === "block" ? (
              <>
                <Row icon="✂" label="Detach from block" onClick={detach} />
                <Row icon="🧱" label="Link to another block…" onClick={() => setView({ v: "blocks" })} />
              </>
            ) : (
              <>
                <Row icon="🧱" label="Link to a block…" onClick={() => setView({ v: "blocks" })} />
                {kind === "page" ? (
                  <Row icon="📄" label="Move inside another page…" onClick={() => setView({ v: "pages", mode: "inside" })} />
                ) : (
                  <>
                    <Row icon="⬆" label="Move to top level" onClick={() => moveTo(null)} />
                    <Row icon="📄" label="Move to another page…" onClick={() => setView({ v: "pages", mode: "another" })} />
                  </>
                )}
              </>
            )}
          </div>
        );
      case "blocks":
        return <BlockList noteId={noteId} onPick={linkTo} />;
      case "pages":
        return <PageList noteId={noteId} onPick={moveTo} />;
      case "confirm":
        return <Confirm text={view.text} action={view.action} busy={busy} danger={view.danger} onBack={() => setView({ v: "menu" })} onOk={() => void attempt(view.run)} />;
      case "choice": {
        const c = view.c;
        return (
          <ChoiceView
            c={c}
            busy={busy}
            onBack={() => setView({ v: "menu" })}
            onPick={(mode) =>
              void attempt(async () => {
                const r = await runLink(c.noteId, c.blockTypeId, mode);
                if (r.done) finish(r.done, r.notice);
              })
            }
          />
        );
      }
    }
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        title="Change where this note lives"
        onClick={(e) => {
          e.stopPropagation();
          setView({ v: "menu" });
          setAnchor(anchorOf(ref.current));
        }}
      >
        {label}
      </button>
      {anchor && (
        <Popover rect={anchor} onClose={close} width={fitWidth(320)} className="np-menu">
          {body()}
        </Popover>
      )}
    </>
  );
}

/** Calendar → block window → "Change note…": pick another note for this block, or start a new empty one. */
export function ChangeBlockNote({ blockTypeId, blockName, className }: { blockTypeId: string; blockName: string; className?: string }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [view, setView] = useState<{ v: "pick" } | { v: "new" } | { v: "choice"; c: Choice }>({ v: "pick" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<RelatedItem[] | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!anchor) return;
    let live = true;
    const t = setTimeout(() => {
      void searchRelationTargets("notes", q)
        .then((r) => live && r.ok && setItems(r.items.filter((i) => i.title !== `✏️ ${blockName}`)))
        .catch(() => live && setItems([]));
    }, q ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [anchor, q, blockName]);

  const close = () => {
    setAnchor(null);
    setView({ v: "pick" });
    setBusy(false);
    setQ("");
  };
  const done = (notice?: string) => {
    close();
    if (notice) toast(notice, false);
    emitCalendarChanged();
    router.refresh();
  };
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e, "Couldn't change the note."));
      setBusy(false);
    }
  };
  const pick = (noteId: string) =>
    void attempt(async () => {
      const r = await runLink(noteId, blockTypeId);
      if (r.choice) {
        setBusy(false);
        setView({ v: "choice", c: r.choice });
      } else done(r.notice);
    });

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        onClick={() => {
          setView({ v: "pick" });
          setAnchor(anchorOf(ref.current));
        }}
      >
        Change note…
      </button>
      {anchor && (
        <Popover rect={anchor} onClose={close} width={fitWidth(340)} className="np-menu">
          {view.v === "pick" && (
            <>
              <div className="np-section">
                <Row icon="＋" label="Start a new empty note" onClick={() => setView({ v: "new" })} />
              </div>
              <div className="np-search">
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Use another note for “${blockName}”…`} aria-label="Search notes" />
              </div>
              <div className="np-section" style={{ maxHeight: 280, overflowY: "auto" }}>
                {!items && <p className="np-hint">Loading…</p>}
                {(items ?? []).map((n) => (
                  <button key={n.id} type="button" className="np-row-btn" disabled={busy} onClick={() => pick(n.id)}>
                    <span className="np-icon">{n.icon || (n.title.startsWith("✏️") ? "" : "📄")}</span>
                    <span className="min-w-0 flex-1 truncate">{n.title || "Untitled"}</span>
                  </button>
                ))}
                {items && !items.length && <p className="np-hint">Nothing found.</p>}
              </div>
            </>
          )}
          {view.v === "new" && (
            <Confirm
              text={<>“{blockName}” starts with an empty note. If its note has text, it stays in Notes as “Former · {blockName} · today”.</>}
              action="Start new note"
              busy={busy}
              onBack={() => setView({ v: "pick" })}
              onOk={() =>
                void attempt(async () => {
                  const r = await startNewBlockNote(blockTypeId);
                  if (!r.ok) throw r;
                  done(r.notice);
                })
              }
            />
          )}
          {view.v === "choice" && (
            <ChoiceView
              c={view.c}
              busy={busy}
              onBack={() => setView({ v: "pick" })}
              onPick={(mode) =>
                void attempt(async () => {
                  const r = await runLink(view.c.noteId, blockTypeId, mode);
                  done(r.notice);
                })
              }
            />
          )}
        </Popover>
      )}
    </>
  );
}
