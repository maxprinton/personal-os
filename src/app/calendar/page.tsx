import Calendar from "@/components/calendar/Calendar";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <div className="h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] lg:h-dvh">
      <Calendar variant="page" />
    </div>
  );
}
