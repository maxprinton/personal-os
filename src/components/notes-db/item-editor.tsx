"use client";
// The small editor behind the "⋯" of a tag or an option (select / multi-select / status) in a picker:
// rename, pick the color, (status) change the group, delete. Used by OptionPicker and TagPicker.
import { useEffect, useRef, useState } from "react";
import { Popover } from "@/components/editor/ui";
import { COLOR_LABEL, COLOR_NAMES, type ColorName } from "@/lib/editor/colors";
import { TAGS_CHANGED, type TagChange } from "@/lib/notes-db/tag-ops";
import type { StatusGroup } from "@/lib/notes-db/types";
import { OptionPill, fitWidth, okColor, type Anchor } from "./prop-ui";

/** Result of a change: nothing = fine; `error` = show it; `conflict` = the new name is taken by that other item. */
export type EditResult = { error?: string; conflict?: string } | void;

export type TagActions = {
  update: (name: string, patch: { name?: string; color?: ColorName }) => Promise<EditResult>;
  merge: (from: string, into: string) => Promise<EditResult>;
  remove: (name: string) => Promise<EditResult>;
};

export const GROUPS: { id: StatusGroup; label: string }[] = [
  { id: "todo", label: "To-do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/** Tells every list on screen (the table, the open note…) that a tag changed. */
export function broadcastTagChange(change: TagChange) {
  try {
    window.dispatchEvent(new CustomEvent<TagChange>(TAGS_CHANGED, { detail: change }));
  } catch {
    /* no window (tests) */
  }
}

/** A row of the color choices: real pills, so you see exactly how it will look (also in dark mode). */
export function ColorGrid({ value, onPick, className = "" }: { value: ColorName; onPick: (c: ColorName) => void; className?: string }) {
  return (
    <div className={`np-swatches ${className}`} role="radiogroup" aria-label="Color">
      {COLOR_NAMES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR_LABEL[c]} title={COLOR_LABEL[c]} className={`np-swatch ${value === c ? "is-on" : ""}`} onClick={() => onPick(c)}>
          <span className="np-pill is-small" data-c={c}>
            {value === c ? "✓" : "Aa"}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ItemEditor({
  anchor,
  kind,
  name,
  color,
  prefix = "",
  group,
  isDefault,
  note,
  onClose,
  onRename,
  onMerge,
  onColor,
  onGroup,
  onDelete,
}: {
  anchor: Anchor;
  kind: "tag" | "option";
  name: string;
  color: string | null;
  /** Shown before the name in the preview ("#" for tags). */
  prefix?: string;
  /** Status options: the group (To-do / In progress / Done). */
  group?: StatusGroup;
  isDefault?: boolean;
  /** A line under the title, e.g. "Shared by notes, tasks and events". */
  note?: string;
  onClose: () => void;
  onRename: (name: string) => Promise<EditResult>;
  /** Only tags: merge into the existing tag whose name was taken. */
  onMerge?: (into: string) => Promise<EditResult>;
  onColor: (c: ColorName) => Promise<EditResult>;
  onGroup?: (g: StatusGroup) => Promise<EditResult>;
  onDelete: () => Promise<EditResult>;
}) {
  const [text, setText] = useState(name);
  const [c, setC] = useState<ColorName>(okColor(color));
  const [g, setG] = useState<StatusGroup | undefined>(group);
  const [err, setErr] = useState<string | null>(null);
  const [clash, setClash] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(name), [name]);

  // A name typed but not confirmed (clicked outside, pressed Esc) is still saved when the editor closes
  const live = useRef({ text, name, clash, onRename });
  live.current = { text, name, clash, onRename };
  useEffect(
    () => () => {
      const { text: t, name: n, clash: c, onRename: rename } = live.current;
      const next = t.trim();
      if (next && next !== n && !c) void Promise.resolve(rename(next)).catch(() => null);
    },
    [],
  );

  const run = async (fn: () => Promise<EditResult>, onOk?: () => void) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (r && r.conflict) setClash(r.conflict);
      else if (r && r.error) setErr(r.error);
      else onOk?.();
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const next = text.trim();
    if (!next) {
      setText(name);
      return;
    }
    if (next === name) return;
    void run(() => onRename(next), () => setClash(null));
  };
  const pickColor = (next: ColorName) => {
    const prev = c;
    setC(next);
    void run(async () => {
      const r = await onColor(next);
      if (r && (r.error || r.conflict)) setC(prev);
      return r;
    });
  };

  return (
    <Popover rect={anchor} onClose={onClose} width={fitWidth(250)} placement="right" className="np-menu">
      <div className="px-1 pb-1">
        <input
          autoFocus
          value={text}
          maxLength={kind === "tag" ? 60 : 100}
          aria-label={kind === "tag" ? "Tag name" : "Option name"}
          className="n-input np-input"
          onChange={(e) => {
            setText(e.target.value);
            setClash(null);
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="np-edit-preview">
        <OptionPill option={{ name: `${prefix}${text.trim() || name}`, color: c, group: g }} status={g !== undefined} />
      </div>
      {note && <p className="np-hint">{note}</p>}
      {clash && (
        <div className="np-clash" role="alert">
          <p>
            {kind === "tag" ? `A tag called #${clash} already exists.` : `There is already "${clash}".`}
            {onMerge ? " Merge them? Everything tagged with this one moves to it." : ""}
          </p>
          <div className="np-clash-actions">
            {onMerge && (
              <button type="button" className="np-btn is-primary" disabled={busy} onClick={() => void run(() => onMerge(clash), onClose)}>
                Merge into #{clash}
              </button>
            )}
            <button
              type="button"
              className="np-btn"
              onClick={() => {
                setClash(null);
                setText(name);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <p className="np-hint np-err">{err}</p>}
      <p className="n-menu-label">Color</p>
      <ColorGrid value={c} onPick={pickColor} />
      {g !== undefined && onGroup && (
        <>
          <p className="n-menu-label">Group</p>
          {GROUPS.map((x) => (
            <button
              key={x.id}
              type="button"
              className="np-row-btn"
              onClick={() => {
                const prev = g;
                setG(x.id);
                void run(async () => {
                  const r = await onGroup(x.id);
                  if (r && (r.error || r.conflict)) setG(prev);
                  return r;
                });
              }}
            >
              <span className="min-w-0 flex-1 truncate">{x.label}</span>
              <span className="np-right">{g === x.id ? "✓" : ""}</span>
            </button>
          ))}
        </>
      )}
      <div className="np-section">
        {isDefault ? (
          <p className="np-hint">This is the default option, so it can't be deleted.</p>
        ) : sure ? (
          <div className="np-clash">
            <p>{kind === "tag" ? "Delete this tag everywhere it is used?" : "Delete this option? Notes that have it will be left empty."}</p>
            <div className="np-clash-actions">
              <button type="button" className="np-btn is-danger" disabled={busy} onClick={() => void run(onDelete, onClose)}>
                Delete
              </button>
              <button type="button" className="np-btn" onClick={() => setSure(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="np-row-btn is-danger" onClick={() => setSure(true)}>
            <span className="np-icon">🗑</span>
            <span className="min-w-0 flex-1 truncate">Delete</span>
          </button>
        )}
      </div>
    </Popover>
  );
}
