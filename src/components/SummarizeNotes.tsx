"use client";

// ✨ Summarize in the Notes bar: Gemini reads the selected notes and writes one summary. You see it first,
// then save it as a new note (or copy it, try again, or ask for changes).
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal, { btnPrimary, btnSecondary } from "@/components/calendar/Modal";
import { createNoteFromMarkdown } from "@/app/note-actions";
import { askAi, previewHtml } from "@/lib/ai-client";
import type { ExportNote } from "@/lib/note-export/model";

export default function SummarizeNotes({ getNotes, count }: { getNotes: () => ExportNote[]; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={!count}
        onClick={() => setOpen(true)}
        title={count ? "Gemini writes one summary of the selected notes" : "Select notes to summarize them"}
        className="rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:bg-subtle disabled:opacity-40"
      >
        ✨ Summarize
      </button>
      {open && <SummaryWindow notes={getNotes()} onClose={() => setOpen(false)} />}
    </>
  );
}

function SummaryWindow({ notes, onClose }: { notes: ExportNote[]; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  const names = notes.map((n) => n.title || "Untitled");
  const title = notes.length === 1 ? `Summary of ${names[0]}` : `Summary: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;

  const run = useCallback(
    async (refine?: string) => {
      setLoading(true);
      setError(null);
      const res = await askAi({
        mode: "summarize-notes",
        notes: notes.map((n) => ({ title: n.title, content: n.content })),
        ...(refine ? { previous: draft, refine } : {}),
      });
      setLoading(false);
      if ("text" in res) {
        setDraft(res.text);
        setInput("");
      } else setError(res.error);
    },
    [notes, draft],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  async function save() {
    setSaving(true);
    const sources = notes.filter((n) => n.kind !== "block").map((n) => `<mention-page url="/notes/${n.id}">${(n.title || "Untitled").replace(/</g, "&lt;")}</mention-page>`);
    const footer = sources.length ? `\n\n---\n\nFrom: ${sources.join(", ")}\n` : "";
    const r = await createNoteFromMarkdown(title, `${draft.trim()}${footer}`);
    setSaving(false);
    if (r.error || !r.id) return setError(r.error ?? "Couldn't save it.");
    onClose();
    router.push(`/notes/${r.id}`);
  }

  return (
    <Modal title={`✨ Summary of ${notes.length} note${notes.length === 1 ? "" : "s"}`} onClose={onClose} wide>
      <p className="-mt-2 truncate text-xs text-muted">{names.join(" · ")}</p>
      {loading && (
        <div className="flex items-center gap-3 py-6 text-sm text-muted">
          <span className="n-ai-dots" aria-hidden><i /><i /><i /></span>
          Gemini is reading your notes…
        </div>
      )}
      {!loading && draft && (
        <div className="n-ai-draft max-h-[50vh] rounded-lg border border-line bg-subtle/40 py-3" dangerouslySetInnerHTML={{ __html: previewHtml(draft) }} />
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && draft && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) void run(input.trim());
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell AI what to change… (e.g. shorter, in Spanish, focus on money)"
            className="min-w-0 flex-1 rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          <button disabled={!input.trim()} className={btnSecondary}>Change</button>
        </form>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-faint">Gemini can make mistakes.</span>
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
        {!loading && (
          <button type="button" onClick={() => void run()} className={btnSecondary}>↻ Try again</button>
        )}
        {draft && !loading && (
          <button
            type="button"
            className={btnSecondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(draft);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {}
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        )}
        {draft && !loading && (
          <button type="button" disabled={saving} onClick={() => void save()} className={btnPrimary}>
            {saving ? "Saving…" : "Save as new note"}
          </button>
        )}
      </div>
    </Modal>
  );
}
