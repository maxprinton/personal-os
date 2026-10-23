import { createClient } from "@/lib/supabase/server";
import { getActiveBlocks, getFulfillments, getSettings, type EventRow } from "@/lib/agenda";
import {
  addDays,
  describeDays,
  formatDateLong,
  formatMinutes,
  localNow,
  timeToMinutes,
  utcToLocal,
  zonedToUtc,
} from "@/lib/time";
import { deleteEvent } from "@/app/actions";
import Nav from "@/components/Nav";
import EventForm from "@/components/EventForm";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const from = zonedToUtc(today, "00:00", timezone).toISOString();
  const to = zonedToUtc(addDays(today, 60), "00:00", timezone).toISOString();

  const [blocks, eventsRes] = await Promise.all([
    getActiveBlocks(supabase),
    supabase
      .from("events")
      .select("id,title,start_time,end_time,is_habit")
      .is("deleted_at", null)
      .gte("end_time", from)
      .lt("start_time", to)
      .order("start_time"),
  ]);
  const events = (eventsRes.data ?? []) as EventRow[];
  const fulfills = await getFulfillments(
    supabase,
    events.map((e) => e.id)
  );
  const blockTitle = new Map(blocks.map((b) => [b.id, b.title]));
  const options = blocks.map((b) => ({
    id: b.id,
    label: `${b.title} (${formatMinutes(timeToMinutes(b.start_time))}, ${describeDays(b.rrule)})`,
  }));

  return (
    <>
      <Nav active="/events" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="text-sm text-neutral-500">Real, dated commitments. Next 60 days.</p>
        </div>
        <EventForm today={today} blocks={options} />
        <ul className="space-y-2">
          {events.map((e) => {
            const s = utcToLocal(e.start_time, timezone);
            const en = utcToLocal(e.end_time, timezone);
            const linked = fulfills.get(e.id);
            return (
              <li key={e.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3">
                <div className="flex-1">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-sm text-neutral-500">
                    {formatDateLong(s.date)} · {formatMinutes(s.minutes)} – {formatMinutes(en.minutes)}
                    {e.is_habit ? " · Habit" : ""}
                    {linked && blockTitle.get(linked) ? ` · fulfills ${blockTitle.get(linked)}` : ""}
                  </p>
                </div>
                <form action={deleteEvent}>
                  <input type="hidden" name="id" value={e.id} />
                  <button className="text-sm text-neutral-500 hover:text-red-600">Delete</button>
                </form>
              </li>
            );
          })}
          {events.length === 0 && <p className="text-sm text-neutral-500">No upcoming events.</p>}
        </ul>
      </main>
    </>
  );
}
