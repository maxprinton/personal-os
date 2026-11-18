// Tests of the phone app's day view (BL-110): src/lib/alarm-day.ts summarizeDay (pure).
// Run: npm run test:alarm-day
import assert from "node:assert/strict";
import { buildAlarms } from "@/lib/alarms";
import { summarizeDay, type ReportedEvent } from "@/lib/alarm-day";
import { cleanAlarmEvent } from "@/lib/alarm-answers";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e instanceof Error ? e.message.split("\n").join("\n  ") : e}`);
  }
}

const TZ = "America/Guayaquil"; // UTC-5
const types = [
  { id: "morning", name: "Morning routine", alarm_rules: [{ anchor: "start", offset: 0, repeats: 2, every: 5, style: "alarm" }] },
  { id: "gym", name: "Gym", alarm_minutes_before: 0 },
];
const occ = (id: string, type: string, date: string, start: string, end: string, status = "scheduled") => ({
  id, block_type_id: type, date, start_time: start, end_time: end, status: status as "scheduled",
});
const dayStart = Date.parse("2026-11-17T05:00:00Z"); // 00:00 local
const sched = (status = "scheduled") =>
  buildAlarms({
    occurrences: [occ("o1", "morning", "2026-11-17", "06:30", "07:30", status), occ("o2", "gym", "2026-11-17", "18:00", "19:00")],
    types,
    notes: new Map(),
    timezone: TZ,
    now: new Date(dayStart - 1),
    days: 2,
    keepDone: true,
  }).filter((a) => a.alarmAtMs < dayStart + 86_400_000);
const at = (hm: string) => Date.parse(`2026-11-17T${hm}:00-05:00`);
const ev = (kind: "rang" | "answer", alarmAt: number, extra: Partial<ReportedEvent> = {}): ReportedEvent => ({
  kind, answer: null, occurrenceId: "o1", blockTypeId: "morning", chain: null, seq: null, total: null, anchor: "start", style: "alarm",
  at: alarmAt + 5_000, alarmAt, ...extra,
});

test("future day: one chain per block, all upcoming", () => {
  const days = summarizeDay({ scheduled: sched(), events: [], nowMs: dayStart - 3_600_000, trackingSinceMs: 1 });
  assert.equal(days.length, 2);
  assert.equal(days[0].title, "Morning routine");
  assert.equal(days[0].rings.length, 3);
  assert.equal(days[0].state, "upcoming");
  assert.ok(days[0].rings.every((r) => r.status === "upcoming"));
});

test("done blocks still listed (keepDone)", () => {
  assert.equal(sched("done").length, 4);
});

test("rang + I'm up: later rings stopped, answer shown", () => {
  const s = sched();
  const chain = s[0].chain;
  const events = [ev("rang", at("06:30"), { chain, seq: 0 }), ev("answer", at("06:30"), { chain, seq: 0, answer: "started", at: at("06:31") })];
  const d = summarizeDay({ scheduled: s, events, nowMs: at("12:00"), trackingSinceMs: 1 })[0];
  assert.equal(d.state, "rang");
  assert.equal(d.answer, "started");
  assert.deepEqual(d.rings.map((r) => r.status), ["rang", "stopped", "stopped"]);
});

test("snooze keeps the chain going", () => {
  const s = sched();
  const chain = s[0].chain;
  const events = [ev("rang", at("06:30"), { chain, seq: 0 }), ev("answer", at("06:30"), { chain, answer: "snooze", at: at("06:31") })];
  const d = summarizeDay({ scheduled: s, events, nowMs: at("12:00"), trackingSinceMs: 1 })[0];
  assert.deepEqual(d.rings.map((r) => r.status), ["rang", "didnt_ring", "didnt_ring"]);
  assert.equal(d.state, "mixed");
});

test("past ring never reported = didn't ring", () => {
  const d = summarizeDay({ scheduled: sched(), events: [], nowMs: at("12:00"), trackingSinceMs: 1 })[0];
  assert.equal(d.state, "didnt_ring");
});

test("before the phone ever reported: untracked, not red", () => {
  const d = summarizeDay({ scheduled: sched(), events: [], nowMs: at("12:00"), trackingSinceMs: null })[0];
  assert.equal(d.state, "untracked");
});

test("match by block + time when the chain id changed", () => {
  const events = [ev("rang", at("06:30"), { chain: "o1|0|999", seq: 0 })];
  const d = summarizeDay({ scheduled: sched(), events, nowMs: at("12:00"), trackingSinceMs: 1 });
  assert.equal(d[0].rings[0].status, "rang");
  assert.equal(d.filter((c) => c.unplanned).length, 0);
});

test("a ring the schedule doesn't know shows as unplanned", () => {
  const events = [ev("rang", at("10:00"), { occurrenceId: null, blockTypeId: null, chain: null })];
  const d = summarizeDay({ scheduled: sched(), events, nowMs: at("12:00"), trackingSinceMs: 1 });
  const extra = d.find((c) => c.unplanned);
  assert.ok(extra);
  assert.equal(extra.title, "Test alarm");
});

test("today: past rings first, upcoming after, sorted by time", () => {
  const d = summarizeDay({ scheduled: sched(), events: [], nowMs: at("12:00"), trackingSinceMs: 1 });
  assert.equal(d[0].title, "Morning routine");
  assert.equal(d[1].title, "Gym");
  assert.equal(d[1].state, "upcoming");
});

test("phone switched off: grey 'phone was off', not red", () => {
  const d = summarizeDay({ scheduled: sched(), events: [], nowMs: at("12:00"), trackingSinceMs: 1, offWindows: [[at("05:20"), at("10:04")]] });
  assert.equal(d[0].state, "phone_off");
  assert.ok(d[0].rings.every((r) => r.status === "phone_off"));
});

test("off window that doesn't cover the ring changes nothing", () => {
  const d = summarizeDay({ scheduled: sched(), events: [], nowMs: at("12:00"), trackingSinceMs: 1, offWindows: [[at("01:00"), at("02:00")]] });
  assert.equal(d[0].state, "didnt_ring");
});

test("cleanAlarmEvent accepts 'off' only with a start before the end", () => {
  const now = at("10:05");
  assert.ok(cleanAlarmEvent({ clientId: "x", kind: "off", at: at("10:04"), alarmAt: at("05:20") }, now));
  assert.equal(cleanAlarmEvent({ clientId: "y", kind: "off", at: at("10:04") }, now), null);
  assert.equal(cleanAlarmEvent({ clientId: "z", kind: "off", at: at("05:20"), alarmAt: at("10:04") }, now), null);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
