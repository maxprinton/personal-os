"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeEventType, saveEventType } from "@/app/calendar-actions";
import { formatMinutes } from "@/lib/time";
import type { CalEvent, CalResult, EventType } from "@/lib/calendar/types";
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
  eventTypes,
  today,
  readOnly = false,
}: {
  events: CalEvent[];
  eventTypes: EventType[];
  today: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<CalEvent | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
        <button onClick={() => setOpen("new")} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white">
          + New event
        </button>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id}>
            <button
              onClick={() => setOpen(e)}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left hover:bg-neutral-50"
              style={{ borderColor: (e.event_type_id && color.get(e.event_type_id)) || "#a3a3a3" }}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: (e.event_type_id && color.get(e.event_type_id)) || "#64748b" }} />
              <span className="flex-1">
                <span className="block font-medium">{e.title}</span>
                <span className="block text-sm text-neutral-500">
                  {when(e)}
                  {e.end_date < today ? " · past" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
        {events.length === 0 && <p className="text-sm text-neutral-500">No upcoming events.</p>}
      </ul>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">Event types</h2>
        <p className="text-xs text-neutral-500">Each type has its own color on the calendar. New types are created by typing a new name in an event.</p>
        <ul className="space-y-2">
          {eventTypes.map((t) => (
            <EventTypeRow key={t.id} type={t} readOnly={readOnly} run={run} />
          ))}
          {eventTypes.length === 0 && <li className="text-sm text-neutral-400">No types yet.</li>}
        </ul>
      </section>

      {open && (
        <EventDialog
          event={open === "new" ? undefined : open}
          initial={open === "new" ? { date: today } : undefined}
          eventTypes={eventTypes}
          readOnly={readOnly}
          run={run}
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
      <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
      <button onClick={() => run(() => saveEventType({ id: type.id, name, color }))} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
        Save
      </button>
      <button
        onClick={() => window.confirm(`Remove the type "${type.name}"? Its events stay, without a type.`) && run(() => removeEventType({ id: type.id }))}
        className="text-xs text-neutral-500 hover:text-red-600"
      >
        Remove
      </button>
    </li>
  );
}
