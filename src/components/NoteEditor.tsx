"use client";

// A normal note shown as a Notion page: cover, icon, big title, backlinks, the editor, a floating table
// of contents, and the ⋯ menu (style, small text, full width, lock, copy link, duplicate, move, delete).
// Title and text save by themselves 1 s after you stop typing.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import { appendToNote, autosaveNote, createSubpage, deletePage, duplicateNote, moveNote, savePageSettings, type PageSettings } from "@/app/note-actions";
import { setLiveNote } from "@/lib/note-export/live";
import { uploadNoteFile } from "@/lib/note-files";
import type { PageRef } from "@/lib/editor/context";
import { randomEmoji } from "@/lib/editor/emoji";
import RichEditor from "@/components/editor/LazyRichEditor"; // loads the editor only when a note is shown
import EmojiPicker from "@/components/editor/EmojiPicker";
import PagePicker, { PageIcon } from "@/components/editor/PagePicker";
import { MenuItem, MenuLabel, Popover } from "@/components/editor/ui";
import { requestUi } from "@/lib/editor/ui-events";
import type { AiMode } from "@/lib/ai-notes";

type Status = "idle" | "saving" | "saved" | "error";
type Rect = { left: number; top: number; bottom: number; right?: number };

/** Notion-like cover gallery (colors and gradients drawn by CSS, no downloads). */
export { COVERS, coverStyle } from "@/lib/covers";
import { COVERS, coverStyle } from "@/lib/covers";

export default function NoteEditor({
  id,
  title,
  content,
  page: initialPage,
  parentId,
  updatedAt,
  pages,
  backlinks,
  actions,
  belowTitle,
  banner,
  whenEmpty,
}: {
  id: string;
  title: string;
  content: string;
  page?: PageSettings | null;
  parentId?: string | null;
  updatedAt?: string | null;
  pages?: PageRef[];
  backlinks?: PageRef[];
  /** Extra buttons for the top bar (Export…). */
  actions?: ReactNode;
  /** Under the title: the note's properties (notes database). */
  belowTitle?: ReactNode;
  /** Above the title: "Editing template" bar, or ← previous · next → of a series. */
  banner?: ReactNode;
  /** Shown while the note has no text yet (e.g. "Start with a template"). */
  whenEmpty?: ReactNode;
}) {
  const router = useRouter();
  const [t, setT] = useState(title === "Untitled" ? "" : title);
  const [page, setPage] = useState<PageSettings>(initialPage ?? {});
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [empty, setEmpty] = useState(!content.trim());
  const [pop, setPop] = useState<null | { kind: "icon" | "cover" | "menu" | "backlinks" | "move"; rect: Rect }>(null);
  const [repositioning, setRepositioning] = useState(false);
  const [coverY, setCoverY] = useState(page.coverY ?? 50);
  const latest = useRef({ title, content });
  const saved = useRef({ title, content });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const dupForm = useRef<HTMLFormElement>(null);
  const delForm = useRef<HTMLFormElement>(null);

  // The list of notes, with this one's live title and icon
  const pageList = useMemo<PageRef[]>(() => {
    const list = (pages ?? []).map((p) => (p.id === id ? { ...p, title: t || "Untitled", icon: page.icon ?? null } : p));
    if (!list.some((p) => p.id === id)) list.push({ id, title: t || "Untitled", icon: page.icon ?? null, parentId: parentId ?? null });
    return list;
  }, [pages, id, t, page.icon, parentId]);
  const crumbs = useMemo(() => {
    const map = new Map(pageList.map((p) => [p.id, p]));
    const chain: PageRef[] = [];
    const seen = new Set<string>();
    let cur = map.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? map.get(cur.parentId) : undefined;
    }
    return chain;
  }, [pageList, id]);

  async function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const v = { ...latest.current };
    if (v.title === saved.current.title && v.content === saved.current.content) return;
    inFlight.current = true;
    setStatus("saving");
    const r = await autosaveNote({ id, ...v });
    inFlight.current = false;
    if (r.error) {
      setStatus("error");
      setError(r.error);
    } else {
      saved.current = v;
      setError(null);
      setStatus("saved");
    }
    if (again.current) {
      again.current = false;
      void flush();
    }
  }

  useEffect(() => setLiveNote(id, { title, content }), [id, title, content]);

  function schedule() {
    setLiveNote(id, latest.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      const v = latest.current;
      if (v.title !== saved.current.title || v.content !== saved.current.content) void autosaveNote({ id, ...v });
    };
  }, [id]);

  useEffect(() => {
    if (status !== "saved") return;
    const x = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(x);
  }, [status]);

  // Title grows with its text
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [t]);

  const setting = useCallback(
    async (patch: PageSettings) => {
      setPage((p) => ({ ...p, ...patch }));
      const r = await savePageSettings(id, patch);
      if (r.error) {
        setStatus("error");
        setError(r.error);
      }
    },
    [id],
  );

  const onCreateSubpage = useCallback(async (title: string): Promise<PageRef | null> => {
    const r = await createSubpage(id, title);
    if (!r.id) {
      setStatus("error");
      setError(r.error ?? "Couldn't create the page (run MIGRACION-0020?).");
      return null;
    }
    // leave what is pending saved before opening the new page
    await flush();
    return { id: r.id, title: r.title ?? (title || "Untitled"), parentId: id };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onMove = useCallback(async (noteId: string, md: string) => !!(await appendToNote(noteId, md)).ok, []);
  const onNavigate = useCallback(
    (href: string) => {
      void flush().then(() => router.push(href));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );
  const onReady = useCallback((e: Editor | null) => setEditor(e), []);

  const rectOf = (e: React.MouseEvent): Rect => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
  };

  const locked = !!page.locked;

  /** ✨ from the top bar or the ⋯ menu: summary goes at the top, "Ask AI" writes at the end of the page. */
  function openAi(mode: AiMode, rect?: Rect) {
    setPop(null);
    if (!editor || locked) return;
    requestUi(editor.view, { kind: "ai", mode, at: mode === "summarize" ? "top" : "end", rect: rect ? new DOMRect(rect.left, rect.top, (rect.right ?? rect.left) - rect.left, rect.bottom - rect.top) : undefined });
  }
  const font = page.font ?? "default";
  const words = editor?.storage.characterCount?.words?.() ?? 0;

  // Cover reposition: drag up/down
  function startReposition(e: React.MouseEvent) {
    if (!repositioning) return;
    e.preventDefault();
    const startY = e.clientY;
    const y0 = coverY;
    const h = (e.currentTarget as HTMLElement).getBoundingClientRect().height || 200;
    const move = (ev: MouseEvent) => setCoverY(Math.max(0, Math.min(100, y0 - ((ev.clientY - startY) / h) * 100)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div className="n-page-shell -mx-4 -my-6 sm:-mx-6 lg:-my-8">
      {/* Top bar: breadcrumb · saved · actions · ⋯ */}
      <div className="n-topbar">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-sm" aria-label="Breadcrumb">
          <Link href="/notes" className="n-crumb shrink-0">
            Notes
          </Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex min-w-0 items-center gap-0.5">
              <span className="n-crumb-sep">/</span>
              <Link href={`/notes/${c.id}`} className="n-crumb min-w-0">
                <PageIcon icon={c.icon} />
                <span className="truncate">{c.title || "Untitled"}</span>
              </Link>
            </span>
          ))}
        </nav>
        <span className="hidden text-xs text-faint sm:inline" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? <span className="text-danger">{error}</span> : updatedAt ? `Edited ${new Date(updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
        </span>
        {locked && (
          <button type="button" className="n-locked-badge" onClick={() => void setting({ locked: false })} title="Click to unlock">
            🔒 Locked
          </button>
        )}
        {!locked && editor && (
          <button type="button" className="n-ai-top" title="✨ Ask AI: summarize this page or write with the AI" onClick={(e) => openAi("write", rectOf(e))}>
            ✨ <span className="hidden sm:inline">AI</span>
          </button>
        )}
        {actions}
        <button type="button" className="n-icon-btn border-0 text-lg leading-none" title="Style, export, and more" onClick={(e) => setPop({ kind: "menu", rect: rectOf(e) })}>
          ⋯
        </button>
      </div>

      {page.cover && (
        <div className={`n-cover ${repositioning ? "is-repositioning" : ""}`} style={coverStyle(page.cover, coverY)} onMouseDown={startReposition}>
          {repositioning && <span className="n-cover-hint">Drag image to reposition</span>}
          {!locked && (
            <div className="n-cover-actions">
              {repositioning ? (
                <>
                  <button type="button" onClick={() => (setRepositioning(false), void setting({ coverY: Math.round(coverY) }))}>
                    Save position
                  </button>
                  <button type="button" onClick={() => (setRepositioning(false), setCoverY(page.coverY ?? 50))}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={(e) => setPop({ kind: "cover", rect: rectOf(e) })}>
                    Change cover
                  </button>
                  {!COVERS.some((c) => c.id === page.cover) && (
                    <button type="button" onClick={() => setRepositioning(true)}>
                      Reposition
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`n-page ${page.full ? "is-full" : ""} ${font !== "default" ? `font-${font}` : ""} ${page.small ? "is-small" : ""}`}>
        {banner}
        <div className={`n-head ${page.cover ? "n-has-cover" : ""} ${page.icon ? "n-has-icon" : ""}`}>
          {page.icon && (
            <button type="button" className="n-head-icon" disabled={locked} onClick={(e) => setPop({ kind: "icon", rect: rectOf(e) })} title="Change icon">
              {/^(https?:|\/)/.test(page.icon) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.icon} alt="" />
              ) : (
                page.icon
              )}
            </button>
          )}
          {!locked && (
            <div className="n-head-actions">
              {!page.icon && (
                <button type="button" onClick={() => void setting({ icon: randomEmoji() })}>
                  ☺ Add icon
                </button>
              )}
              {!page.cover && (
                <button type="button" onClick={() => void setting({ cover: COVERS[Math.floor(Math.random() * 8)].id, coverY: 50 })}>
                  🖼 Add cover
                </button>
              )}
            </div>
          )}
          <textarea
            ref={titleRef}
            rows={1}
            value={t}
            readOnly={locked}
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, " ");
              setT(v);
              latest.current = { ...latest.current, title: v };
              schedule();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || (e.key === "ArrowDown" && (e.currentTarget.selectionStart ?? 0) >= t.length)) {
                e.preventDefault();
                editor?.chain().focus("start").run();
              }
            }}
            onBlur={() => void flush()}
            placeholder="New page"
            className="n-title"
          />
          {backlinks && backlinks.length > 0 && (
            <button type="button" className="n-backlinks" onClick={(e) => setPop({ kind: "backlinks", rect: rectOf(e) })}>
              ↗ {backlinks.length} backlink{backlinks.length === 1 ? "" : "s"}
            </button>
          )}
          {belowTitle}
        </div>

        <div className="pt-1 pb-24">
          {empty && !locked && whenEmpty}
          <RichEditor
            value={content}
            onChange={(md) => {
              setEmpty(!md.trim());
              latest.current = { ...latest.current, content: md };
              schedule();
            }}
            onBlur={() => void flush()}
            minHeight={320}
            editable={!locked}
            noteId={id}
            pages={pageList}
            createSubpage={onCreateSubpage}
            upload={uploadNoteFile}
            moveBlockTo={onMove}
            navigate={onNavigate}
            onReady={onReady}
            pageTitle={t || "Untitled"}
          />
        </div>
      </div>

      {page.toc !== false && editor && <FloatingToc editor={editor} />}

      {pop?.kind === "icon" && (
        <Popover rect={pop.rect} onClose={() => setPop(null)} width={360} className="n-menu">
          <EmojiPicker
            allowLink
            onUpload={async (f) => (await uploadNoteFile(f))?.url ?? null}
            onPick={(v) => {
              void setting({ icon: v });
              setPop(null);
            }}
            onRemove={() => {
              void setting({ icon: null });
              setPop(null);
            }}
          />
        </Popover>
      )}
      {pop?.kind === "cover" && <CoverPicker rect={pop.rect} onClose={() => setPop(null)} onPick={(c) => (void setting({ cover: c, coverY: 50 }), setCoverY(50), setPop(null))} />}
      {pop?.kind === "backlinks" && (
        <Popover rect={pop.rect} onClose={() => setPop(null)} width={280} className="n-menu">
          <div className="p-1">
            <MenuLabel>Linked from</MenuLabel>
            {(backlinks ?? []).map((b) => (
              <MenuItem key={b.id} icon={<PageIcon icon={b.icon} />} label={b.title || "Untitled"} onClick={() => onNavigate(`/notes/${b.id}`)} />
            ))}
          </div>
        </Popover>
      )}
      {pop?.kind === "move" && (
        <Popover rect={pop.rect} onClose={() => setPop(null)} width={300} className="n-menu">
          <PagePicker
            pages={[{ id: "", title: "Notes (top level)", icon: "🗂️" }, ...pageList.filter((p) => p.id !== id && !crumbsOf(pageList, p.id).some((c) => c.id === id))]}
            placeholder="Move page to…"
            onPick={async (p) => {
              setPop(null);
              const r = await moveNote(id, p.id || null);
              if (r.error) {
                setStatus("error");
                setError(r.error);
              } else router.refresh();
            }}
          />
        </Popover>
      )}
      {pop?.kind === "menu" && (
        <Popover rect={pop.rect} onClose={() => setPop(null)} width={260} className="n-menu">
          <div className="p-1">
            <MenuLabel>Style</MenuLabel>
            <div className="n-style-pick">
              {(["default", "serif", "mono"] as const).map((f) => (
                <button key={f} type="button" className={font === f ? "is-on" : ""} onClick={() => void setting({ font: f })}>
                  <span style={{ fontFamily: f === "serif" ? "var(--n-serif)" : f === "mono" ? "var(--n-mono)" : "var(--n-font)" }}>Ag</span>
                  <span>{f[0].toUpperCase() + f.slice(1)}</span>
                </button>
              ))}
            </div>
            <Toggle label="Small text" on={!!page.small} onClick={() => void setting({ small: !page.small })} />
            <Toggle label="Full width" on={!!page.full} onClick={() => void setting({ full: !page.full })} />
            <Toggle label="Table of contents" on={page.toc !== false} onClick={() => void setting({ toc: page.toc === false })} />
            <Toggle label="Lock page" on={locked} onClick={() => void setting({ locked: !locked })} />
            {!locked && (
              <>
                <div className="my-1 border-t border-[var(--n-divider)]" />
                <MenuItem icon="✨" label="Summarize page" onClick={() => openAi("summarize")} />
                <MenuItem icon="☑" label="Find action items" onClick={() => openAi("action-items")} />
                <MenuItem icon="✎" label="Ask AI to write…" onClick={() => openAi("write")} />
              </>
            )}
            <div className="my-1 border-t border-[var(--n-divider)]" />
            <MenuItem
              icon="🔗"
              label="Copy link"
              shortcut="Ctrl+L"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}/notes/${id}`);
                setPop(null);
              }}
            />
            <form ref={dupForm} action={duplicateNote}>
              <input type="hidden" name="id" value={id} />
            </form>
            <MenuItem icon="⧉" label="Duplicate" onClick={() => dupForm.current?.requestSubmit()} />
            <MenuItem icon="↪" label="Move to" shortcut="Ctrl+Shift+P" onClick={() => setPop({ kind: "move", rect: pop.rect })} />
            <form ref={delForm} action={deletePage}>
              <input type="hidden" name="id" value={id} />
            </form>
            <MenuItem icon="🗑" label="Delete" danger onClick={() => confirm("Delete this page and its sub-pages?") && delForm.current?.requestSubmit()} />
          </div>
          <div className="n-menu-footer">
            Word count: {words}
            {updatedAt && (
              <>
                <br />
                Last edited {new Date(updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

function crumbsOf(list: PageRef[], id: string): PageRef[] {
  const map = new Map(list.map((p) => [p.id, p]));
  const out: PageRef[] = [];
  const seen = new Set<string>();
  let cur = map.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return out;
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <MenuItem label={label} onClick={onClick} right={<span className={`n-switch ${on ? "is-on" : ""}`} />} />;
}

function CoverPicker({ rect, onPick, onClose }: { rect: Rect; onPick: (c: string | null) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"gallery" | "upload" | "link">("gallery");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Popover rect={rect} onClose={onClose} width={420} className="n-menu">
      <div className="n-emoji-tabs">
        {(["gallery", "upload", "link"] as const).map((k) => (
          <button key={k} type="button" className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" className="n-emoji-remove" onClick={() => onPick(null)}>
          Remove
        </button>
      </div>
      {tab === "gallery" && (
        <div className="p-3">
          <p className="n-menu-label px-0">Color &amp; gradient</p>
          <div className="grid grid-cols-4 gap-2">
            {COVERS.map((c) => (
              <button key={c.id} type="button" title={c.label} onClick={() => onPick(c.id)} className="h-14 rounded-md transition-opacity hover:opacity-85" style={{ background: c.css }} />
            ))}
          </div>
        </div>
      )}
      {tab === "upload" && (
        <div className="space-y-2 p-3">
          <button type="button" className="n-btn w-full" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
          <p className="text-center text-xs text-faint">Images wider than 1500 pixels work best.</p>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              const r = await uploadNoteFile(f);
              setBusy(false);
              if (r) onPick(r.url);
            }}
          />
        </div>
      )}
      {tab === "link" && (
        <form
          className="space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^https?:\/\//.test(link.trim())) onPick(link.trim());
          }}
        >
          <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste an image link…" className="n-input w-full" />
          <button className="n-btn n-btn-primary w-full">Submit</button>
        </form>
      )}
    </Popover>
  );
}

/** Notion's floating outline on the right: one line per heading, the list opens on hover. */
function FloatingToc({ editor }: { editor: Editor }) {
  const [heads, setHeads] = useState<{ level: number; text: string; pos: number }[]>([]);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void import("@/lib/editor/nodes/toc").then((m) => {
        if (alive) setHeads(m.collectHeadings(editor));
      });
    read();
    editor.on("update", read);
    return () => {
      alive = false;
      editor.off("update", read);
    };
  }, [editor]);
  useEffect(() => {
    const on = () => {
      let a = -1;
      heads.forEach((h, i) => {
        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        if (dom?.getBoundingClientRect && dom.getBoundingClientRect().top < 140) a = i;
      });
      setActive(a);
    };
    on();
    window.addEventListener("scroll", on, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", on, { capture: true });
  }, [heads, editor]);
  if (heads.length < 2) return null;
  const min = Math.min(...heads.map((h) => h.level));
  const go = (pos: number) => void import("@/lib/editor/nodes/toc").then((m) => m.scrollToPos(editor, pos));
  return (
    <div className="n-float-toc" aria-label="Table of contents">
      {heads.map((h, i) => (
        <span key={`${h.pos}-${i}`} className={`bar ${i === active ? "is-on" : ""}`} style={{ width: 16 - (h.level - min) * 4 }} />
      ))}
      <div className="n-float-toc-panel n-pop">
        {heads.map((h, i) => (
          <a
            key={`${h.pos}-${i}`}
            href="#"
            className={i === active ? "is-on" : ""}
            style={{ paddingLeft: 6 + (h.level - min) * 12 }}
            onClick={(e) => {
              e.preventDefault();
              go(h.pos);
            }}
          >
            {h.text || "Untitled"}
          </a>
        ))}
      </div>
    </div>
  );
}
