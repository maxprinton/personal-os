"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveBlockNote } from "@/app/block-note-actions";
import { renderMarkdown, toggleTaskLine } from "@/lib/markdown";
import { emitCalendarChanged } from "@/components/calendar/util";

type Status = "idle" | "saving" | "saved" | "error";

/**
 * The note shared by every block with this name (like LifeOS): shown formatted, a click on the
 * text turns it into Markdown to write, and it saves by itself 1 s after you stop typing (and
 * when you leave it). Checkboxes "- [ ]" can be ticked right in the formatted view.
 */
export default function BlockNoteEditor({
  name,
  content,
  onSaved,
  minRows = 4,
  className = "",
}: {
  /** Block name: the key of the note. */
  name: string;
  /** Last content known from the server. */
  content: string;
  /** Lets the parent update its own copy (e.g. the ✏️ marker on the calendar). */
  onSaved?: (content: string) => void;
  minRows?: number;
  className?: string;
}) {
  const [text, setText] = useState(content);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(content); // what the server has
  const latest = useRef(content); // what the user has typed
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const nameRef = useRef(name);
  const inFlight = useRef(false);
  const again = useRef(false);

  // A new block (or fresh data from the server) replaces the text unless you are writing
  useEffect(() => {
    if (nameRef.current !== name) {
      nameRef.current = name;
      saved.current = content;
      latest.current = content;
      setText(content);
      setEditing(false);
      setStatus("idle");
      return;
    }
    if (!editing && latest.current === saved.current && content !== saved.current) {
      saved.current = content;
      latest.current = content;
      setText(content);
    }
  }, [name, content, editing]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // One save at a time (the first save creates the note); a change made meanwhile saves right after
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const value = latest.current;
    if (value === saved.current) return;
    inFlight.current = true;
    setStatus("saving");
    const r = await saveBlockNote({ name: nameRef.current, content: value });
    inFlight.current = false;
    if (r.error) {
      setStatus("error");
      setError(r.error);
    } else {
      saved.current = value;
      setError(null);
      setStatus("saved");
      onSaved?.(value);
    }
    if (again.current) {
      again.current = false;
      if (latest.current !== saved.current) void flush();
    }
  }, [onSaved]);

  // Leaving the window (or the page) saves what is pending
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (latest.current !== saved.current) {
        void saveBlockNote({ name: nameRef.current, content: latest.current }).then(() => emitCalendarChanged());
      }
    };
  }, []);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(t);
  }, [status]);

  function change(value: string) {
    latest.current = value;
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  }

  function startEditing() {
    setEditing(true);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function onViewClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const line = target.getAttribute?.("data-task-line");
    if (line !== null && line !== undefined) {
      e.preventDefault();
      latest.current = toggleTaskLine(latest.current, Number(line));
      setText(latest.current);
      void flush();
      return;
    }
    if (target.closest("a")) return; // links open normally
    startEditing();
  }

  // Grow the text box with its content
  useEffect(() => {
    const el = area.current;
    if (!editing || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 22)}px`;
  }, [text, editing, minRows]);

  return (
    <div className={`space-y-1 ${className}`}>
      {editing ? (
        <textarea
          ref={area}
          value={text}
          onChange={(e) => change(e.target.value)}
          onBlur={() => {
            void flush();
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          rows={minRows}
          placeholder={"Markdown: # title, **bold**, - list, - [ ] checkbox"}
          className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm leading-relaxed"
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={onViewClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) {
              e.preventDefault();
              startEditing();
            }
          }}
          title="Click to write"
          className="min-h-[3rem] cursor-text space-y-2 rounded-md border border-transparent px-3 py-2 text-sm leading-relaxed hover:border-line"
        >
          {text.trim() ? (
            <div className="space-y-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { interactiveTasks: true }) }} />
          ) : (
            <p className="text-faint">Click to write a note for every “{name}” block…</p>
          )}
        </div>
      )}
      <p className="h-4 px-1 text-xs text-faint" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? <span className="text-danger">{error}</span> : ""}
      </p>
    </div>
  );
}
