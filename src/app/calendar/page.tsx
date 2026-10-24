import Nav from "@/components/Nav";
import Calendar from "@/components/calendar/Calendar";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <div className="flex h-screen flex-col">
      <Nav active="/calendar" />
      <div className="min-h-0 flex-1">
        <Calendar variant="page" />
      </div>
    </div>
  );
}
