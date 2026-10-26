import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { getEvents, getEventTypes } from "@/lib/calendar/events";
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
  const [all, eventTypes, finance] = await Promise.all([
    getEvents(supabase, userId, addDays(today, -60), addDays(today, 60), timezone),
    getEventTypes(supabase, userId),
    getFinanceOptions(supabase, userId),
  ]);
  // Upcoming events, plus past payments still waiting to be marked paid (so you can still pay them here)
  const events = all.filter((e) => e.end_date >= today || (e.is_payment && !e.payment_status));

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted">
            Dated things, in their own layer over your blocks (they may overlap them). Without a time they are notes of the
            day. Next 60 days.
          </p>
        </div>
        <EventsPanel events={events} eventTypes={eventTypes} today={today} finance={finance} readOnly={await isMobileRequest()} />
      </main>
    </>
  );
}
