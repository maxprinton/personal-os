"use client";
// Portfolio add-on — small shared UI: styles, a form that shows its own result, and the status badge.
import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { STATUS_LABEL, type PageStatus } from "@/lib/portfolio/types";

export const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg";
export const LABEL = "space-y-1 text-xs text-muted";
export const BOX = "rounded-lg border border-line bg-surface p-4 shadow-card";
const BTN = "rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60";
export const BTN_PRIMARY = `${BTN} border-accent bg-accent text-accent-fg hover:bg-accent-hover`;
export const BTN_PLAIN = `${BTN} border-line-strong bg-surface text-fg hover:bg-subtle`;
export const BTN_DANGER = `${BTN} border-danger text-danger hover:bg-danger-soft`;

const TONE: Record<PageStatus, string> = {
  no_note: "bg-subtle text-muted",
  draft: "bg-info-soft text-info",
  published: "bg-success-soft text-success",
  changed: "bg-warning-soft text-warning",
  unpublished: "bg-subtle text-muted",
  trashed: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: PageStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** A form bound to a server action; shows the error (or "Saved ✓") under its content. */
export function ActForm({
  action,
  children,
  className = "",
  saved = "Saved ✓",
  confirm,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: (pending: boolean) => React.ReactNode;
  className?: string;
  saved?: string;
  confirm?: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children(pending)}
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      {state.ok && !state.error && saved && <p className="mt-2 text-sm text-success">{saved}</p>}
    </form>
  );
}
