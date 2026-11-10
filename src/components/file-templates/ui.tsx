// Template Manager add-on — small shared UI pieces (server-safe, no hooks).
import { FORMAT_LABEL, GROUP_LABEL, PHASE_LABEL, STATUS_LABEL } from "@/lib/file-templates/constants";
import type { Format, Group, Lang, Phase, Status } from "@/lib/file-templates/types";

export const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg";
export const SELECT = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg";
export const LABEL = "space-y-1 text-xs text-muted";
export const BOX = "rounded-lg border border-line bg-surface p-4 shadow-card";
const BTN = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60";
export const BTN_PRIMARY = `${BTN} border-accent bg-accent text-accent-fg hover:bg-accent-hover`;
export const BTN_PLAIN = `${BTN} border-line-strong bg-surface text-fg hover:bg-subtle`;
export const BTN_DANGER = `${BTN} border-danger text-danger hover:bg-danger-soft`;
export const BTN_SMALL = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-fg hover:bg-subtle";

const PHASE_TONE: Record<Phase, string> = {
  INI: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PLN: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  EXE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  MON: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CLO: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
};

export function PhaseBadge({ phase, lang = "en" }: { phase: Phase | null; lang?: Lang }) {
  if (!phase) return <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">No phase</span>;
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_TONE[phase]}`}>{PHASE_LABEL[phase][lang]}</span>;
}

export function GroupBadge({ grp, lang = "en" }: { grp: Group; lang?: Lang }) {
  return <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs text-muted">{GROUP_LABEL[grp][lang]}</span>;
}

export function FormatBadge({ format }: { format: Format }) {
  return <span className="whitespace-nowrap rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-muted">{FORMAT_LABEL[format]}</span>;
}

const STATUS_TONE: Record<Status, string> = {
  inbox: "border-warning text-warning",
  reviewed: "border-line-strong text-muted",
  ready: "border-success text-success",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}
