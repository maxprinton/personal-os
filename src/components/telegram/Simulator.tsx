"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { simulateStep } from "@/app/telegram-actions";
import type { SimState } from "@/lib/bot/sim/run";
import type { Kb, SimEvent } from "@/lib/bot/sim/store";

type Msg = { key: string; id: number; from: "me" | "bot" | "note"; text: string; kb: Kb | null };
export type SendRequest = { text: string; nonce: number };
export type ShowRequest = { lines: { from: "me" | "bot"; text: string }[]; nonce: number };

/** The practice chat: the real bot, with nothing saved. Your real data is only read. */
export default function Simulator({ menu, request, show, onSent }: { menu: string[][]; request: SendRequest | null; show: ShowRequest | null; onSent?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const state = useRef<SimState | null>(null);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef(0);
  const lastShow = useRef(0);

  const key = () => `m${++seq.current}`;
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [msgs, busy]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const apply = useCallback((events: SimEvent[]) => {
    setMsgs((cur) => {
      let next = [...cur];
      for (const e of events) {
        if (e.t === "send") next.push({ key: key(), id: e.id, from: "bot", text: e.text, kb: e.kb });
        else if (e.t === "photo") next.push({ key: key(), id: e.id, from: "bot", text: `📷 ${e.caption ?? "photo"}`, kb: null });
        else if (e.t === "edit") {
          const i = next.findIndex((m) => m.id === e.id && m.from === "bot");
          if (i >= 0) next[i] = { ...next[i], text: e.text, kb: e.kb };
          else next.push({ key: key(), id: e.id, from: "bot", text: e.text, kb: e.kb });
        } else if (e.t === "kb") {
          next = next.map((m) => (m.id === e.id && m.from === "bot" ? { ...m, kb: e.kb.length ? e.kb : null } : m));
        } else if (e.t === "toast") setToast(e.text);
      }
      return next;
    });
    // A question that waits for your answer: the next message you write answers it (like Telegram's force-reply)
    const ask = [...events].reverse().find((e) => e.t === "send" && e.ask);
    if (ask && ask.t === "send") setReplyTo({ key: "ask", id: ask.id, from: "bot", text: ask.text, kb: null });
  }, []);

  const step = useCallback(
    (input: Parameters<typeof simulateStep>[0], tempKey?: string) => {
      startBusy(async () => {
        const r = await simulateStep(input, state.current);
        state.current = r.state;
        if (tempKey && r.userMessageId) setMsgs((cur) => cur.map((m) => (m.key === tempKey ? { ...m, id: r.userMessageId! } : m)));
        apply(r.events);
        if (r.error) setMsgs((cur) => [...cur, { key: key(), id: 0, from: "note", text: `⚠️ ${r.error}`, kb: null }]);
        onSent?.();
      });
    },
    [apply, onSent],
  );

  const send = useCallback(
    (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const k = key();
      const reply = replyTo;
      setMsgs((cur) => [...cur, { key: k, id: 0, from: "me", text: t, kb: null }]);
      setReplyTo(null);
      setText("");
      step({ kind: "text", text: t, replyTo: reply?.id }, k);
    },
    [replyTo, step],
  );

  // “Try it” buttons in the catalog
  useEffect(() => {
    if (request && request.nonce !== lastNonce.current) {
      lastNonce.current = request.nonce;
      send(request.text);
    }
  }, [request, send]);
  // Fixed example exchanges (features that use the AI)
  useEffect(() => {
    if (show && show.nonce !== lastShow.current) {
      lastShow.current = show.nonce;
      setMsgs((cur) => [
        ...cur,
        ...show.lines.map((l) => ({ key: key(), id: 0, from: l.from, text: l.text, kb: null }) as Msg),
        { key: key(), id: 0, from: "note" as const, text: "This feature uses the free AI, so practice only shows an example.", kb: null },
      ]);
    }
  }, [show]);

  const tap = (m: Msg, data: string) => {
    if (busy || !m.kb) return;
    step({ kind: "tap", data, message: { id: m.id, text: m.text, kb: m.kb } });
  };

  const reset = () => {
    state.current = null;
    setMsgs([]);
    setReplyTo(null);
    setToast(null);
  };

  return (
    <div className="flex h-[min(78vh,720px)] min-h-[460px] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">OS</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Personal OS bot</div>
          <div className="text-[11px] leading-tight text-faint">practice · nothing is saved</div>
        </div>
        <button type="button" onClick={reset} className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-subtle hover:text-fg">
          Reset
        </button>
      </div>

      <div className="relative min-h-0 flex-1 space-y-2 overflow-y-auto bg-subtle/60 px-3 py-3">
        {toast && <div className="sticky top-0 z-10 mx-auto w-fit max-w-[90%] rounded-full bg-fg px-3 py-1 text-center text-xs text-app shadow-card">{toast}</div>}
        {msgs.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            This is a copy of the Telegram bot. Type like you do in Telegram, or pick a feature on the left and press <b>Try it</b>. Everything it
            replies is real; nothing it “saves” is kept.
          </p>
        )}
        {msgs.map((m) =>
          m.from === "note" ? (
            <p key={m.key} className="text-center text-[11px] text-faint">{m.text}</p>
          ) : (
            <div key={m.key} className={`flex flex-col ${m.from === "me" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  m.from === "me" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md border border-line bg-surface"
                }`}
              >
                {m.text}
              </div>
              {m.from === "bot" && m.id > 0 && (
                <button type="button" onClick={() => setReplyTo(m)} className="mt-0.5 px-1 text-[11px] text-faint hover:text-fg">
                  ↩ Reply
                </button>
              )}
              {m.kb && (
                <div className="mt-1 w-full max-w-[88%] space-y-1">
                  {m.kb.map((row, i) => (
                    <div key={i} className="flex gap-1">
                      {row.map((b, j) => (
                        <button
                          key={j}
                          type="button"
                          disabled={busy}
                          onClick={() => tap(m, b.callback_data)}
                          className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-60"
                        >
                          {b.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && <p className="px-1 text-xs text-faint">…</p>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line">
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-1.5 text-xs text-muted">
            <span className="shrink-0">↩ Replying to</span>
            <span className="min-w-0 flex-1 truncate">{replyTo.text.split("\n")[0]}</span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="shrink-0 text-faint hover:text-fg">✕</button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1 px-2 pt-2">
          {menu.flat().map((label) => (
            <button key={label} type="button" disabled={busy} onClick={() => send(label)} className="truncate rounded-lg bg-subtle px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-subtle-2 hover:text-fg disabled:opacity-60">
              {label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex items-end gap-2 p-2"
        >
          <textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="spent 12 lunch · task: … · /today"
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-2xl border border-line bg-app px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button type="submit" disabled={busy || !text.trim()} className="h-[38px] rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
