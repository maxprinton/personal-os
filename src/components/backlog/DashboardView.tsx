"use client";

import { useState } from "react";
import type { BacklogActionResult } from "@/app/backlog-actions";
import CompactRow from "@/components/backlog/CompactRow";
import { STATUS_HINT, STATUS_LABEL, capMeter, peek, type BacklogItem } from "@/lib/backlog/board";
import type { BacklogStatus, Caps } from "@/lib/backlog/rules";

type Common = { items: BacklogItem[]; caps: Caps; nowIso: string; onResult: (r: BacklogActionResult) => void };

const DOT: Partial<Record<BacklogStatus, string>> = { now: "bg-accent", verifying: "bg-success-solid", next: "bg-fg", inbox: "bg-faint" };
const EMPTY: Partial<Record<BacklogStatus, string>> = {
  now: "Nothing in Now. Pick from Next.",
  verifying: "Nothing being tested.",
  next: "Nothing chosen yet. Plan one from Later or the Inbox.",
  inbox: "Inbox is empty.",
};

/** One stage as a compact card: header with count and cap meter, then one-line rows. */
export function StagePanel({
  status,
  list,
  count,
  cap,
  limit = 6,
  ...c
}: Common & { status: BacklogStatus; list: BacklogItem[]; count: number; cap: number | null; limit?: number }) {
  const [all, setAll] = useState(false);
  const meter = capMeter(count, cap);
  const { shown, hidden } = peek(list, all ? list.length : limit);
  return (
    <section className="card p-3" aria-label={STATUS_LABEL[status]}>
      <header className="mb-1 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${DOT[status] ?? "bg-faint"}`} aria-hidden />
        <h2 className="text-sm font-semibold">{STATUS_LABEL[status]}</h2>
        <span className={`text-xs tabular-nums ${meter?.full ? "font-medium text-warning" : "text-muted"}`}>{cap !== null ? `${count}/${cap}` : count}</span>
        {meter && (
          <span className="h-1 w-16 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <span className={`block h-full rounded-full ${meter.full ? "bg-warning-solid" : "bg-accent"}`} style={{ width: `${meter.pct}%` }} />
          </span>
        )}
        <span className="ml-auto hidden truncate text-xs text-faint lg:inline">{STATUS_HINT[status]}</span>
      </header>
      {list.length ? (
        <ul>
          {shown.map((it) => (
            <CompactRow key={it.id} item={it} {...c} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-2 text-sm text-faint">{EMPTY[status] ?? "Nothing here."}</p>
      )}
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="compact mt-1 px-2 text-xs text-muted underline">
          Show all {list.length}
        </button>
      )}
      {all && list.length > limit && (
        <button type="button" onClick={() => setAll(false)} className="compact mt-1 px-2 text-xs text-muted underline">
          Show fewer
        </button>
      )}
    </section>
  );
}

/** Later, Parked and Done in one card with tabs; 12 rows each, the rest on request. */
export function LaterTabs({ groups, ...c }: Common & { groups: Record<"later" | "parked" | "done", BacklogItem[]> }) {
  const [tab, setTab] = useState<"later" | "parked" | "done">("later");
  const [all, setAll] = useState(false);
  const list = groups[tab];
  const { shown, hidden } = peek(list, all ? list.length : 12);
  return (
    <section className="card p-3" aria-label="Later, Parked and Done">
      <div role="tablist" aria-label="More stages" className="mb-1 flex flex-wrap items-center gap-1 px-1">
        {(["later", "parked", "done"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => { setTab(t); setAll(false); }}
            className={`compact rounded-md px-2.5 py-1 text-sm transition-colors ${tab === t ? "bg-fg text-app" : "text-muted hover:bg-subtle hover:text-fg"}`}
          >
            {STATUS_LABEL[t]} <span className="tabular-nums opacity-70">{groups[t].length}</span>
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-faint lg:inline">{STATUS_HINT[tab]}</span>
      </div>
      {list.length ? (
        <ul>
          {shown.map((it) => (
            <CompactRow key={it.id} item={it} {...c} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-2 text-sm text-faint">Nothing here.</p>
      )}
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="compact mt-1 px-2 text-xs text-muted underline">
          Show all {list.length}
        </button>
      )}
    </section>
  );
}
