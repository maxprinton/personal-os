"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { bulkAssign, setVideosPosted } from "@/app/work-actions";
import WorkRow from "@/components/WorkRow";
import type { Suggestions } from "@/components/WorkForms";
import { monthKey, monthLabelEn, needsEvidence, shortDay, SHEET_TYPE_LABEL, type WorkClass } from "@/lib/work-log";

const GHOST = "rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-subtle disabled:opacity-50";
const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";

/** Selection + "mark as posted" for a set of classes. Used by the month list and by the “still to post” list. */
function useBulk() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setMany = (ids: string[], on: boolean) =>
    setSel((p) => {
      const n = new Set(p);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  function apply(ids: string[], posted: boolean) {
    setMsg(null);
    startTransition(async () => {
      const r = await setVideosPosted(ids, posted);
      if (r.error) setMsg({ text: r.error, error: true });
      else {
        setMsg({ text: r.info ?? "Done.", error: false });
        setSel(new Set());
      }
    });
  }
  return { sel, toggle, setMany, clear: () => setSel(new Set()), apply, busy, msg };
}

function Msg({ msg }: { msg: { text: string; error: boolean } | null }) {
  if (!msg) return null;
  return <p className={`text-xs ${msg.error ? "text-danger" : "text-success"}`}>{msg.text}</p>;
}

type Item = { c: WorkClass; ended: boolean };


/** Teacher / Sheet type for the selected classes: type a name (or pick one), or let every class take the teacher its code belongs to. */
function AssignPanel({ ids, people, onDone }: { ids: string[]; people: string[]; onDone: () => void }) {
  const [teacher, setTeacher] = useState("");
  const [type, setType] = useState("");
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  function run(useGroup: boolean) {
    setMsg(null);
    startTransition(async () => {
      const r = await bulkAssign(ids, { teacher: useGroup ? "" : teacher, useGroup, sheet_type: type });
      setMsg({ text: r.error ?? r.info ?? "Done.", error: !!r.error });
      if (!r.error) onDone();
    });
  }

  return (
    <details className="rounded-md border border-line p-3" open>
      <summary className="cursor-pointer text-sm font-medium">Teacher and type for the {ids.length} selected</summary>
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted">
            Teacher (Solicitud)
            <input
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              list="bulk-people"
              placeholder="Pick or type a new name"
              autoComplete="off"
              className="block w-52 rounded-md border border-line-strong px-2 py-1.5 text-sm text-fg"
            />
            <datalist id="bulk-people">
              {people.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1 text-xs text-muted">
            Type in the Sheet
            <select value={type} onChange={(e) => setType(e.target.value)} className="block rounded-md border border-line-strong px-2 py-1.5 text-sm text-fg">
              <option value="">Keep as it is</option>
              {(["extra", "collaboration", "recovery"] as const).map((k) => (
                <option key={k} value={k}>
                  {SHEET_TYPE_LABEL[k]}
                </option>
              ))}
              <option value="none">Not reported in the Sheet</option>
            </select>
          </label>
          <button type="button" className={PRIMARY} disabled={busy || !ids.length || (!teacher.trim() && !type)} onClick={() => run(false)}>
            {busy ? "…" : "Apply to selected"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={GHOST} disabled={busy || !ids.length} onClick={() => run(true)}>
            Give each one its code’s teacher
          </button>
          <span className="text-xs text-muted">Uses the teacher each code belongs to (see “Class codes → teacher”). The type above is applied too, if you chose one.</span>
        </div>
        <Msg msg={msg} />
      </div>
    </details>
  );
}

/** The month's classes with checkboxes: pick several (or all) and mark their videos as posted in one click. */
export function BulkClasses({ items, suggestions }: { items: Item[]; suggestions: Suggestions }) {
  const b = useBulk();
  const taught = items.filter((i) => i.c.status === "taught");
  const unposted = taught.filter((i) => !i.c.video_posted).map((i) => i.c.id);
  const posted = taught.filter((i) => i.c.video_posted).map((i) => i.c.id);
  const chosen = [...b.sel];
  const chosenUnposted = chosen.filter((id) => unposted.includes(id));
  const chosenPosted = chosen.filter((id) => posted.includes(id));
  const needLink = taught.filter((i) => b.sel.has(i.c.id) && !i.c.video_posted && needsEvidence(i.c.sheet_type) && !i.c.video_url).length;

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted">Select:</span>
          <button type="button" className={GHOST} onClick={() => b.setMany(taught.map((i) => i.c.id), true)}>
            All ({taught.length})
          </button>
          <button type="button" className={GHOST} disabled={!unposted.length} onClick={() => b.setMany(unposted, true)}>
            Not posted ({unposted.length})
          </button>
          <button type="button" className={GHOST} disabled={!b.sel.size} onClick={b.clear}>
            Clear
          </button>
          <span className="ml-auto text-muted">{b.sel.size} selected</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={b.busy || !chosenUnposted.length} onClick={() => b.apply(chosenUnposted, true)}>
            {b.busy ? "…" : `Mark ${chosenUnposted.length || ""} as posted`.replace("  ", " ")}
          </button>
          <button type="button" className={GHOST} disabled={b.busy || !chosenPosted.length} onClick={() => b.apply(chosenPosted, false)}>
            Undo posted{chosenPosted.length ? ` (${chosenPosted.length})` : ""}
          </button>
          <button
            type="button"
            className={`${GHOST} ml-auto`}
            disabled={b.busy || !unposted.length}
            onClick={() => {
              if (window.confirm(`Mark all ${unposted.length} unposted classes of this month as posted?`)) b.apply(unposted, true);
            }}
          >
            Mark the whole month as posted
          </button>
        </div>
        {b.sel.size > 0 && <AssignPanel ids={chosen} people={suggestions.people} onDone={b.clear} />}
        {needLink > 0 && (
          <p className="text-xs text-warning">
            {needLink} of the selected {needLink === 1 ? "is" : "are"} Hora Extra / Recuperación without a link: they get ticked, but they stay out of the company Excel until you add the Drive link.
          </p>
        )}
        <Msg msg={b.msg} />
      </div>
      <div className="space-y-3">
        {items.map(({ c, ended }) => (
          <div key={c.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-5 h-4 w-4 shrink-0 accent-[var(--accent)] disabled:opacity-30"
              checked={b.sel.has(c.id)}
              disabled={c.status !== "taught"}
              onChange={() => b.toggle(c.id)}
              aria-label={`Select ${c.group_name} ${shortDay(c.class_date)}`}
            />
            <ul className="min-w-0 flex-1">
              <WorkRow c={c} ended={ended} suggestions={suggestions} />
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** “Videos still to post” across all months, grouped by month: tick some, or clear a whole month in one click. */
export function PendingVideos({ classes, folder }: { classes: WorkClass[]; folder: string }) {
  const b = useBulk();
  const months = [...new Set(classes.map((c) => monthKey(c.class_date)))].sort().reverse();
  const allIds = classes.map((c) => c.id);

  return (
    <div className="space-y-2">
      <div className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={b.busy || !b.sel.size} onClick={() => b.apply([...b.sel], true)}>
            {b.busy ? "…" : `Mark ${b.sel.size || ""} as posted`.replace("  ", " ")}
          </button>
          <button type="button" className={GHOST} disabled={!allIds.length} onClick={() => b.setMany(allIds, true)}>
            Select all ({allIds.length})
          </button>
          <button type="button" className={GHOST} disabled={!b.sel.size} onClick={b.clear}>
            Clear
          </button>
          {folder && (
            <a href={folder} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-accent underline">
              Open the Drive folder ↗
            </a>
          )}
        </div>
        <p className="text-xs text-muted">Tick the ones whose video you already uploaded (or old months you want to clear) and mark them as posted — no link needed.</p>
        <Msg msg={b.msg} />
      </div>
      {months.map((m, i) => {
        const list = classes.filter((c) => monthKey(c.class_date) === m).sort((a, z) => (a.class_date + a.start_time < z.class_date + z.start_time ? 1 : -1));
        const ids = list.map((c) => c.id);
        const allOn = ids.every((id) => b.sel.has(id));
        return (
          <details key={m} open={i === 0} className="rounded-lg border border-line bg-surface shadow-card">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium">
              <span>{monthLabelEn(m)}</span>
              <span className="text-xs font-normal text-muted">{list.length} not posted</span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  className={GHOST}
                  onClick={(e) => {
                    e.preventDefault();
                    b.setMany(ids, !allOn);
                  }}
                >
                  {allOn ? "Unselect month" : "Select month"}
                </button>
                <button
                  type="button"
                  className={GHOST}
                  disabled={b.busy}
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.confirm(`Mark all ${list.length} classes of ${monthLabelEn(m)} as posted?`)) b.apply(ids, true);
                  }}
                >
                  Mark the month as posted
                </button>
              </span>
            </summary>
            <ul className="divide-y divide-line border-t border-line text-sm">
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-1.5">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={b.sel.has(c.id)} onChange={() => b.toggle(c.id)} aria-label={`Select ${c.group_name} ${shortDay(c.class_date)}`} />
                  <span className="font-medium">{c.group_name}</span>
                  <span className="text-muted">{shortDay(c.class_date)}</span>
                  <Link href={`/teaching?month=${m}`} className="ml-auto text-xs text-muted underline">
                    open
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
