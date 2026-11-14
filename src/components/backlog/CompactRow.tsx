"use client";

import Link from "next/link";
import { useState } from "react";
import { moveItemAction, type BacklogActionResult } from "@/app/backlog-actions";
import MoveMenu, { MoveForm } from "@/components/backlog/MoveMenu";
import { TYPE_EMOJI, TYPE_LABEL, countsFor, daysSince, type BacklogItem } from "@/lib/backlog/board";
import { moveOptions, type BacklogStatus, type Caps, type Missing } from "@/lib/backlog/rules";

/** The one natural step for each status (same words as the list row). */
const NEXT_STEP: Partial<Record<BacklogStatus, { to: BacklogStatus; label: string }>> = {
  inbox: { to: "later", label: "Later" },
  later: { to: "next", label: "Plan it" },
  next: { to: "now", label: "Start" },
  now: { to: "verifying", label: "Test it" },
};

const chip = "shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-[11px] leading-none text-muted";

/** Shortens a long area name for the one-line row (the full text stays in the tooltip). */
export function shortArea(area: string | null, max = 12): string {
  if (!area) return "";
  return area.length > max ? `${area.slice(0, max - 1)}…` : area;
}

/** One backlog item on ONE line: icon, BL-n, title (truncated), size, area, days, next step, Move menu. */
export default function CompactRow({
  item,
  items,
  caps,
  nowIso,
  onResult,
}: {
  item: BacklogItem;
  items: BacklogItem[];
  caps: Caps;
  nowIso: string;
  onResult: (r: BacklogActionResult) => void;
}) {
  const days = daysSince(item.status_changed_at, new Date(nowIso));
  const step = NEXT_STEP[item.status];
  const [form, setForm] = useState<{ to: BacklogStatus; missing: Missing[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function primary() {
    if (!step) return;
    const opt = moveOptions(item, countsFor(items, item.id), caps).find((o) => o.to === step.to);
    if (!opt) return onResult({ error: `Cannot move from ${item.status} to ${step.to}.` });
    if (!opt.ok) return onResult({ error: opt.message ?? "Not allowed right now." });
    if (opt.missing.length) return setForm({ to: step.to, missing: opt.missing });
    setBusy(true);
    const r = await moveItemAction({ number: item.number, to: step.to });
    setBusy(false);
    onResult(r);
  }
  return (
    <li className="rounded-lg transition-colors hover:bg-subtle">
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
        <span className="w-5 shrink-0 text-center" title={TYPE_LABEL[item.type]} aria-label={TYPE_LABEL[item.type]}>
          {TYPE_EMOJI[item.type]}
        </span>
        <Link href={`/backlog/${item.number}`} title={item.title} className="min-w-0 flex-1 truncate font-medium hover:underline">
          <span className="tabular-nums font-normal text-muted">BL-{item.number}</span> {item.title}
        </Link>
        {item.reopened_count > 0 && <span className={chip} title={`Reopened ${item.reopened_count} time(s)`}>↺{item.reopened_count}</span>}
        {item.size && <span className={chip}>{item.size}</span>}
        {item.area && (
          <span className={`${chip} hidden md:inline`} title={item.area}>
            {shortArea(item.area)}
          </span>
        )}
        {item.spec_link?.startsWith("/") && (
          <Link href={item.spec_link} className={`${chip} underline`} title="Open the spec note">
            spec
          </Link>
        )}
        <span className="hidden w-9 shrink-0 text-right text-xs tabular-nums text-faint sm:inline" title={`${days} day(s) in ${item.status}`}>
          {days === 0 ? "today" : `${days}d`}
        </span>
        {step && (
          <button type="button" disabled={busy} onClick={primary} className="compact shrink-0 rounded-md border border-edge bg-surface px-2 py-0.5 text-xs font-medium transition-colors hover:bg-accent-soft disabled:opacity-50">
            {busy ? "…" : `${step.label} →`}
          </button>
        )}
        <MoveMenu item={item} items={items} caps={caps} onResult={onResult} />
      </div>
      {item.status === "parked" && item.parked_reason && <p className="truncate px-9 pb-1.5 text-xs text-muted" title={item.parked_reason}>Why: {item.parked_reason}</p>}
      {form && (
        <div className="mx-2 mb-2 rounded-lg border border-line bg-subtle p-3">
          <MoveForm item={item} to={form.to} missing={form.missing} onCancel={() => setForm(null)} onResult={(r) => { setForm(null); onResult(r); }} />
        </div>
      )}
    </li>
  );
}
