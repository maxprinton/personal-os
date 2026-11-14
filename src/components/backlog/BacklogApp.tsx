"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addIdea, resolveVerifyAction, type BacklogActionResult } from "@/app/backlog-actions";
import ActivityPanel from "@/components/backlog/ActivityPanel";
import Board from "@/components/backlog/Board";
import { LaterTabs, StagePanel } from "@/components/backlog/DashboardView";
import ItemRow from "@/components/backlog/ItemRow";
import SettingsForm from "@/components/backlog/SettingsForm";
import StepsPanel from "@/components/backlog/StepsPanel";
import TestMissions from "@/components/backlog/TestMissions";
import TriagePrompt from "@/components/backlog/TriagePrompt";
import { btnPrimary, inputCls } from "@/components/calendar/Modal";
import {
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_ORDER,
  TYPE_LABEL,
  areasOf,
  capsFrom,
  daysSince,
  filterItems,
  groupByStatus,
  sortByScore,
  verifyDueItems,
  type BacklogItem,
  type BacklogSettings,
  type Triage,
} from "@/lib/backlog/board";
import { SIZES, TYPES, type BacklogSize, type BacklogStatus, type BacklogType } from "@/lib/backlog/rules";
import type { ActivityRow, StepRow, TestRow, VerifyResult } from "@/lib/backlog/data";

type View = "dashboard" | "list" | "board";

/** Everything the dashboard cards need besides the items themselves. */
export type DashboardData = { tests: TestRow[]; pendingSteps: StepRow[]; doneSteps: StepRow[]; activity: ActivityRow[]; working: ActivityRow[] };

/** /backlog: quick add, the one-week check, list or board, filters, sort by value/effort, settings. */
export default function BacklogApp({ items, settings, nowIso, data }: { items: BacklogItem[]; settings: BacklogSettings; nowIso: string; data: DashboardData }) {
  const router = useRouter();
  const [view, setView] = useState<View>("dashboard");
  const [q, setQ] = useState("");
  const [type, setType] = useState<BacklogType | "">("");
  const [area, setArea] = useState("");
  const [size, setSize] = useState<BacklogSize | "">("");
  const [sort, setSort] = useState<"manual" | "score">("manual");
  const [stage, setStage] = useState<BacklogStatus | "">("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [triage, setTriage] = useState<{ data: Triage; title: string } | null>(null);
  const caps = capsFrom(settings);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("backlog-view");
      if (v === "board" || v === "list" || v === "dashboard") setView(v);
    } catch {
      // storage is only a convenience
    }
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  function pickView(v: View) {
    setView(v);
    try {
      localStorage.setItem("backlog-view", v);
    } catch {
      // ignore
    }
  }
  function onResult(r: BacklogActionResult) {
    if (r.error) setNotice({ text: r.error, bad: true });
    else if (r.message) setNotice({ text: r.message, bad: false });
    if (!r.error) router.refresh();
    if (r.triage) setTriage({ data: r.triage, title: "30 seconds: what's next?" });
  }

  const filtered = useMemo(() => filterItems(items, { q, type, area, size }), [items, q, type, area, size]);
  const groups = useMemo(() => groupByStatus(filtered), [filtered]);
  const counts = groupByStatus(items);
  const nonBugNow = counts.now.filter((i) => i.type !== "bug").length;
  const due = verifyDueItems(items, now, settings.verify_days);
  const areas = areasOf(items);
  const filtering = Boolean(q || type || area || size);

  const rowProps = { items, caps, nowIso, onResult };
  const dash = {
    now: filtered.filter((i) => i.status === "now"),
    verifying: filtered.filter((i) => i.status === "verifying"),
    next: filtered.filter((i) => i.status === "next"),
    inbox: filtered.filter((i) => i.status === "inbox"),
  };
  const popover = "absolute right-0 top-full z-30 mt-2 rounded-2xl border border-line bg-surface p-3 shadow-xl";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Backlog</h1>
        <nav aria-label="Stages" className="flex flex-wrap items-center gap-1 text-sm">
          {([
            ["inbox", "Inbox", counts.inbox.length],
            ["later", "Later", counts.later.length],
            ["next", "Next", `${counts.next.length}/${settings.next_cap}`],
            ["now", "Now", `${nonBugNow}/${settings.now_cap}`],
            ["verifying", "Verifying", `${counts.verifying.length}/${settings.verifying_cap}`],
            ["done", "Done", counts.done.length],
            ["parked", "Parked", counts.parked.length],
          ] as [BacklogStatus, string, string | number][]).map(([st, label, n]) => (
            <button
              key={st}
              type="button"
              aria-pressed={stage === st}
              title={stage === st ? "Show all stages" : `Show only ${label}`}
              onClick={() => { setStage(stage === st ? "" : st); if (view === "dashboard") pickView("list"); }}
              className={`compact rounded-full border px-2.5 py-0.5 tabular-nums transition-colors ${stage === st ? "border-fg bg-fg text-app" : "border-edge hover:bg-subtle"}`}
            >
              {label} <span className={stage === st ? "" : "text-muted"}>{n}</span>
            </button>
          ))}
          {stage && (
            <button type="button" onClick={() => setStage("")} className="ml-1 text-xs text-muted underline">
              Show all
            </button>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-edge p-0.5 text-sm" role="tablist" aria-label="View">
            {(["dashboard", "list", "board"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pickView(v)} className={`compact rounded-md px-3 py-1 capitalize ${view === v ? "bg-fg text-app" : "text-muted hover:text-fg"}`}>
                {v}
              </button>
            ))}
          </div>
          <details className="relative">
            <summary className="compact cursor-pointer select-none rounded-lg border border-edge px-2.5 py-1 text-sm" title="How this works" aria-label="How this works">?</summary>
            <div className={`${popover} w-[min(36rem,90vw)] space-y-1 text-sm`}>
              <h2 className="font-semibold">How this works</h2>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li><b className="text-fg">Write the idea</b> in the box (or send <code>idea: …</code> to Telegram). It lands in the <b className="text-fg">Inbox</b>.</li>
                <li>Each row has a button with the <b className="text-fg">next step</b> and a <b className="text-fg">⋯</b> menu with every other place it can go. It asks for anything missing.</li>
                <li><b className="text-fg">Later</b> = good idea, not now. <b className="text-fg">Next</b> = chosen, needs a size. <b className="text-fg">Now</b> = being built, needs a spec link. <b className="text-fg">Verifying</b> = built, use it for about a week.</li>
                <li>After a week, answer "Did it work?" and it becomes <b className="text-fg">Done</b>. If not, it goes back to Now. Ideas you decided against go to <b className="text-fg">Parked</b>, with a reason.</li>
                <li>Click a title to edit it and see its <b className="text-fg">history</b>.</li>
              </ol>
            </div>
          </details>
          <details className="relative">
            <summary className="compact cursor-pointer select-none rounded-lg border border-edge px-2.5 py-1 text-sm" title="Backlog settings" aria-label="Backlog settings">⚙</summary>
            <div className={`${popover} w-[min(40rem,92vw)]`}>
              <SettingsForm settings={settings} />
            </div>
          </details>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="min-w-[18rem] flex-[2]">
          <QuickAdd onResult={onResult} />
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, notes or BL-12…" aria-label="Search the backlog" className={`${inputCls} min-w-44 flex-1`} />
        <details className="relative">
          <summary className={`compact cursor-pointer select-none rounded-lg border px-3 py-2 text-sm ${filtering || sort === "score" ? "border-fg" : "border-edge"}`}>
            Filters{filtering || sort === "score" ? " •" : ""}
          </summary>
          <div className={`${popover} flex w-64 flex-col gap-2`}>
            <select value={type} onChange={(e) => setType(e.target.value as BacklogType | "")} aria-label="Type" className={inputCls}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <select value={size} onChange={(e) => setSize(e.target.value as BacklogSize | "")} aria-label="Size" className={inputCls}>
              <option value="">Any size</option>
              {SIZES.map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
            {areas.length > 0 && (
              <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area" className={inputCls}>
                <option value="">All areas</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value as "manual" | "score")} aria-label="Order" className={inputCls}>
              <option value="manual">My order</option>
              <option value="score">Best value / effort first</option>
            </select>
            {filtering && (
              <button type="button" onClick={() => { setQ(""); setType(""); setArea(""); setSize(""); }} className="text-left text-muted underline">
                Clear filters
              </button>
            )}
          </div>
        </details>
      </div>

      {notice && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.bad ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] items-start gap-3">
        {due.length > 0 && (
          <section className="card bg-accent-soft p-3" aria-label="Did it work in real use?">
            <h2 className="mb-1 text-sm font-semibold">Did it work in real use?</h2>
            <div className="space-y-2">
              {due.map((i) => (
                <VerifyRow key={i.id} item={i} days={daysSince(i.verifying_since, now)} onResult={onResult} />
              ))}
            </div>
          </section>
        )}
        <StepsPanel pending={data.pendingSteps} recent={data.doneSteps} nowIso={nowIso} compact />
        <TestMissions tests={data.tests} full compact />
        <ActivityPanel rows={data.activity} working={data.working} nowIso={nowIso} compact />
      </div>

      {view === "board" ? (
        <Board items={filtered} caps={caps} onResult={onResult} onNotice={(text, bad = false) => setNotice({ text, bad })} />
      ) : view === "dashboard" && !stage ? (
        <div className="space-y-3">
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <StagePanel status="now" list={dash.now} count={dash.now.filter((i) => i.type !== "bug").length} cap={settings.now_cap} {...rowProps} />
              <StagePanel status="verifying" list={dash.verifying} count={dash.verifying.length} cap={settings.verifying_cap} {...rowProps} />
              <StagePanel status="next" list={dash.next} count={dash.next.length} cap={settings.next_cap} {...rowProps} />
            </div>
            <StagePanel status="inbox" list={sort === "score" ? sortByScore(dash.inbox) : dash.inbox} count={dash.inbox.length} cap={null} limit={10} {...rowProps} />
          </div>
          <LaterTabs groups={{ later: sort === "score" ? sortByScore(groups.later) : groups.later, parked: groups.parked, done: groups.done }} {...rowProps} />
          {filtering && filtered.length === 0 && <p className="text-sm text-muted">Nothing matches those filters.</p>}
        </div>
      ) : (
        <div className="space-y-5">
          {STATUS_ORDER.filter((st) => !stage || st === stage).map((st) => {
            const full = sort === "score" ? sortByScore(groups[st]) : groups[st];
            const LIMIT = 8;
            const open = Boolean(expanded[st]) || Boolean(stage) || full.length <= LIMIT;
            const list = open ? full : full.slice(0, LIMIT);
            if (!full.length && !stage && (filtering || st === "parked" || st === "done")) return null;
            const body = (
              <>
                {list.length ? (
                  <ul className="space-y-2">
                    {list.map((it) => (
                      <ItemRow key={it.id} item={it} items={items} caps={caps} nowIso={nowIso} onResult={onResult} showScore={sort === "score"} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-faint">{STATUS_HINT[st]}. Nothing here yet.</p>
                )}
                {!open && (
                  <button type="button" onClick={() => setExpanded({ ...expanded, [st]: true })} className="mt-2 text-sm text-muted underline">
                    Show all {full.length}
                  </button>
                )}
              </>
            );
            const label = `${STATUS_LABEL[st]} (${full.length})`;
            if ((st === "done" || st === "parked") && !stage) {
              return (
                <details key={st} className="group">
                  <summary className="section-title cursor-pointer select-none">{label}</summary>
                  <div className="mt-2">{body}</div>
                </details>
              );
            }
            return (
              <section key={st} className="space-y-2">
                <h2 className="section-title">
                  {label} <span className="text-sm font-normal text-muted">{STATUS_HINT[st]}</span>
                </h2>
                {body}
              </section>
            );
          })}
          {filtering && filtered.length === 0 && <p className="text-sm text-muted">Nothing matches those filters.</p>}
        </div>
      )}

      {triage && <TriagePrompt triage={triage.data} title={triage.title} onClose={() => setTriage(null)} />}
    </div>
  );
}

function QuickAdd({ onResult }: { onResult: (r: BacklogActionResult) => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<BacklogType>("feature");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const r = await addIdea({ title, type });
    setBusy(false);
    if (!r.error) setTitle("");
    onResult(r);
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New idea: one sentence, Enter saves it to the Inbox" aria-label="New idea" maxLength={200} className={`${inputCls} min-w-56 flex-1`} />
      <select value={type} onChange={(e) => setType(e.target.value as BacklogType)} aria-label="Type of the new idea" className={`${inputCls} w-auto`}>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <button disabled={busy || !title.trim()} className={btnPrimary}>
        {busy ? "Saving…" : "Add"}
      </button>
    </form>
  );
}

function VerifyRow({ item, days, onResult }: { item: BacklogItem; days: number; onResult: (r: BacklogActionResult) => void }) {
  const [busy, setBusy] = useState(false);
  async function answer(result: VerifyResult) {
    setBusy(true);
    const r = await resolveVerifyAction({ number: item.number, result });
    setBusy(false);
    onResult(r);
  }
  const b = "compact rounded-md border border-edge bg-surface px-2 py-1 text-xs transition-colors hover:bg-subtle disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        BL-{item.number} {item.title} <span className="text-muted">· {days} days in real use</span>
      </span>
      <span className="flex gap-1.5">
        <button type="button" disabled={busy} onClick={() => answer("worked")} className={b}>
          ✅ It worked
        </button>
        <button type="button" disabled={busy} onClick={() => answer("failed")} className={b}>
          ❌ It did not
        </button>
        <button type="button" disabled={busy} onClick={() => answer("later")} className={b}>
          ⏳ +3 days
        </button>
      </span>
    </div>
  );
}
