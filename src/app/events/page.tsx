import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { getEvents, getEventTypes, getOverduePayments, hasEventsBefore } from "@/lib/calendar/events";
import { PAST_CHUNK_DAYS, UPCOMING_DAYS, uniqueEvents } from "@/lib/events-tabs";
import { addDays, localNow } from "@/lib/time";
import EventsPanel from "@/components/EventsPanel";
import { isMobileRequest } from "@/lib/device";
import { getFinanceOptions } from "@/lib/calendar/payments";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const timezone = await userTimezone(supabase, userId);
  const today = localNow(timezone).date;
  const pastFrom = addDays(today, -PAST_CHUNK_DAYS);
  const [window, overdueAll, morePast, eventTypes, finance] = await Promise.all([
    getEvents(supabase, userId, pastFrom, addDays(today, UPCOMING_DAYS), timezone),
    getOverduePayments(supabase, userId, today, timezone),
    hasEventsBefore(supabase, userId, pastFrom),
    getEventTypes(supabase, userId),
    getFinanceOptions(supabase, userId),
  ]);
  // Upcoming + the last 90 days; overdue payments of any age are added so they can still be paid
  const events = uniqueEvents([...window, ...overdueAll]);

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted">
            Dated things, in their own layer over your blocks (they may overlap them). Without a time they are notes of the
            day. Upcoming shows the next 60 days; Past keeps the history.
          </p>
        </div>
        <EventsPanel events={events} pastFrom={pastFrom} morePast={morePast} eventTypes={eventTypes} today={today} finance={finance} readOnly={await isMobileRequest()} />
      </main>
    </>
  );
}
