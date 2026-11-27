// BL-123: Upcoming / Overdue / Past split of the Events page.
import { isOverdue, pastWindow, splitEvents, uniqueEvents } from "@/lib/events-tabs";
import type { CalEvent } from "@/lib/calendar/types";

let fails = 0;
function ok(c: boolean, m: string) {
  if (!c) { fails++; console.log("FAIL", m); }
}
const T = "2026-11-26";
const ev = (id: string, date: string, end = date, extra: Partial<CalEvent> = {}): CalEvent =>
  ({ id, title: id, event_type_id: null, date, end_date: end, start: null, end: null, ...extra }) as CalEvent;

const list = [
  ev("today", T),
  ev("yesterday", "2026-11-25"),
  ev("running", "2026-11-24", "2026-11-28"),
  ev("future", "2026-12-05"),
  ev("paid", "2026-11-13", "2026-11-13", { is_payment: true, payment_status: "paid" }),
  ev("skipped", "2026-10-26", "2026-10-26", { is_payment: true, payment_status: "skipped" }),
  ev("overdue", "2026-11-20", "2026-11-20", { is_payment: true, payment_status: null }),
  ev("duepay-today", T, T, { is_payment: true, payment_status: null }),
  ev("duepay-future", "2027-01-02", "2027-01-02", { is_payment: true, payment_status: null }),
];
const r = splitEvents([...list, list[0]], T);
const ids = (l: CalEvent[]) => l.map((e) => e.id);

ok(ids(r.upcoming).includes("today"), "event today stays in Upcoming");
ok(!ids(r.past).includes("today"), "event today is not in Past");
ok(ids(r.upcoming).includes("running") && !ids(r.past).includes("running"), "multi-day event still running: Upcoming only");
ok(ids(r.past).includes("yesterday") && !ids(r.upcoming).includes("yesterday"), "yesterday moves to Past");
ok(ids(r.past).includes("paid") && ids(r.past).includes("skipped"), "paid and skipped go to Past");
ok(!ids(r.upcoming).includes("paid") && !ids(r.overdue).includes("paid"), "paid is not Upcoming/Overdue");
ok(ids(r.overdue).join() === "overdue", "only the unresolved past payment is Overdue");
ok(ids(r.past).includes("overdue"), "overdue payment also appears in Past");
ok(!ids(r.upcoming).includes("overdue"), "overdue is not repeated inside the Upcoming list");
ok(!isOverdue(list[7], T), "payment due today is not overdue yet");
ok(ids(r.upcoming).includes("duepay-today") && ids(r.upcoming).includes("duepay-future"), "unpaid today/future payments are Upcoming");
ok(r.upcoming.filter((e) => e.id === "today").length === 1, "duplicates removed");
ok(r.past[0].id === "yesterday", "Past is newest first");
ok(ids(r.upcoming)[0] === "running", "Upcoming is oldest first");
ok(uniqueEvents([list[0], list[0]]).length === 1, "uniqueEvents");
const w = pastWindow("2026-11-26");
ok(w.from === "2026-08-28" && w.to === "2026-11-25", `pastWindow 90 days (${w.from}..${w.to})`);
const w2 = pastWindow(w.from);
ok(w2.to === "2026-08-27", "next window ends the day before the previous start");

console.log(fails === 0 ? "events-tabs: all OK" : `events-tabs: ${fails} FAILED`);
process.exit(fails ? 1 : 0);
