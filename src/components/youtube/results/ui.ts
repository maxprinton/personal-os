// Shared class names for the results pages (Worker C).
export const BTN = "rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg hover:bg-subtle disabled:opacity-50";
export const BTN_SM = "rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-50";
export const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50";
export const BOX = "space-y-3 rounded-lg border border-line bg-surface p-4 shadow-card";
export const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-faint";
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const VERDICT_CLASS: Record<string, string> = {
  above: "bg-success-soft text-success",
  normal: "bg-subtle text-muted",
  below: "bg-danger-soft text-danger",
  insufficient: "bg-subtle text-faint",
};
