"use client";

import { useState } from "react";
import { removeEvent, saveEvent } from "@/app/calendar-actions";
import { minutesToTime } from "@/lib/time";
import type { CalendarData, CalEvent, CalResult, EventType, FinanceOptions } from "@/lib/calendar/types";
import { tasksForEvent, unassignedOn } from "@/lib/calendar/taskview";
import Modal, { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";
import TaskList from "@/components/calendar/TaskList";
import { PaymentDraft, PaymentForm } from "@/components/PaymentForms";

import { WritingInput } from "@/components/WritingField";
/** Create or edit an event. Without time it is just metadata of the day(s). */
export default function EventDialog({
  event,
  initial,
  eventTypes,
  readOnly,
  run,
  onClose,
  data,
  finance,
  today,
}: {
  data?: CalendarData;
  /** For the payment section when there is no calendar data (Events page). */
  finance?: FinanceOptions;
  today?: string;
  event?: CalEvent;
  initial?: { date: string; start?: number; end?: number; title?: string };
  eventTypes: EventType[];
  readOnly: boolean;
  run: (fn: () => Promise<CalResult>) => Promise<boolean>;
  onClose: () => void;
}) {
  const typeName = event?.event_type_id ? eventTypes.find((t) => t.id === event.event_type_id)?.name ?? "" : "";
  const [title, setTitle] = useState(event?.title ?? initial?.title ?? "");
  const [type, setType] = useState(typeName);
  const [typeColor, setTypeColor] = useState("#64748b");
  const [date, setDate] = useState(event?.date ?? initial?.date ?? "");
  const [endDate, setEndDate] = useState(event?.end_date ?? initial?.date ?? "");
  const [hasTime, setHasTime] = useState(event ? event.start !== null : initial?.start !== undefined);
  const [start, setStart] = useState(
    event?.start != null ? minutesToTime(event.start) : initial?.start !== undefined ? minutesToTime(initial.start) : "09:00"
  );
  const [end, setEnd] = useState(
    event?.end != null ? minutesToTime(event.end) : initial?.end !== undefined ? minutesToTime(initial.end) : "10:00"
  );
  const [busy, setBusy] = useState(false);
  const [isPayment, setIsPayment] = useState(false);

  const match = eventTypes.find((t) => t.name.toLowerCase() === type.trim().toLowerCase());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() =>
      saveEvent({
        id: event?.id,
        title,
        typeName: type.trim() || undefined,
        typeColor: match ? undefined : typeColor,
        date,
        endDate: endDate || date,
        hasTime,
        start,
        end,
      })
    );
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!event || !window.confirm(`Delete "${event.title}"?`)) return;
    setBusy(true);
    const ok = await run(() => removeEvent({ id: event.id }));
    setBusy(false);
    if (ok) onClose();
  }

  // Payment events: the pre-filled transaction (or what was paid), from the calendar or the Events page
  const fin = data?.finance ?? finance;
  const todayStr = data?.today ?? today;
  const template = event?.payment_template_id ? fin?.templates.find((t) => t.id === event.payment_template_id) ?? null : null;
  const paymentSection =
    event?.is_payment && fin && todayStr ? (
      <section className="rounded-lg border border-success/30 bg-success-soft p-3">
        <PaymentDraft
          eventId={event.id}
          title={event.title}
          date={event.date}
          template={template}
          options={fin}
          today={todayStr}
          status={event.payment_status ?? null}
          expected={event.payment_expected_amount ?? null}
          readOnly={readOnly}
          onDone={onClose}
        />
      </section>
    ) : null;

  // An event with tasks behaves like a block for them (they join the end-of-day check too)
  const taskDay = event && data ? (data.today >= event.date && data.today <= event.end_date ? data.today : event.date) : null;
  const taskSection =
    event && data && taskDay ? (
      <section className="space-y-2 rounded-lg border border-line p-3">
        <h3 className="text-sm font-medium">Tasks in this event</h3>
        <TaskList
          tasks={tasksForEvent(event.id, taskDay, data.tasks)}
          logs={data.taskLogs.filter((l) => l.event_id === event.id)}
          unassigned={taskDay >= data.today ? unassignedOn(data.today, data.today, data.tasks) : []}
          target={{ eventId: event.id, date: taskDay }}
          canEdit={!readOnly && taskDay >= data.today}
          canTick={!readOnly}
          run={run}
        />
      </section>
    ) : null;

  if (readOnly && event) {
    return (
      <Modal title={event.title} onClose={onClose}>
        <p className="text-sm text-muted">
          {event.date}
          {event.end_date !== event.date ? ` → ${event.end_date}` : ""}
          {event.start !== null && event.end !== null ? ` · ${minutesToTime(event.start)}–${minutesToTime(event.end)}` : " · no time"}
          {typeName ? ` · ${typeName}` : ""}
        </p>
        {paymentSection}
        {taskSection}
      </Modal>
    );
  }

  if (!event && isPayment && fin && todayStr) {
    return (
      <Modal title="New payment" onClose={onClose} wide>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked onChange={() => setIsPayment(false)} /> It's a payment
        </label>
        <PaymentForm options={fin} date={date || todayStr} run={run} onDone={onClose} />
      </Modal>
    );
  }

  return (
    <Modal title={event ? "Edit event" : "New event"} onClose={onClose}>
      {!event && fin && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={false} onChange={() => setIsPayment(true)} /> It's a payment (amount, account, repeats)
        </label>
      )}
      {paymentSection}
      <form onSubmit={submit} className="space-y-3 text-sm">
        <WritingInput area="calendar" autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Flight to Lima, Dentist" className={inputCls} />
        <div>
          <input
            list="event-type-names"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="Type (optional): Travel, Health, Social…"
            className={inputCls}
          />
          <datalist id="event-type-names">
            {eventTypes.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          {match ? (
            <p className="mt-1 flex items-center gap-2 text-xs text-muted">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: match.color }} /> {match.name}
            </p>
          ) : type.trim() ? (
            <label className="mt-1 flex items-center gap-2 text-xs text-muted">
              New type · color <input type="color" value={typeColor} onChange={(e) => setTypeColor(e.target.value)} />
            </label>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-muted">
            Until (optional)
            <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} /> Has a time
        </label>
        {hasTime ? (
          <div className="grid grid-cols-2 gap-2">
            <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
            <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </div>
        ) : (
          <p className="text-xs text-muted">Without a time it shows on top of the day, like a note.</p>
        )}
        <div className="flex items-center justify-between gap-2">
          {event ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-danger">
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnSecondary}>
              Cancel
            </button>
            <button disabled={busy} className={btnPrimary}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
      {taskSection}
    </Modal>
  );
}
