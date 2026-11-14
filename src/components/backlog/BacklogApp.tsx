"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addIdea, resolveVerifyAction, type BacklogActionResult } from "@/app/backlog-actions";
import Board from "@/components/backlog/Board";
import ItemRow from "@/components/backlog/ItemRow";
import SettingsForm from "@/components/backlog/SettingsForm";
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
import type { VerifyResult } from "@/lib/backlog/data";

type View = "list" | "board";

/** /backlog: quick add, the one-week check, list or board, filters, sort by value/effort, settings. */
export default function BacklogApp({ items, settings, nowIso }: { items: BacklogItem[]; settings: BacklogSettings; nowIso: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>("list");
  const [q, setQ] = useState("");
  const [type, setType] = useState<BacklogType | "">("");
  const [area, setArea] = useState("");
  const [size, setSize] = useState<BacklogSize | "">("");
  const [sort, setSort] = useState<"manual" | "score">("manual");
  const [stage, setStage] = useState<BacklogStatus | "">("");
  const [guide, setGuide] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [triage, setTriage] = useState<{ data: Triage; title: string } | null>(null);
  const caps = capsFrom(settings);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("backlog-view");
      if (v === "board" || v === "list") setView(v);
      if (localStorage.getItem("backlog-guide") === "hidden") setGuide(false);
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
  function toggleGuide(show: boolean) {
    setGuide(show);
    try {
      localStorage.setItem("backlog-guide", show ? "shown" : "hidden");
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

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backlog</h1>
          <p className="text-sm text-muted">
            Now {nonBugNow}/{settings.now_cap} · Verifying {counts.verifying.length}/{settings.verifying_cap} · Next {counts.next.length}/{settings.next_cap} · Inbox {counts.inbox.length}
          </p>
        </div>
        <div className="flex rounded-lg border border-edge p-0.5 text-sm" role="tablist" aria-label="View">
          {(["list", "board"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pickView(v)} className={`compact rounded-md px-3 py-1 capitalize ${view === v ? "bg-fg text-app" : "text-muted hover:text-fg"}`}>
              {v}
            </button>
          ))}
        </div>
      </header>

      <QuickAdd onResult={onResult} />

      {guide ? (
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-semibold">How this works</h2>
            <button type="button" onClick={() => toggleGuide(false)} className="text-muted underline">
              Hide
            </button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li><b className="text-fg">Write the idea</b> in the box above (or send <code>idea: …</code> to Telegram). It lands in the <b className="text-fg">Inbox</b>. No other decisions needed.</li>
            <li>Each row has a button with the <b className="text-fg">next step</b> (for example "Plan it →"). The menu next to it, <b className="text-fg">Move ▾</b>, shows every other place it can go. It asks for anything missing.</li>
            <li><b className="text-fg">Later</b> = a good idea, not now. <b className="text-fg">Next</b> = chosen, max 5, needs a size. <b className="text-fg">Now</b> = being built, max 2, needs a spec link. <b className="text-fg">Verifying</b> = built, use it for about a week.</li>
            <li>After a week, answer "Did it work?" and it becomes <b className="text-fg">Done</b>. If not, it goes back to Now. Ideas you decided against go to <b className="text-fg">Parked</b>, with a reason.</li>
            <li>Click a title to edit it and see its <b className="text-fg">history</b>. Click a stage in the strip below to look at only that stage.</li>
          </ol>
        </section>
      ) : (
        <button type="button" onClick={() => toggleGuide(true)} className="text-sm text-muted underline">
          How does this work?
        </button>
      )}

      <nav aria-label="Stages" className="flex flex-wrap items-center gap-1.5 text-sm">
        {([
          ["inbox", "Inbox", counts.inbox.length],
          ["later", "Later", counts.later.length],
          ["next", "Next", `${counts.next.length}/${settings.next_cap}`],
          ["now", "Now", `${nonBugNow}/${settings.now_cap}`],
          ["verifying", "Verifying", `${counts.verifying.length}/${settings.verifying_cap}`],
          ["done", "Done", counts.done.length],
          ["parked", "Parked", counts.parked.length],
        ] as [BacklogStatus, string, string | number][]).map(([st, label, n], i, all) => (
          <span key={st} className="flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={stage === st}
              onClick={() => setStage(stage === st ? "" : st)}
              className={`compact rounded-full border px-3 py-1 transition-colors ${stage === st ? "border-fg bg-fg text-app" : "border-edge hover:bg-subtle"}`}
            >
              {label} <span className={stage === st ? "" : "text-muted"}>{n}</span>
            </button>
            {i < all.length - 3 && <span className="text-faint" aria-hidden>→</span>}
          </span>
        ))}
        {stage && (
          <button type="button" onClick={() => setStage("")} className="ml-1 text-muted underline">
            Show all
          </button>
        )}
      </nav>

      {notice && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.bad ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success"}`}>
          {notice.text}
        </p>
      )}

      {due.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-line bg-accent-soft p-3">
          <h2 className="text-sm font-semibold">Did it work in real use?</h2>
          {due.map((i) => (
            <VerifyRow key={i.id} item={i} days={daysSince(i.verifying_since, now)} onResult={onResult} />
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, notes or BL-12…" aria-label="Search the backlog" className={`${inputCls} min-w-48 flex-1`} />
        <select value={type} onChange={(e) => setType(e.target.value as BacklogType | "")} aria-label="Type" className={`${inputCls} w-auto`}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value as BacklogSize | "")} aria-label="Size" className={`${inputCls} w-auto`}>
          <option value="">Any size</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {areas.length > 0 && (
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area" className={`${inputCls} w-auto`}>
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as "manual" | "score")} aria-label="Order" className={`${inputCls} w-auto`}>
          <option value="manual">My order</option>
          <option value="score">Best value / effort first</option>
        </select>
        {filtering && (
          <button type="button" onClick={() => { setQ(""); setType(""); setArea(""); setSize(""); }} className="text-muted underline">
            Clear
          </button>
        )}
      </div>

      {view === "board" ? (
        <Board items={filtered} caps={caps} onResult={onResult} onNotice={(text, bad = false) => setNotice({ text, bad })} />
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

      <SettingsForm settings={settings} />
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
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One sentence: what do you want? (Enter saves it to the Inbox)" aria-label="New idea" maxLength={200} className={`${inputCls} min-w-56 flex-1`} />
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
