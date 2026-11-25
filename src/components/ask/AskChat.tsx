"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { askWeb, deleteAskConversation, listAskConversations, loadAskConversation, type AskSource, type ConversationRow } from "@/app/ask-actions";
import { DEPTHS, MAX_QUESTION, type Depth } from "@/lib/ask/web";
import { btnPrimary, btnSecondary } from "@/components/calendar/Modal";
import { showAiUsage } from "@/lib/ai-usage-client";

type Msg = { role: "user" | "assistant"; content: string; sources?: AskSource[]; alsoRead?: string[]; failed?: boolean };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * BL-22: ask your notes (@os) as a conversation. Used by the top-bar panel, the /ask page and the panel inside a note.
 * focusNoteId = the note that is always read first. wide = the /ask page (history on the side).
 * initialConversationId = BL-120: the conversation to open on load (the panel's "Open the full page" link carries it).
 */
export default function AskChat({ focusNoteId = null, focusTitle = null, wide = false, initialConversationId = null }: { focusNoteId?: string | null; focusTitle?: string | null; wide?: boolean; initialConversationId?: string | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [depth, setDepth] = useState<Depth>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notSaved, setNotSaved] = useState(false);
  const [history, setHistory] = useState<ConversationRow[]>([]);
  const [historyNote, setHistoryNote] = useState("");
  const [showHistory, setShowHistory] = useState(wide);
  const end = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(async () => {
    const r = await listAskConversations();
    setHistory(r.rows);
    setHistoryNote(r.error ?? "");
  }, []);
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  useEffect(() => {
    if (initialConversationId) void open(initialConversationId);
    // only once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [msgs, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError("");
    setBusy(true);
    const before = msgs;
    setMsgs([...before, { role: "user", content: question }]);
    setQ("");
    // the thread so far (used by the server only when conversations cannot be saved)
    const thread: { q: string; a: string; ids: string[] }[] = [];
    for (let i = 0; i < before.length - 1; i++) {
      if (before[i].role === "user" && before[i + 1].role === "assistant" && !before[i + 1].failed) thread.push({ q: before[i].content, a: before[i + 1].content, ids: (before[i + 1].sources ?? []).map((s) => s.id) });
    }
    const r = await askWeb({ conversationId, question, depth, focusNoteId, thread });
    setBusy(false);
    if (!r.ok) {
      // keep the conversation; the question goes back to the box so it can be sent again
      setMsgs(before);
      setQ(question);
      setError(r.error);
      return;
    }
    setMsgs([...before, { role: "user", content: question }, { role: "assistant", content: r.answer, sources: r.sources, alsoRead: r.alsoRead }]);
    setConversationId(r.conversationId);
    setNotSaved(!r.saved);
    if (r.usage) showAiUsage(r.usage);
    if (r.saved) void refreshHistory();
  }

  async function open(id: string) {
    if (busy) return;
    setError("");
    const r = await loadAskConversation(id);
    if (r.error) return setError(r.error);
    setMsgs(r.messages.map((m) => ({ role: m.role, content: m.content, sources: m.sources })));
    setConversationId(id);
    setNotSaved(false);
    if (!wide) setShowHistory(false);
  }

  async function remove(c: ConversationRow) {
    if (!window.confirm(`Delete the conversation "${c.title}" for good?`)) return;
    const r = await deleteAskConversation(c.id);
    if (r.error) return setError(r.error);
    if (conversationId === c.id) startNew();
    void refreshHistory();
  }

  function startNew() {
    setMsgs([]);
    setConversationId(null);
    setError("");
    setNotSaved(false);
  }

  const historyList = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Conversations</h3>
        <button type="button" onClick={startNew} className="text-xs text-accent hover:underline">+ New</button>
      </div>
      {historyNote && <p className="text-xs text-warning">{historyNote}</p>}
      {!historyNote && history.length === 0 && <p className="text-xs text-faint">No saved conversations yet.</p>}
      <ul className="space-y-1">
        {history.map((c) => (
          <li key={c.id} className={`flex items-center gap-1 rounded-md ${conversationId === c.id ? "bg-accent-soft" : "hover:bg-subtle"}`}>
            <button type="button" onClick={() => open(c.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm">
              <span className="block truncate">{c.title || "Conversation"}</span>
              <span className="block text-xs text-faint">{when(c.updated_at)}</span>
            </button>
            <button type="button" onClick={() => remove(c)} aria-label="Delete conversation" title="Delete" className="px-2 text-xs text-faint hover:text-danger">×</button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className={wide ? "grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]" : "flex h-full min-h-0 flex-col"}>
      {wide && <aside className="hidden lg:block">{historyList}</aside>}
      <div className={wide ? "min-w-0 space-y-3" : "flex min-h-0 flex-1 flex-col gap-3"}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {focusNoteId && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">Reads first: {focusTitle || "this note"}</span>}
          <button type="button" onClick={() => setShowHistory((v) => !v)} className={`text-accent hover:underline ${wide ? "lg:hidden" : ""}`}>
            {showHistory ? "Hide conversations" : `Conversations (${history.length})`}
          </button>
          {msgs.length > 0 && <button type="button" onClick={startNew} className="text-accent hover:underline">New conversation</button>}
        </div>
        {showHistory && <div className={`rounded-lg border border-line p-3 ${wide ? "lg:hidden" : ""}`}>{historyList}</div>}

        <div className={`space-y-3 ${wide ? "min-h-[40vh]" : "min-h-0 flex-1 overflow-y-auto"}`}>
          {msgs.length === 0 && !busy && (
            <p className="text-sm text-muted">
              Ask anything about your notes. It can also read your Backlog and your finance numbers when the question is about them.
              Try “what did I write about the trip?” or “what is in Now?”.
            </p>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg">{m.content}</div>
            ) : (
              <div key={i} className="max-w-[95%] space-y-2 rounded-2xl bg-subtle px-3 py-2 text-sm">
                <p className="whitespace-pre-wrap">{m.content}</p>
                <div className="space-y-1 border-t border-line pt-2 text-xs text-muted">
                  {m.sources && m.sources.length > 0 ? (
                    <p>
                      Sources:{" "}
                      {m.sources.map((s, j) => (
                        <span key={s.id}>
                          {j > 0 && " · "}
                          <Link href={`/notes/${s.id}`} className="text-accent hover:underline">{s.title || "Untitled"}</Link>
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p>No note matched: this is a general answer, not from your notes.</p>
                  )}
                  {m.alsoRead && m.alsoRead.length > 0 && <p>Also read: {m.alsoRead.join(" and ")} (numbers calculated by the app).</p>}
                </div>
              </div>
            )
          )}
          {busy && <p className="text-sm text-muted">Reading your notes…</p>}
          <div ref={end} />
        </div>

        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error} {q && <button type="button" onClick={() => send(q)} className="underline">Try again</button>}
          </p>
        )}
        {notSaved && <p className="text-xs text-warning">This conversation is not being saved (run MIGRACION-0071-ask-os.sql in Supabase). It still works until you close it.</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(q);
          }}
          className="space-y-2"
        >
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(q);
              }
            }}
            rows={2}
            maxLength={MAX_QUESTION}
            placeholder={msgs.length ? "Ask a follow-up…" : "Ask your notes…"}
            aria-label="Your question"
            className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="How much to read" className="flex overflow-hidden rounded-md border border-edge text-xs">
              {(Object.keys(DEPTHS) as Depth[]).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={depth === d} title={DEPTHS[d].hint} onClick={() => setDepth(d)} className={`px-2.5 py-1.5 ${depth === d ? "bg-accent text-accent-fg" : "hover:bg-subtle"}`}>
                  {DEPTHS[d].label}
                </button>
              ))}
            </div>
            <span className="text-xs text-faint">{DEPTHS[depth].hint}</span>
            <button disabled={busy || !q.trim()} className={`${btnPrimary} ml-auto`}>{busy ? "Asking…" : "Ask"}</button>
          </div>
        </form>
        {!wide && <Link href={conversationId ? `/ask?c=${encodeURIComponent(conversationId)}` : "/ask"} className={`${btnSecondary} text-center text-xs`}>Open the full page</Link>}
      </div>
    </div>
  );
}
