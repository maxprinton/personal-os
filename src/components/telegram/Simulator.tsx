"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { simulateStep } from "@/app/telegram-actions";
import type { StepInfo } from "@/lib/bot/lessons";
import type { SimState } from "@/lib/bot/sim/run";
import type { Kb, SimEvent } from "@/lib/bot/sim/store";

type Msg = { key: string; id: number; from: "me" | "bot" | "note" | "why"; text: string; kb: Kb | null };
export type SendRequest = { text: string; nonce: number };
export type ShowRequest = { lines: { from: "me" | "bot"; text: string }[]; nonce: number };
type Clock = { date: string; time: string } | null;

// What the practice chat "saved", in words (internal bookkeeping tables are not shown)
const HIDDEN = new Set(["bot_messages", "bot_threads", "user_settings", "reminder_log", "ai_usage", "daily_facts", "search_state", "search_chunks", "entity_tags", "task_day_log"]);
const LABEL: Record<string, string> = {
  tasks: "Tasks", transactions: "Money", transfers: "Transfers", events: "Events", notes: "Notes", habits: "Habits", habit_checks: "Habit marks", free_days: "Free days",
  payment_templates: "Payments", daily_metrics: "Metrics", balance_snapshots: "Balances", block_occurrences: "Blocks", categories: "Categories", system_insights: "Insights",
};
function sayRow(table: string, r: Record<string, unknown>): string {
  const text = [r.title, r.name, r.description, r.raw_text, r.date, r.scheduled_for].find((v) => typeof v === "string" && v.trim());
  const amount = typeof r.amount === "number" ? ` · $${r.amount.toFixed(2)}` : typeof r.value === "number" ? ` · ${r.value}` : "";
  return `${text ? String(text).slice(0, 70) : table}${amount}`;
}

/** The practice chat: the real bot, with nothing saved. Your real data is only read. */
export default function Simulator({
  menu, request, show, resetSignal, onStep,
}: { menu: string[][]; request: SendRequest | null; show: ShowRequest | null; resetSignal?: number; onStep?: (info: StepInfo) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "voice" | "photo" | "clock" | "changes">(null);
  const [clock, setClock] = useState<Clock>(null);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [db, setDb] = useState<SimState["db"] | null>(null);
  const [busy, startBusy] = useTransition();
  const state = useRef<SimState | null>(null);
  const seq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef(0);
  const lastShow = useRef(0);
  const lastReset = useRef(resetSignal ?? 0);
  const clockRef = useRef<Clock>(null);
  clockRef.current = clock;

  const key = () => `m${++seq.current}`;
  // Braces on purpose: newer Chrome returns a Promise from scrollIntoView, and an effect must not return it
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);
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
        else if (e.t === "why") next.push({ key: key(), id: 0, from: "why", text: e.text, kb: null });
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
    (input: Parameters<typeof simulateStep>[0], tempKey?: string, info?: Omit<StepInfo, "botText">) => {
      startBusy(async () => {
        const r = await simulateStep(input, state.current, clockRef.current);
        state.current = r.state;
        setDb(r.state.db);
        if (tempKey && r.userMessageId) setMsgs((cur) => cur.map((m) => (m.key === tempKey ? { ...m, id: r.userMessageId! } : m)));
        apply(r.events);
        if (r.error) setMsgs((cur) => [...cur, { key: key(), id: 0, from: "note", text: `⚠️ ${r.error}`, kb: null }]);
        if (info) {
          const botText = r.events.map((e) => (e.t === "send" || e.t === "edit" || e.t === "toast" ? e.text : "")).join("\n");
          onStep?.({ ...info, botText });
        }
      });
    },
    [apply, onStep],
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
      step({ kind: "text", text: t, replyTo: reply?.id }, k, { kind: "text", text: t, replied: Boolean(reply) });
    },
    [replyTo, step],
  );

  const sendVoice = () => {
    const t = text.trim();
    if (!t) return;
    const k = key();
    setMsgs((cur) => [...cur, { key: k, id: 0, from: "me", text: `🎙 (voice, 0:0${Math.min(9, 2 + Math.floor(t.length / 25))})`, kb: null }]);
    setText("");
    setPanel(null);
    step({ kind: "voice", text: t }, k, { kind: "text", text: t });
  };
  const sendPhoto = () => {
    const n = Number(amount.replace(",", "."));
    if (!(n > 0)) return;
    const k = key();
    setMsgs((cur) => [...cur, { key: k, id: 0, from: "me", text: `🧾 (photo of a receipt${merchant.trim() ? ` · ${merchant.trim()}` : ""} · $${n.toFixed(2)})`, kb: null }]);
    setMerchant("");
    setAmount("");
    setPanel(null);
    step({ kind: "photo", merchant: merchant.trim() || "receipt", amount: n }, k, { kind: "text", text: `spent ${n} ${merchant.trim()}` });
  };

  // “Try it” buttons in the catalog and lessons
  useEffect(() => {
    if (request && request.nonce !== lastNonce.current) {
      lastNonce.current = request.nonce;
      send(request.text);
    }
  }, [request, send]);
  // Fixed example exchanges (features that cannot run in practice)
  useEffect(() => {
    if (show && show.nonce !== lastShow.current) {
      lastShow.current = show.nonce;
      setMsgs((cur) => [
        ...cur,
        ...show.lines.map((l) => ({ key: key(), id: 0, from: l.from, text: l.text, kb: null }) as Msg),
        { key: key(), id: 0, from: "note" as const, text: "This one can't run in practice, so this is an example.", kb: null },
      ]);
    }
  }, [show]);

  const tap = (m: Msg, data: string) => {
    if (busy || !m.kb) return;
    step({ kind: "tap", data, message: { id: m.id, text: m.text, kb: m.kb } }, undefined, { kind: "tap", data });
  };

  const reset = useCallback(() => {
    state.current = null;
    setDb(null);
    setMsgs([]);
    setReplyTo(null);
    setToast(null);
    setPanel(null);
  }, []);
  useEffect(() => {
    if ((resetSignal ?? 0) !== lastReset.current) {
      lastReset.current = resetSignal ?? 0;
      reset();
    }
  }, [resetSignal, reset]);

  const changes = useMemo(() => {
    if (!db) return { groups: [] as { label: string; rows: string[] }[], removed: 0, total: 0 };
    const groups = Object.entries(db.rows)
      .filter(([t, rows]) => !HIDDEN.has(t) && rows.length)
      .map(([t, rows]) => ({ label: LABEL[t] ?? t, rows: rows.map((r) => sayRow(t, r)) }));
    const removed = Object.entries(db.gone).filter(([t]) => !HIDDEN.has(t)).reduce((n, [, ids]) => n + ids.length, 0);
    return { groups, removed, total: groups.reduce((n, g) => n + g.rows.length, 0) + removed };
  }, [db]);

  const field = "min-w-0 rounded-lg border border-line bg-app px-2 py-1.5 text-sm outline-none focus:border-accent";
  const chip = (id: NonNullable<typeof panel>, label: string, on: boolean) => (
    <button type="button" onClick={() => setPanel(panel === id ? null : id)} aria-pressed={panel === id} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-subtle hover:text-fg"}`}>
      {label}
    </button>
  );

  return (
    <div className="flex h-[min(80vh,760px)] min-h-[480px] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">OS</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Personal OS bot</div>
          <div className="text-[11px] leading-tight text-faint">practice · nothing is saved</div>
        </div>
        <button type="button" onClick={reset} className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-subtle hover:text-fg">Reset</button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
        {chip("clock", clock ? `🕐 ${clock.date} ${clock.time}` : "🕐 Now", Boolean(clock))}
        {chip("changes", `📝 Practice changes${changes.total ? ` (${changes.total})` : ""}`, changes.total > 0)}
      </div>

      {panel === "clock" && (
        <div className="space-y-2 border-b border-line bg-subtle px-3 py-2.5 text-sm">
          <p className="text-xs text-muted">Practice as if it were another day or hour (your local time). /now, /today and the night check follow it.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={clock?.date ?? ""} onChange={(e) => setClock({ date: e.target.value, time: clock?.time ?? "09:00" })} className={field} aria-label="Practice date" />
            <input type="time" value={clock?.time ?? ""} onChange={(e) => setClock({ date: clock?.date ?? new Date().toISOString().slice(0, 10), time: e.target.value || "09:00" })} className={field} aria-label="Practice time" />
            <button type="button" onClick={() => setClock(null)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:bg-surface">Use the real time</button>
          </div>
        </div>
      )}
      {panel === "changes" && (
        <div className="max-h-48 space-y-2 overflow-y-auto border-b border-line bg-subtle px-3 py-2.5 text-xs">
          {changes.total === 0 ? (
            <p className="text-muted">Nothing yet. Whatever the bot “saves”, changes or deletes while you practice shows up here. None of it is real.</p>
          ) : (
            <>
              {changes.groups.map((g) => (
                <div key={g.label}>
                  <div className="font-semibold text-fg">{g.label}</div>
                  <ul className="list-disc pl-4 text-muted">{g.rows.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              ))}
              {changes.removed > 0 && <p className="text-muted">🗑 {changes.removed} real item{changes.removed === 1 ? "" : "s"} deleted in practice (still there in the real app).</p>}
              <p className="text-faint">Practice only. Reset clears it.</p>
            </>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1 space-y-2 overflow-y-auto bg-subtle/60 px-3 py-3">
        {toast && <div className="sticky top-0 z-10 mx-auto w-fit max-w-[90%] rounded-full bg-fg px-3 py-1 text-center text-xs text-app shadow-card">{toast}</div>}
        {msgs.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            This is a copy of the Telegram bot. Type like you do in Telegram, pick a feature and press <b>Try it</b>, or start a <b>lesson</b>. It answers with your real data; nothing it “saves” is kept.
          </p>
        )}
        {msgs.map((m) =>
          m.from === "note" ? (
            <p key={m.key} className="text-center text-[11px] text-faint">{m.text}</p>
          ) : m.from === "why" ? (
            <p key={m.key} className="px-1 text-right text-[11px] italic text-faint">↳ {m.text}</p>
          ) : (
            <div key={m.key} className={`flex flex-col ${m.from === "me" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${m.from === "me" ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md border border-line bg-surface"}`}>{m.text}</div>
              {m.from === "bot" && m.id > 0 && (
                <button type="button" onClick={() => setReplyTo(m)} className="mt-0.5 px-1 text-[11px] text-faint hover:text-fg">↩ Reply</button>
              )}
              {m.kb && (
                <div className="mt-1 w-full max-w-[88%] space-y-1">
                  {m.kb.map((row, i) => (
                    <div key={i} className="flex gap-1">
                      {row.map((b, j) => (
                        <button key={j} type="button" disabled={busy} onClick={() => tap(m, b.callback_data)} className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-60">
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
        {panel === "photo" && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-3 py-2">
            <span className="w-full text-xs text-muted">No camera in practice: say what the receipt shows.</span>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Store, e.g. Supermaxi" className={`${field} flex-1`} aria-label="Store" />
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Total" inputMode="decimal" className={`${field} w-24`} aria-label="Total" />
            <button type="button" disabled={busy || !(Number(amount.replace(",", ".")) > 0)} onClick={sendPhoto} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-50">Send photo</button>
          </div>
        )}
        {panel === "voice" && (
          <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 text-xs text-muted">
            <span className="min-w-0 flex-1">No microphone in practice: type what you would say below, then press <b>Send as voice</b>.</span>
            <button type="button" disabled={busy || !text.trim()} onClick={sendVoice} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-50">Send as voice</button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1 px-2 pt-2">
          {menu.flat().map((label) => (
            <button key={label} type="button" disabled={busy} onClick={() => send(label)} className="truncate rounded-lg bg-subtle px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-subtle-2 hover:text-fg disabled:opacity-60">{label}</button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex items-end gap-1.5 p-2"
        >
          <button type="button" onClick={() => setPanel(panel === "voice" ? null : "voice")} aria-label="Voice note" title="Voice note" className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border text-base ${panel === "voice" ? "border-accent bg-accent-soft" : "border-line hover:bg-subtle"}`}>🎙</button>
          <button type="button" onClick={() => setPanel(panel === "photo" ? null : "photo")} aria-label="Receipt photo" title="Receipt photo" className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border text-base ${panel === "photo" ? "border-accent bg-accent-soft" : "border-line hover:bg-subtle"}`}>🧾</button>
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
            className="max-h-28 min-h-[38px] min-w-0 flex-1 resize-none rounded-2xl border border-line bg-app px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button type="submit" disabled={busy || !text.trim()} className="h-[38px] rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50">Send</button>
        </form>
      </div>
    </div>
  );
}
