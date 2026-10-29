"use client";
// OWNED BY: templates. "New" (default template, or an empty note) + "▾" to pick a template, create or edit templates.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "@/components/editor/ui";
import { createFromTemplate, createTemplate } from "@/app/template-actions";
import { createNoteInDb } from "@/app/notes-db-actions";
import type { TemplateInfo } from "@/lib/notes-db/types";
import { TplIcon, errText, tplTitle } from "./tpl-ui";
import "./templates.css";

type Rect = { left: number; top: number; bottom: number; right: number };
const MENU_W = 280;

export default function NewNoteButton({
  templates,
  values,
  compact,
  label,
}: {
  templates: TemplateInfo[];
  /** Values the new note gets (e.g. the board column, or the filters that are on). */
  values?: Record<string, unknown>;
  /** Small "+ New" for board columns / table bottom. */
  compact?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Rect | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // what is being created
  const [error, setError] = useState<string | null>(null);
  const def = templates.find((t) => t.config.isDefault) ?? null;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  async function run(key: string, make: () => Promise<{ ok?: boolean; id?: string; error?: string }>) {
    if (busy) return;
    setMenu(null);
    setBusy(key);
    setError(null);
    try {
      const r = await make();
      if (r.ok && r.id) {
        router.push(`/notes/${r.id}`);
        return; // stays "Creating…" until the page changes
      }
      setError(errText(r, "Couldn't create the note."));
    } catch (e) {
      setError(errText(e, "Couldn't create the note."));
    }
    setBusy(null);
  }

  const fromTemplate = (id: string) => run(id, () => createFromTemplate(id, { values }));
  const empty = () => run("empty", () => createNoteInDb({ values }));
  const newDefault = () => (def ? fromTemplate(def.id) : empty());
  const newTemplate = () => run("template", () => createTemplate());

  function openMenu() {
    if (menu) return setMenu(null);
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
    const w = Math.min(MENU_W, vw - 16);
    // Right-aligned with the button (it usually sits at the right of the toolbar)
    const left = compact ? r.left : Math.max(8, r.right - w);
    setMenu({ left, top: r.top, bottom: r.bottom, right: r.right });
  }

  const mainLabel = busy ? "Creating…" : (label ?? "New");
  const title = def ? `New note from “${tplTitle(def)}”` : "New empty note";

  return (
    <div className="tpl-new-wrap" ref={wrapRef}>
      {compact ? (
        <span className="tpl-new-compact-group">
          <button type="button" className="tpl-new-compact" onClick={newDefault} disabled={!!busy} title={title}>
            <span aria-hidden>+</span> {busy ? "Creating…" : (label ?? "New")}
          </button>
          <button type="button" className="tpl-new-compact tpl-new-compact-caret" onClick={openMenu} disabled={!!busy} aria-label="Choose a template" aria-expanded={!!menu} title="Choose a template">
            ▾
          </button>
        </span>
      ) : (
        <div className="tpl-new">
          <button type="button" onClick={newDefault} disabled={!!busy} title={title}>
            {mainLabel}
          </button>
          <button type="button" className="tpl-new-caret" onClick={openMenu} disabled={!!busy} aria-label="Choose a template" aria-expanded={!!menu} title="Choose a template">
            ▾
          </button>
        </div>
      )}
      {error && (
        <span className="tpl-err" role="alert">
          {error}
        </span>
      )}

      {menu && (
        <Popover rect={menu} onClose={() => setMenu(null)} width={Math.min(MENU_W, typeof window === "undefined" ? MENU_W : window.innerWidth - 16)} className="n-menu">
          <div className="tpl-menu" role="menu">
            <p className="n-menu-label">Templates</p>
            {templates.length === 0 && <p className="tpl-menu-empty">No templates yet. A template is a page you reuse to start new notes.</p>}
            {templates.map((t) => (
              <div key={t.id} className="tpl-menu-row">
                <button type="button" role="menuitem" className="n-menu-item tpl-menu-main" onClick={() => fromTemplate(t.id)} title={`New note from “${tplTitle(t)}”`}>
                  <span className="n-menu-icon">
                    <TplIcon icon={t.icon} />
                  </span>
                  <span className="tpl-menu-title">{tplTitle(t)}</span>
                  {t.config.isDefault && <span className="tpl-default">Default</span>}
                  {t.config.schedule && !t.config.schedule.paused && (
                    <span className="tpl-sched-dot" title="Scheduled" aria-label="Scheduled">
                      ⏰
                    </span>
                  )}
                </button>
                <Link href={`/notes/${t.id}`} className="tpl-edit" title="Edit template" aria-label={`Edit template ${tplTitle(t)}`} onClick={() => setMenu(null)}>
                  ✏️
                </Link>
              </div>
            ))}
            <div className="tpl-menu-sep" />
            <button type="button" role="menuitem" className="n-menu-item" onClick={newTemplate}>
              <span className="n-menu-icon">＋</span>
              <span>New template</span>
            </button>
            <button type="button" role="menuitem" className="n-menu-item" onClick={empty}>
              <span className="n-menu-icon">📄</span>
              <span>Empty note</span>
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}
