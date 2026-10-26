"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { archiveTask, getRescheduleOptions, rescheduleTask, restoreTask, toggleTaskDone } from "@/app/task-actions";
import { dayLabel, emitCalendarChanged } from "@/components/calendar/util";
import { formatMinutes, timeToMinutes } from "@/lib/time";

type Props = {
  task: { id: string; title: string; status: string };
  /** Also show a ✓ Done button (for lists that have no checkbox of their own). */
  withDone?: boolean;
  /** Smaller buttons (calendar windows, chips). */
  small?: boolean;
  /** One "⋯" button; Done, Reschedule and Archive live in its menu (for tight spots like chips). */
  collapsed?: boolean;
  className?: string;
};

type Options = Awaited<ReturnType<typeof getRescheduleOptions>>;

/**
 * The actions every task has, in every view: Reschedule (next time its block happens, or another date),
 * Archive (won't do it), Done. Archived tasks get Restore instead.
 */
export default function TaskActions({ task, withDone = false, small = false, collapsed = false, className = "" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = task.status === "pending" || task.status === "backlog";
  const btn = `compact rounded-md ${small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"} transition-colors disabled:opacity-50`;

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  async function act(fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setNote(r.error ? { ok: false, text: r.error } : r.message ? { ok: true, text: r.message } : null);
    if (!r.error) {
      setMenu(null);
      emitCalendarChanged();
      router.refresh();
    }
  }

  function toggleMenu() {
    if (menu) return setMenu(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 288;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const below = r.bottom + 6;
    setMenu({ top: below + 260 > window.innerHeight ? Math.max(8, r.top - 266) : below, left });
  }

  if (task.status === "archived") {
    return (
      <span className={`inline-flex items-center gap-0.5 ${className}`}>
        <button disabled={busy} onClick={() => act(() => restoreTask({ taskId: task.id }))} className={`${btn} text-accent hover:bg-accent-soft`}>
          Restore
        </button>
        {note && <span className={`text-xs ${note.ok ? "text-success" : "text-danger"}`}>{note.text}</span>}
      </span>
    );
  }

  const menuEl =
    menu &&
    createPortal(
      <RescheduleMenu
        task={task}
        pos={menu}
        busy={busy}
        onClose={() => setMenu(null)}
        onNext={() => act(() => rescheduleTask({ taskId: task.id, mode: "next" }))}
        onDate={(date) => act(() => rescheduleTask({ taskId: task.id, mode: "date", date }))}
        extra={
          collapsed
            ? {
                onDone: () => act(() => toggleTaskDone({ taskId: task.id, done: true })),
                onArchive: () => act(() => archiveTask({ taskId: task.id })),
              }
            : undefined
        }
      />,
      document.body
    );

  if (collapsed) {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <button
          ref={btnRef}
          disabled={busy || !open}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu();
          }}
          aria-label={`Actions for ${task.title}`}
          title="Done · Reschedule · Archive"
          className="compact grid h-5 w-5 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg"
        >
          ⋯
        </button>
        {note && !note.ok && <span className="ml-1 text-[11px] text-danger">{note.text}</span>}
        {menuEl}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-0.5 ${className}`}>
      {withDone && (task.status === "pending" || task.status === "completed") && (
        <button
          disabled={busy}
          onClick={() => act(() => toggleTaskDone({ taskId: task.id, done: task.status !== "completed" }))}
          className={`${btn} ${task.status === "completed" ? "text-muted hover:bg-subtle" : "text-success hover:bg-success-soft"}`}
        >
          {task.status === "completed" ? "Undo done" : "✓ Done"}
        </button>
      )}
      {open && (
        <>
          <button
            ref={btnRef}
            disabled={busy}
            onClick={toggleMenu}
            aria-expanded={Boolean(menu)}
            className={`${btn} text-muted hover:bg-subtle hover:text-fg`}
          >
            Reschedule ▾
          </button>
          <button
            disabled={busy}
            onClick={() => act(() => archiveTask({ taskId: task.id }))}
            title="Not done and not deleted: you won't do it. Restore it from Tasks → Archived."
            className={`${btn} text-faint hover:bg-subtle hover:text-fg`}
          >
            Archive
          </button>
        </>
      )}
      {note && <span className={`basis-full text-xs ${note.ok ? "text-success" : "text-danger"}`}>{note.text}</span>}
      {menuEl}
    </span>
  );
}

function RescheduleMenu({
  task,
  pos,
  busy,
  onClose,
  onNext,
  onDate,
  extra,
}: {
  extra?: { onDone: () => void; onArchive: () => void };
  task: { id: string; title: string };
  pos: { top: number; left: number };
  busy: boolean;
  onClose: () => void;
  onNext: () => void;
  onDate: (date: string) => void;
}) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [date, setDate] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getRescheduleOptions(task.id).then((o) => {
      if (!alive) return;
      setOpts(o);
      if (o.today) {
        const d = new Date(`${o.today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        setDate(d.toISOString().slice(0, 10));
      }
    });
    return () => {
      alive = false;
    };
  }, [task.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Reschedule ${task.title}`}
      className="fixed z-[80] w-72 space-y-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-pop"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted">{extra ? task.title : `Move “${task.title}”`}</p>
      {extra && (
        <div className="flex gap-2">
          <button disabled={busy} onClick={extra.onDone} className="flex-1 rounded-md border border-success/40 px-2 py-1.5 text-sm font-medium text-success hover:bg-success-soft disabled:opacity-50">
            ✓ Done
          </button>
          <button disabled={busy} onClick={extra.onArchive} className="flex-1 rounded-md border border-edge px-2 py-1.5 text-sm text-muted hover:bg-subtle disabled:opacity-50">
            Archive
          </button>
        </div>
      )}
      {extra && <p className="text-xs font-medium text-muted">Reschedule</p>}

      {!opts ? (
        <p className="text-xs text-faint">Looking for the next time…</p>
      ) : opts.error ? (
        <p className="text-xs text-danger">{opts.error}</p>
      ) : opts.next ? (
        <button
          disabled={busy}
          onClick={onNext}
          className="w-full rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-left transition-colors hover:border-accent disabled:opacity-50"
        >
          <span className="block font-medium text-accent">Next {opts.blockName}</span>
          <span className="block text-xs text-muted">
            {dayLabel(opts.next.date)} · {formatMinutes(timeToMinutes(opts.next.start))}
          </span>
        </button>
      ) : (
        <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
          {opts.blockName ? `${opts.blockName} is not on the calendar in the next 8 weeks.` : "This task is not in a block, so there is no “next time”."}
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted">Or on a date</p>
        <div className="flex gap-2">
          <input
            type="date"
            value={date}
            min={opts?.today}
            onChange={(e) => setDate(e.target.value)}
            className="compact min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-sm"
          />
          <button
            disabled={busy || !date}
            onClick={() => onDate(date)}
            className="compact rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            Move
          </button>
        </div>
      </div>
      <p className="text-[11px] leading-snug text-faint">Counts as a move (+1). On a new date it leaves its current block; its home block picks it up that day.</p>
    </div>
  );
}
