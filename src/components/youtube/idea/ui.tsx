"use client";
// Small shared UI bits of Worker A's YouTube screens (idea, package, research).
import { useEffect, useRef, useState } from "react";

export const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-faint";
export const BOX = "space-y-3 rounded-lg border border-line bg-surface p-4 shadow-card";
export const LABEL = "block space-y-1 text-xs text-muted";
export const BTN = "rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg hover:bg-subtle disabled:opacity-50";
export const BTN_SM = "rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-50";
export const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50";
export const AI_BTN = "rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-sm text-accent hover:bg-accent-soft/70 disabled:opacity-50";

export function Chip({ on, onClick, children, title, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:bg-subtle hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

export function Msg({ error, info }: { error?: string | null; info?: string | null }) {
  if (error) return <p className="text-xs text-danger" role="alert">{error}</p>;
  if (info) return <p className="text-xs text-success">{info}</p>;
  return null;
}

export function Warn({ level, children }: { level: "info" | "warn"; children: React.ReactNode }) {
  return <p className={`text-xs ${level === "warn" ? "text-warning" : "text-muted"}`}>{level === "warn" ? "⚠ " : "ℹ "}{children}</p>;
}

/**
 * Text field that saves on blur (and after a short pause while typing). `onSave` returns an error or null.
 * Shows "Saved" / the error under the field.
 */
export function AutoField({
  value,
  onSave,
  multiline = false,
  rows = 3,
  placeholder,
  maxLength,
  className = INPUT,
  label,
  disabled,
}: {
  value: string;
  onSave: (v: string) => Promise<string | null | undefined>;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const last = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setV(value);
    }
  }, [value]);
  const save = async (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (next === last.current) return;
    setState("saving");
    const err = await onSave(next);
    if (err) setState(err);
    else {
      last.current = next;
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    }
  };
  const onChange = (next: string) => {
    setV(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 1500);
  };
  const common = { value: v, placeholder, maxLength, className, disabled, "aria-label": label, onBlur: () => void save(v) };
  return (
    <div className="space-y-0.5">
      {multiline ? <textarea rows={rows} {...common} onChange={(e) => onChange(e.target.value)} /> : <input {...common} onChange={(e) => onChange(e.target.value)} />}
      <p className="h-3 text-[10px] leading-3">
        {state === "saving" ? <span className="text-faint">Saving…</span> : state === "saved" ? <span className="text-success">Saved</span> : state !== "idle" ? <span className="text-danger">{state}</span> : null}
      </p>
    </div>
  );
}

/** ✨ preview box: AI suggestions wait here until accepted or discarded. */
export function AiPreview({ title, onDiscard, children }: { title: string; onDiscard: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-accent">✨ {title}</p>
        <button type="button" onClick={onDiscard} className={BTN_SM}>
          Discard all
        </button>
      </div>
      {children}
    </div>
  );
}
