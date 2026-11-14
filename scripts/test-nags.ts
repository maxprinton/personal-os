// Event nags (BL-98): scheduling rules (pure, nothing is sent).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-nags.ts
import { buildEventPhoneAlarms } from "@/lib/nags/phone";
import {
  cleanNags, dueNags, planTelegramNags, fireStamp, humanOffset, nagsFor, nagText, phoneMayBeLate, stampOf, startStamp,
  type Nag, type NagEvent,
} from "@/lib/nags/rules";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const nag = (id: string, kind: Nag["kind"], offsetMinutes = 0, channel: Nag["channel"] = "telegram"): Nag => ({
  id, kind, offsetMinutes, channel, phoneStyle: "alarm",
});
const timed: NagEvent = { id: "e1", title: "Dentist", date: "2026-11-20", end_date: "2026-11-20", start: 14 * 60 + 30, end: 15 * 60 + 30 };
const allDay: NagEvent = { id: "e2", title: "Trip", date: "2026-11-20", end_date: "2026-11-24", start: null, end: null };
const day1: NagEvent = { id: "e3", title: "Holiday", date: "2026-11-20", end_date: "2026-11-20", start: null, end: null };
const long = { date: "2020-01-01", minutes: 0 }; // changed long ago

const at = (date: string, h: number, m = 0) => ({ date, minutes: h * 60 + m });
const due = (e: NagEvent, n: Nag[], now: { date: string; minutes: number }, changed = long) =>
  dueNags({ event: e, nags: n, now, changedAt: changed });

// fire times
ok("before 2h of a timed event", fireStamp(timed, nag("a", "before", 120)) === stampOf("2026-11-20", 12 * 60 + 30));
ok("start fires at the start", fireStamp(timed, nag("a", "start")) === startStamp(timed));
ok("mid is the middle of the event", fireStamp(timed, nag("a", "mid")) === stampOf("2026-11-20", 15 * 60));
ok("all-day start uses 09:00 on day 1", fireStamp(allDay, nag("a", "start")) === stampOf("2026-11-20", 540));
ok("all-day 1 day before = 09:00 the day before", fireStamp(allDay, nag("a", "before", 1440)) === stampOf("2026-11-19", 540));
ok("5-day all-day mid is day 3", fireStamp(allDay, nag("a", "mid")) === stampOf("2026-11-22", 540));
ok("1-day all-day has no mid nag", fireStamp(day1, nag("a", "mid")) === null);
ok("custom all-day time", dueNags({ event: day1, nags: [nag("a", "start")], now: at("2026-11-20", 7), changedAt: long, allDayMinutes: 420 }).length === 1);

// due now
ok("before nag due at its minute", due(timed, [nag("a", "before", 120)], at("2026-11-20", 12, 30)).length === 1);
ok("not due one minute early", due(timed, [nag("a", "before", 120)], at("2026-11-20", 12, 29)).length === 0);
ok("sent up to 15 minutes late", due(timed, [nag("a", "before", 120)], at("2026-11-20", 12, 45)).length === 1);
ok("not sent 16 minutes late", due(timed, [nag("a", "before", 120)], at("2026-11-20", 12, 46)).length === 0);
ok("before nag never after the start", due(timed, [nag("a", "before", 5)], at("2026-11-20", 14, 30)).length === 0);
ok("start nag at the start", due(timed, [nag("a", "start")], at("2026-11-20", 14, 30)).length === 1);
ok("mid nag at the middle", due(timed, [nag("a", "mid")], at("2026-11-20", 15, 0)).length === 1);
ok("nothing after the event ended", due(timed, [nag("a", "mid")], at("2026-11-20", 15, 30)).length === 0);
ok("several nags come in time order", due(timed, [nag("b", "start"), nag("a", "before", 0 + 1)], at("2026-11-20", 14, 30)).length === 1);
ok("all-day start due at 09:00", due(allDay, [nag("a", "start")], at("2026-11-20", 9, 0)).length === 1);

// created or moved late: past nags are skipped silently
ok("created 2h before: the 1-day nag is skipped", due(timed, [nag("a", "before", 1440)], at("2026-11-20", 12, 30), at("2026-11-20", 12, 30)).length === 0);
ok("created 2h before: the 1h nag still works", due(timed, [nag("a", "before", 60)], at("2026-11-20", 13, 30), at("2026-11-20", 12, 30)).length === 1);
// moved event: new fire time = new ref, old one stays sent
const moved = { ...timed, start: 16 * 60, end: 17 * 60 };
const r1 = due(timed, [nag("a", "before", 60)], at("2026-11-20", 13, 30))[0]?.ref;
const r2 = due(moved, [nag("a", "before", 60)], at("2026-11-20", 15, 0), at("2026-11-20", 10, 0))[0]?.ref;
ok("moved event gets a new ref", !!r1 && !!r2 && r1 !== r2, `${r1} ${r2}`);
ok("same fire time gives the same ref", due(timed, [nag("a", "before", 60)], at("2026-11-20", 13, 31))[0]?.ref === r1);

// which nags an event uses
const rows = [{ event_id: null, id: "d1" }, { event_id: "e1", id: "c1" }, { event_id: "e1", id: "c2" }, { event_id: "e9", id: "x" }];
ok("default set when not custom", nagsFor({ id: "e1", nags_custom: false }, rows).map((r) => r.id).join() === "d1");
ok("own list when custom", nagsFor({ id: "e1", nags_custom: true }, rows).map((r) => r.id).join() === "c1,c2");
ok("custom with an empty list = no nags", nagsFor({ id: "e5", nags_custom: true }, rows).length === 0);

// text
ok("before text", nagText(timed, nag("a", "before", 120)) === "⏰ Dentist starts in 2 hours (2:30 PM)", nagText(timed, nag("a", "before", 120)));
ok("all-day before text", nagText(allDay, nag("a", "before", 1440)) === "⏰ Trip starts in 1 day (all day)");
ok("start text", nagText(timed, nag("a", "start")) === "▶️ Dentist is starting now");
ok("mid text", nagText(timed, nag("a", "mid")) === "⏳ Dentist is halfway");
ok("offset words", humanOffset(1) === "1 minute" && humanOffset(90) === "1 h 30 min" && humanOffset(2880) === "2 days" && humanOffset(60) === "1 hour");

// phone warning
ok("phone nag under 1h may be late", phoneMayBeLate(nag("a", "before", 30, "phone")) && phoneMayBeLate(nag("a", "start", 0, "both")));
ok("phone nag 2h before is fine, telegram never warns", !phoneMayBeLate(nag("a", "before", 120, "phone")) && !phoneMayBeLate(nag("a", "start", 0, "telegram")));

// cleaning
const cleaned = cleanNags([
  { kind: "before", offsetMinutes: "120", channel: "both" },
  { kind: "before", offsetMinutes: 120, channel: "both" },
  { kind: "before", offsetMinutes: 0 },
  { kind: "before", offsetMinutes: -5 },
  { kind: "before", offsetMinutes: 99999999 },
  { kind: "nope" },
  { kind: "start", channel: "weird", phoneStyle: "notify" },
]);
ok("cleaning keeps 2 valid nags", cleaned.length === 2, JSON.stringify(cleaned));
ok("cleaning fixes unknown channel", cleaned[1]?.channel === "telegram" && cleaned[1]?.phoneStyle === "notify");
ok("cleaning caps at 12", cleanNags(Array.from({ length: 30 }, (_, i) => ({ kind: "before", offsetMinutes: i + 1 }))).length === 12);

// planning across events: default set, custom events, channels
const evs = [
  { ...timed, nags_custom: false, changedAt: long },
  { ...timed, id: "e7", title: "Gym", nags_custom: true, changedAt: long },
  { ...timed, id: "e8", title: "Quiet", nags_custom: true, changedAt: long },
];
const plan = (rowsIn: { id: string; event_id: string | null; kind: string; offset_minutes: number; channel: string; phone_style: string }[], now = at("2026-11-20", 14, 30)) =>
  planTelegramNags({ events: evs, rows: rowsIn, now });
const R = (id: string, event_id: string | null, kind: string, offset_minutes: number, channel = "telegram") => ({ id, event_id, kind, offset_minutes, channel, phone_style: "alarm" });
const p1 = plan([R("d", null, "start", 0), R("c", "e7", "start", 0)]);
ok("default applies to a non-custom event and own list to a custom one", p1.map((x) => x.eventId).sort().join() === "e1,e7", p1.map((x) => x.eventId).join());
ok("a custom event with no nags stays quiet", !p1.some((x) => x.eventId === "e8"));
ok("phone-only nags are not sent by Telegram", plan([R("d", null, "start", 0, "phone")]).length === 0);
ok("both = Telegram too", plan([R("d", null, "start", 0, "both")]).length === 1);
ok("no nags at all = nothing", plan([]).length === 0);
ok("refs differ per event", new Set(p1.map((x) => x.ref)).size === p1.length);

// phone feed
const phoneRows = [R("p1", null, "before", 120, "phone"), R("p2", null, "start", 0, "both"), R("p3", null, "before", 60, "telegram")];
const phoneAt = new Date("2026-11-20T10:00:00Z"); // 05:00 in Guayaquil
const pa = buildEventPhoneAlarms({ events: [evs[0]], rows: phoneRows, timezone: "America/Guayaquil", now: phoneAt, days: 7 });
ok("phone feed has the phone and both nags only", pa.length === 2, String(pa.length));
ok("phone alarm at 12:30 local = 17:30Z", pa[0]?.alarmAtMs === Date.parse("2026-11-20T17:30:00Z"), String(pa[0] && new Date(pa[0].alarmAtMs).toISOString()));
ok("phone alarm is a plain ring", pa[0]?.occurrenceId === "" && pa[0]?.total === 1 && pa[0]?.chain === "" && pa[0]?.title === "Dentist");
ok("minutesBefore filled", pa[0]?.minutesBefore === 120 && pa[1]?.minutesBefore === 0);
ok("past nags are not in the feed", buildEventPhoneAlarms({ events: [evs[0]], rows: phoneRows, timezone: "America/Guayaquil", now: new Date("2026-11-20T19:45:00Z"), days: 7 }).length === 0);
ok("outside the window is left out", buildEventPhoneAlarms({ events: [evs[0]], rows: phoneRows, timezone: "America/Guayaquil", now: new Date("2026-11-01T10:00:00Z"), days: 7 }).length === 0);
ok("ids differ per nag", new Set(pa.map((x) => x.id)).size === pa.length);
const pAllDay = buildEventPhoneAlarms({ events: [{ ...allDay, nags_custom: false, changedAt: long }], rows: [R("p9", null, "start", 0, "phone")], timezone: "America/Guayaquil", now: phoneAt, days: 7 });
ok("all-day phone nag rings at 09:00 local", pAllDay[0]?.alarmAtMs === Date.parse("2026-11-20T14:00:00Z"));

console.log(`\n${fail === 0 ? "✅" : "❌"} nags: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
