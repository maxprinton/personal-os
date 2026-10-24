import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { getEvents, getEventTypes } from "@/lib/calendar/events";
import { addDays, localNow } from "@/lib/time";
import Nav from "@/components/Nav";
import EventsPanel from "@/components/EventsPanel";
import { isMobileRequest } from "@/lib/device";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const timezone = await userTimezone(supabase, userId);
  const today = localNow(timezone).date;
  const [events, eventTypes] = await Promise.all([
    getEvents(supabase, userId, today, addDays(today, 60), timezone),
    getEventTypes(supabase, userId),
  ]);

  return (
    <>
      <Nav active="/events" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="text-sm text-neutral-500">
            Dated things, in their own layer over your blocks (they may overlap them). Without a time they are notes of the
            day. Next 60 days.
          </p>
        </div>
        <EventsPanel events={events} eventTypes={eventTypes} today={today} readOnly={await isMobileRequest()} />
      </main>
    </>
  );
}
