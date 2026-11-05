"use client";
// Notes → "🎬 Turn into video idea" (Worker A). Mounted in the note's top bar (src/app/notes/[id]/page.tsx).
// With text selected in the note it uses the selection; otherwise the whole note (title + start).
// The idea goes to the YouTube idea bank (source "note", linked to the note).
// Also shows "Used in" — the videos whose research buckets use this note, and ideas made from it.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createIdeaFromNote, videosForNote } from "@/app/youtube-actions/ideas";
import { videoHref } from "@/lib/youtube/constants";

function currentSelection(): string {
  if (typeof window === "undefined") return "";
  return (window.getSelection()?.toString() ?? "").trim();
}

export default function TurnIntoVideoIdea({ noteId }: { noteId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const lastSel = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [hasSel, setHasSel] = useState(false);
  type VRow = { id: string; label: string; stage: string };
  const [used, setUsed] = useState<{ usedIn: VRow[]; ideas: VRow[] } | null>(null);
  const [showUsed, setShowUsed] = useState(false);

  useEffect(() => {
    let alive = true;
    videosForNote(noteId)
      .then((r) => alive && setUsed({ usedIn: r.usedIn, ideas: r.ideas }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [noteId]);
  const usedCount = used ? new Set([...used.usedIn, ...used.ideas].map((v) => v.id)).size : 0;

  // Remember the last non-empty selection (on phones tapping the button can clear it first).
  useEffect(() => {
    const onSel = () => {
      const t = currentSelection();
      if (t) lastSel.current = { text: t, at: Date.now() };
      setHasSel(!!t);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(t);
  }, [msg]);

  const run = () => {
    const now = currentSelection();
    const recent = Date.now() - lastSel.current.at < 4000 ? lastSel.current.text : "";
    const quote = (now || recent).slice(0, 2000);
    setMsg(null);
    start(async () => {
      const r = await createIdeaFromNote(noteId, quote || null);
      if (r.error || !r.id) setMsg({ ok: false, text: r.error ?? "Couldn't create the idea." });
      else setMsg({ ok: true, text: quote ? "Selected text saved as a video idea." : "Note saved as a video idea.", id: r.id });
    });
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="n-ai-top"
        disabled={pending}
        // keep the editor's selection when the button is pressed
        onMouseDown={(e) => e.preventDefault()}
        onClick={run}
        title={hasSel ? "Turn the selected text into a YouTube video idea" : "Turn this note into a YouTube video idea (select text first to use only that part)"}
        aria-label={hasSel ? "Turn selected text into video idea" : "Turn into video idea"}
      >
        🎬 <span className="hidden sm:inline">{pending ? "Saving…" : hasSel ? "Selection → idea" : "Video idea"}</span>
      </button>
      {usedCount > 0 && (
        <button
          type="button"
          className="n-ai-top"
          onClick={() => setShowUsed((x) => !x)}
          title="Videos that use this note in their research, or came from it"
          aria-expanded={showUsed}
        >
          <span className="text-xs">Used in {usedCount}</span>
        </button>
      )}
      {showUsed && used && (
        <span className="absolute right-0 top-full z-50 mt-1 w-72 space-y-1 rounded-md border border-line bg-surface p-2 text-xs shadow-card">
          {used.usedIn.length > 0 && <span className="block font-semibold text-muted">Used in research of</span>}
          {used.usedIn.map((v) => (
            <Link key={`u${v.id}`} href={videoHref(v.id, "research")} className="block truncate text-accent hover:underline">
              {v.label} <span className="text-faint">· {v.stage}</span>
            </Link>
          ))}
          {used.ideas.length > 0 && <span className="block font-semibold text-muted">Video ideas from this note</span>}
          {used.ideas.map((v) => (
            <Link key={`i${v.id}`} href={videoHref(v.id)} className="block truncate text-accent hover:underline">
              {v.label} <span className="text-faint">· {v.stage}</span>
            </Link>
          ))}
        </span>
      )}
      {msg && (
        <span
          role="status"
          className={`absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-line bg-surface p-2 text-xs shadow-card ${msg.ok ? "text-fg" : "text-danger"}`}
        >
          {msg.text}
          {msg.id && (
            <Link href={videoHref(msg.id, "idea")} className="ml-1 font-medium text-accent hover:underline">
              Open it →
            </Link>
          )}
        </span>
      )}
    </span>
  );
}
