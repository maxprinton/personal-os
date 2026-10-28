"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveBlockNote } from "@/app/block-note-actions";
import { setLiveNote } from "@/lib/note-export/live";
import RichEditor from "@/components/editor/LazyRichEditor"; // loads the editor only when a note is shown

import { emitCalendarChanged } from "@/components/calendar/util";

type Status = "idle" | "saving" | "saved" | "error";

/**
 * The note shared by every block with this name (like LifeOS), in the Notion-style editor.
 * It saves by itself 1 s after you stop typing, when you leave it, and when the window closes.
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
  /** Last content known from the server (Markdown). */
  content: string;
  /** Lets the parent update its own copy (e.g. the ✏️ marker on the calendar). */
  onSaved?: (content: string) => void;
  minRows?: number;
  className?: string;
}) {
  const [value, setValue] = useState(content);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(content); // what the server has
  const latest = useRef(content); // what the user has written
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef(name);
  const inFlight = useRef(false);
  const again = useRef(false);

  // Another block, or fresh data from the server while nothing is pending: show it
  useEffect(() => {
    if (nameRef.current !== name) {
      nameRef.current = name;
      saved.current = content;
      latest.current = content;
      setValue(content);
      setStatus("idle");
      return;
    }
    if (latest.current === saved.current && content !== saved.current) {
      saved.current = content;
      latest.current = content;
      setValue(content);
    }
  }, [name, content]);

  // Copy / Export read what is on screen right now
  useEffect(() => setLiveNote(`block:${name}`, { content: latest.current }), [name, content]);

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
    const v = latest.current;
    if (v === saved.current) return;
    inFlight.current = true;
    setStatus("saving");
    const r = await saveBlockNote({ name: nameRef.current, content: v });
    inFlight.current = false;
    if (r.error) {
      setStatus("error");
      setError(r.error);
    } else {
      saved.current = v;
      setError(null);
      setStatus("saved");
      onSaved?.(v);
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

  function change(md: string) {
    latest.current = md;
    setLiveNote(`block:${nameRef.current}`, { content: md });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <RichEditor
        key={name}
        value={value}
        onChange={change}
        onBlur={() => void flush()}
        minHeight={minRows * 24}
        placeholder={`Write the note of every “${name}” block, or type “/” for blocks…`}
      />
      <p className="h-4 px-1 text-xs text-faint" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? <span className="text-danger">{error}</span> : ""}
      </p>
    </div>
  );
}
