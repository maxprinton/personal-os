import Link from "next/link";

/** Calendar v1 form, retired: events are created on the Events page or in the calendar. */
export default function EventForm() {
  return (
    <p className="rounded-lg border border-line p-4 text-sm text-muted bg-surface shadow-card">
      Create events on the <Link href="/events" className="underline">Events</Link> page or in the calendar.
    </p>
  );
}
