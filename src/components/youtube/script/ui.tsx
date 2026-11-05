"use client";
// Small shared UI bits of Worker B's YouTube screens (script, intro, shots, edit, music).
import { useEffect, useState } from "react";

export const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-faint";
export const BOX = "space-y-3 rounded-lg border border-line bg-surface p-4 shadow-card";
export const BTN = "rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg hover:bg-subtle disabled:opacity-50";
export const BTN_SM = "rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-50";
export const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50";
export const AI_BTN = "rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-sm text-accent hover:bg-accent-soft/70 disabled:opacity-50";

export function Msg({ error, info }: { error?: string | null; info?: string | null }) {
  if (error) return <p className="text-xs text-danger" role="alert">{error}</p>;
  if (info) return <p className="text-xs text-success">{info}</p>;
  return null;
}

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

/** Input / textarea that keeps its own text and saves on blur (only when it changed). */
export function BlurField({
  value,
  onSave,
  multiline = false,
  rows = 2,
  placeholder,
  maxLength,
  className = INPUT,
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => Promise<string | null | undefined> | void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  const save = async () => {
    setFocused(false);
    if (text === value) return;
    const e = await onSave(text);
    setErr(e || null);
  };
  const common = {
    value: text,
    placeholder,
    maxLength,
    "aria-label": ariaLabel ?? placeholder,
    className,
    onFocus: () => setFocused(true),
    onBlur: save,
  };
  return (
    <>
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => setText(e.target.value)} />
      ) : (
        <input
          {...common}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {err && <Msg error={err} />}
    </>
  );
}

/** Modal dialog (click outside or Esc closes). */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className={BTN_SM} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
