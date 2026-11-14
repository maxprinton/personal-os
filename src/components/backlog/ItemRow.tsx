"use client";

import Link from "next/link";
import { useState } from "react";
import { moveItemAction, type BacklogActionResult } from "@/app/backlog-actions";
import MoveMenu, { MoveForm } from "@/components/backlog/MoveMenu";
import { TYPE_EMOJI, TYPE_LABEL, countsFor, daysSince, rankScore, type BacklogItem } from "@/lib/backlog/board";
import { moveOptions, type BacklogStatus, type Caps, type Missing } from "@/lib/backlog/rules";

/** The one natural step for each status, in plain words (Verifying and Done are answered with "did it work?"). */
const NEXT_STEP: Partial<Record<BacklogStatus, { to: BacklogStatus; label: string }>> = {
  inbox: { to: "later", label: "Keep for later" },
  later: { to: "next", label: "Plan it" },
  next: { to: "now", label: "Start it" },
  now: { to: "verifying", label: "Built it: test it" },
};

const chip = "rounded-full bg-subtle px-2 py-0.5 text-xs text-muted";

/** One backlog item in the list: code, title, size, area, how long it has been there, and the Move menu. */
export default function ItemRow({
  item,
  items,
  caps,
  nowIso,
  onResult,
  showScore = false,
}: {
  item: BacklogItem;
  items: BacklogItem[];
  caps: Caps;
  nowIso: string;
  onResult: (r: BacklogActionResult) => void;
  showScore?: boolean;
}) {
  const days = daysSince(item.status_changed_at, new Date(nowIso));
  const score = rankScore(item);
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
    <li className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-edge">
      <span className="text-lg leading-6" title={TYPE_LABEL[item.type]} aria-label={TYPE_LABEL[item.type]}>
        {TYPE_EMOJI[item.type]}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/backlog/${item.number}`} className="font-medium hover:underline">
          <span className="text-muted">BL-{item.number}</span> {item.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {item.size && <span className={chip}>{item.size}</span>}
          {item.area && <span className={chip}>{item.area}</span>}
          {item.spec_link?.startsWith("/") && <Link href={item.spec_link} className={`${chip} underline`}>spec</Link>}
          {item.reopened_count > 0 && <span className={chip}>reopened {item.reopened_count}×</span>}
          {(showScore || score !== null) && score !== null && <span className={chip}>value {item.value} / effort {item.effort}</span>}
          <span className="text-xs text-faint">
            {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} in {item.status}
          </span>
        </div>
        {item.status === "parked" && item.parked_reason && <p className="mt-1 text-xs text-muted">Why: {item.parked_reason}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        {step && (
          <button type="button" disabled={busy} onClick={primary} className="compact rounded-md border border-edge bg-surface px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent-soft disabled:opacity-50">
            {busy ? "…" : `${step.label} →`}
          </button>
        )}
        <MoveMenu item={item} items={items} caps={caps} onResult={onResult} />
      </div>
      {form && (
        <div className="w-full basis-full rounded-lg border border-line bg-subtle p-3">
          <MoveForm item={item} to={form.to} missing={form.missing} onCancel={() => setForm(null)} onResult={(r) => { setForm(null); onResult(r); }} />
        </div>
      )}
    </li>
  );
}
