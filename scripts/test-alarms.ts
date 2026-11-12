// Tests of the phone-alarm logic (src/lib/alarms.ts): which blocks ring, when, and the key helpers.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-alarms.ts
import assert from "node:assert/strict";
import { buildAlarms, generateAlarmKey, hashAlarmKey, noteSnippet } from "@/lib/alarms";

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

const TZ = "America/Guayaquil"; // UTC-5, no DST
const types = [
  { id: "gym", name: "Gym", alarm_minutes_before: 15 },
  { id: "work", name: "Work", alarm_minutes_before: null },
  { id: "sleep", name: "Sleep", alarm_minutes_before: 0 },
];
const occ = (id: string, type: string, date: string, start: string, end: string, status = "scheduled") => ({
  id, block_type_id: type, date, start_time: start, end_time: end, status: status as "scheduled",
});
// 2026-11-12 06:00 in Guayaquil = 11:00 UTC
const now = new Date("2026-11-12T11:00:00Z");

test("only blocks with an alarm ring, minutes before the start, in epoch ms", () => {
  const a = buildAlarms({
    occurrences: [occ("1", "gym", "2026-11-12", "07:00:00", "08:00:00"), occ("2", "work", "2026-11-12", "09:00", "17:00")],
    types, notes: new Map(), timezone: TZ, now,
  });
  assert.equal(a.length, 1);
  assert.equal(a[0].id, "1");
  assert.equal(a[0].startsAtMs, Date.parse("2026-11-12T12:00:00Z"));
  assert.equal(a[0].alarmAtMs, Date.parse("2026-11-12T11:45:00Z"));
  assert.equal(a[0].start, "07:00");
  assert.equal(a[0].end, "08:00");
});

test("alarms already in the past do not ring", () => {
  const a = buildAlarms({ occurrences: [occ("1", "gym", "2026-11-12", "06:10", "07:00")], types, notes: new Map(), timezone: TZ, now });
  assert.equal(a.length, 0); // 06:10 - 15 min = 05:55, before now (06:00)
});

test("cancelled, paused and done blocks never ring", () => {
  const a = buildAlarms({
    occurrences: [
      occ("1", "gym", "2026-11-13", "07:00", "08:00", "cancelled"),
      occ("2", "gym", "2026-11-14", "07:00", "08:00", "free_day"),
      occ("3", "gym", "2026-11-15", "07:00", "08:00", "done"),
      occ("4", "gym", "2026-11-16", "07:00", "08:00", "partial"),
    ],
    types, notes: new Map(), timezone: TZ, now,
  });
  assert.deepEqual(a.map((x) => x.id), ["4"]);
});

test("only the next 7 days, sorted by alarm time", () => {
  const a = buildAlarms({
    occurrences: [
      occ("late", "gym", "2026-11-25", "07:00", "08:00"),
      occ("b", "sleep", "2026-11-14", "22:00", "06:00"),
      occ("a", "gym", "2026-11-13", "07:00", "08:00"),
    ],
    types, notes: new Map(), timezone: TZ, now,
  });
  assert.deepEqual(a.map((x) => x.id), ["a", "b"]);
});

test("an overnight block rings at its start (the evening before)", () => {
  const a = buildAlarms({ occurrences: [occ("n", "sleep", "2026-11-12", "23:00", "07:00")], types, notes: new Map(), timezone: TZ, now });
  assert.equal(a[0].alarmAtMs, Date.parse("2026-11-13T04:00:00Z"));
});

test("the block note travels with the alarm (by name, any case)", () => {
  const a = buildAlarms({
    occurrences: [occ("1", "gym", "2026-11-13", "07:00", "08:00")],
    types, notes: new Map([["gym", "Bring the bottle"]]), timezone: TZ, now,
  });
  assert.equal(a[0].note, "Bring the bottle");
});

test("habits and tasks of the block travel with its alarm", () => {
  const a = buildAlarms({
    occurrences: [occ("1", "gym", "2026-11-13", "07:00", "08:00"), occ("2", "gym", "2026-11-14", "07:00", "08:00")],
    types, notes: new Map(), timezone: TZ, now,
    habits: new Map([["1", ["Warm up", "Stretch"]]]),
    tasks: new Map([["1", ["Buy chalk"]]]),
  });
  assert.deepEqual(a[0].habits, ["Warm up", "Stretch"]);
  assert.deepEqual(a[0].tasks, ["Buy chalk"]);
  assert.deepEqual(a[1].habits, []);
  assert.deepEqual(a[1].tasks, []);
});

test("noteSnippet makes plain text and truncates", () => {
  assert.equal(noteSnippet("# Plan\n- [ ] warm up\n- [x] **stretch**"), "Plan\n• warm up\n• stretch");
  assert.equal(noteSnippet(null), "");
  const long = noteSnippet("a".repeat(500), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith("…"));
});

test("keys: random, prefixed, hashed with sha256 and trimmed", () => {
  const k1 = generateAlarmKey();
  const k2 = generateAlarmKey();
  assert.ok(k1.startsWith("pos_") && k1.length > 30);
  assert.notEqual(k1, k2);
  assert.equal(hashAlarmKey(k1), hashAlarmKey(`  ${k1}\n`));
  assert.match(hashAlarmKey(k1), /^[0-9a-f]{64}$/);
  assert.notEqual(hashAlarmKey(k1), hashAlarmKey(k2));
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
