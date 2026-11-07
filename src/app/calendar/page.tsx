import Calendar from "@/components/calendar/Calendar";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <div className="h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-3.5rem)]">
      <Calendar variant="page" />
    </div>
  );
}
