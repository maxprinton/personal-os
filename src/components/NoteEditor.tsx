"use client";

import { useEffect, useRef, useState } from "react";
import { autosaveNote } from "@/app/note-actions";
import { setLiveNote } from "@/lib/note-export/live";
import dynamic from "next/dynamic";

// The editor is loaded only when a note is shown (keeps every other page light)
const RichEditor = dynamic(() => import("@/components/editor/RichEditor"), {
  ssr: false,
  loading: () => <div className="rich-prose min-h-24 text-faint">Loading…</div>,
});

type Status = "idle" | "saving" | "saved" | "error";

/** A normal note: title + Notion-style editor. Saves by itself 1 s after you stop typing. */
export default function NoteEditor({ id, title, content }: { id: string; title: string; content: string }) {
  const [t, setT] = useState(title);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ title, content });
  const saved = useRef({ title, content });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);

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

  // Copy / Export read what is on screen right now
  useEffect(() => setLiveNote(id, { title, content }), [id, title, content]);

  function schedule() {
    setLiveNote(id, latest.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  }

  // Leaving the page saves what is pending
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

  return (
    <div className="space-y-3">
      <input
        value={t}
        onChange={(e) => {
          setT(e.target.value);
          latest.current = { ...latest.current, title: e.target.value };
          schedule();
        }}
        onBlur={() => void flush()}
        placeholder="Untitled"
        className="w-full border-0 bg-transparent px-0 py-2 text-3xl font-bold tracking-tight placeholder:text-faint focus:outline-none"
      />
      <RichEditor
        value={content}
        onChange={(md) => {
          latest.current = { ...latest.current, content: md };
          schedule();
        }}
        onBlur={() => void flush()}
        minHeight={320}
      />
      <p className="h-4 text-xs text-faint" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? <span className="text-danger">{error}</span> : ""}
      </p>
    </div>
  );
}
