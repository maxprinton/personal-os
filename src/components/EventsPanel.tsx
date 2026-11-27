"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { removeEventType, saveEventType } from "@/app/calendar-actions";
import { loadPastEvents } from "@/app/events/actions";
import { splitEvents } from "@/lib/events-tabs";
import { formatMinutes } from "@/lib/time";
import type { CalEvent, CalResult, EventType, FinanceOptions } from "@/lib/calendar/types";
import EventDialog from "@/components/calendar/EventDialog";
import { emitCalendarChanged } from "@/components/calendar/util";

function when(e: CalEvent) {
  const d = (s: string) =>
    new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const days = e.end_date !== e.date ? `${d(e.date)} → ${d(e.end_date)}` : d(e.date);
  return e.start !== null && e.end !== null ? `${days} · ${formatMinutes(e.start)} – ${formatMinutes(e.end % 1440)}` : `${days} · no time`;
}

/** Events list + event types, with the same dialog the calendar uses. */
export default function EventsPanel({
  events,
  pastFrom,
  morePast,
  eventTypes,
  today,
  readOnly = false,
  finance,
}: {
  events: CalEvent[];
  /** First day already loaded in Past (older events come with "Load more"). */
  pastFrom: string;
  morePast: boolean;
  eventTypes: EventType[];
  today: string;
  readOnly?: boolean;
  finance?: FinanceOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<CalEvent | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [older, setOlder] = useState<CalEvent[]>([]);
  const [oldest, setOldest] = useState(pastFrom);
  const [more, setMore] = useState(morePast);
  const [loading, setLoading] = useState(false);
  const { overdue, upcoming, past } = useMemo(() => splitEvents([...events, ...older], today), [events, older, today]);

  async function loadMore() {
    setLoading(true);
    const r = await loadPastEvents(oldest);
    setLoading(false);
    if ("error" in r) return setMsg(r.error);
    setMsg(null);
    setOlder((o) => [...o, ...r.events]);
    setOldest(r.from);
    setMore(r.more);
  }

  async function run(fn: () => Promise<CalResult>) {
    const r = await fn();
    if (r.error) {
      setMsg(r.error);
      return false;
    }
    setMsg(null);
    emitCalendarChanged();
    router.refresh();
    return true;
  }

  const color = new Map(eventTypes.map((t) => [t.id, t.color]));

  return (
    <div className="space-y-6">
      {!readOnly && (
        <button onClick={() => setOpen("new")} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg">
          + New event
        </button>
      )}
      {msg && <p className="text-sm text-danger">{msg}</p>}
      <div role="tablist" className="flex gap-1 border-b border-line">
        {(["upcoming", "past"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {t === "upcoming" ? "Upcoming" : "Past"}
            {t === "upcoming" && overdue.length > 0 && (
              <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-[11px] text-warning">{overdue.length} overdue</span>
            )}
          </button>
        ))}
      </div>

      {tab === "upcoming" ? (
        <div className="space-y-4">
          {overdue.length > 0 && (
            <section className="space-y-2">
              <h2 className="section-title">Overdue</h2>
              <ul className="space-y-2">{overdue.map((e) => <EventRow key={e.id} e={e} today={today} color={color} onOpen={setOpen} />)}</ul>
            </section>
          )}
          <ul className="space-y-2">
            {upcoming.map((e) => <EventRow key={e.id} e={e} today={today} color={color} onOpen={setOpen} />)}
            {upcoming.length === 0 && <p className="text-sm text-muted">No upcoming events.</p>}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {past.map((e) => <EventRow key={e.id} e={e} today={today} color={color} onOpen={setOpen} />)}
            {past.length === 0 && <p className="text-sm text-muted">No past events yet.</p>}
          </ul>
          {more ? (
            <button
              onClick={loadMore}
              disabled={loading}
              className="rounded-md border border-edge px-3 py-2 text-sm transition-colors hover:bg-subtle disabled:opacity-60"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          ) : (
            past.length > 0 && <p className="text-xs text-faint">That's everything.</p>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="section-title">Event types</h2>
        <p className="text-xs text-muted">Each type has its own color on the calendar. New types are created by typing a new name in an event.</p>
        <ul className="space-y-2">
          {eventTypes.map((t) => (
            <EventTypeRow key={t.id} type={t} readOnly={readOnly} run={run} />
          ))}
          {eventTypes.length === 0 && <li className="text-sm text-faint">No types yet.</li>}
        </ul>
      </section>

      {open && (
        <EventDialog
          event={open === "new" ? undefined : open}
          initial={open === "new" ? { date: today } : undefined}
          eventTypes={eventTypes}
          readOnly={readOnly}
          run={run}
          finance={finance}
          today={today}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function EventTypeRow({
  type,
  readOnly,
  run,
}: {
  type: EventType;
  readOnly: boolean;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
}) {
  const [name, setName] = useState(type.name);
  const [color, setColor] = useState(type.color);
  if (readOnly) {
    return (
      <li className="flex items-center gap-2 text-sm">
        <span className="h-3 w-3 rounded-full" style={{ background: type.color }} /> {type.name}
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2">
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10" />
      <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-sm" />
      <button onClick={() => run(() => saveEventType({ id: type.id, name, color }))} className="rounded-md border border-edge transition-colors hover:bg-subtle px-2 py-1 text-xs">
        Save
      </button>
      <button
        onClick={() => window.confirm(`Remove the type "${type.name}"? Its events stay, without a type.`) && run(() => removeEventType({ id: type.id }))}
        className="text-xs text-muted hover:text-danger"
      >
        Remove
      </button>
    </li>
  );
}

function EventRow({
  e,
  today,
  color,
  onOpen,
}: {
  e: CalEvent;
  today: string;
  color: Map<string, string>;
  onOpen: (e: CalEvent) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onOpen(e)}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left hover:bg-subtle"
        style={{ borderColor: (e.event_type_id && color.get(e.event_type_id)) || "var(--line-strong)" }}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: (e.event_type_id && color.get(e.event_type_id)) || "#64748b" }} />
        <span className="flex-1">
          <span className="block font-medium">{e.title}</span>
          <span className="block text-sm text-muted">
            {when(e)}
            {e.end_date < today ? " · past" : ""}
          </span>
        </span>
        {e.is_payment && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              e.payment_status === "paid"
                ? "bg-success-soft text-success"
                : e.payment_status === "skipped"
                  ? "bg-subtle-2 text-muted"
                  : e.date <= today
                    ? "bg-warning-soft text-warning"
                    : "bg-subtle-2 text-muted"
            }`}
          >
            {e.payment_status === "paid" ? "✓ Paid" : e.payment_status === "skipped" ? "Skipped" : e.date <= today ? "💳 To pay" : "💳 Upcoming"}
          </span>
        )}
      </button>
    </li>
  );
}
