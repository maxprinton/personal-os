// Tests of the phone-alarm logic (src/lib/alarms.ts): which blocks ring, when, and the key helpers.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-alarms.ts
import assert from "node:assert/strict";
import { buildAlarms, generateAlarmKey, hashAlarmKey, noteSnippet } from "@/lib/alarms";
import { cleanRules, describeRing, effectiveRules, PRESETS, type AlarmRing } from "@/lib/alarm-rules";

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
  assert.equal(a[0].id, "1.0.0");
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
  assert.deepEqual(a.map((x) => x.id), ["4.0.0"]);
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
  assert.deepEqual(a.map((x) => x.id), ["a.0.0", "b.0.0"]);
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

// ---- Rules: rings anchored to the start or the end, chains that repeat ------------------------------------

const ring = (r: Partial<AlarmRing> & Pick<AlarmRing, "anchor" | "offset">): AlarmRing => ({
  sound: "default", repeatSound: null, style: "alarm", repeats: 0, every: 5, louder: false, ...r,
});
const withRules = (rules: AlarmRing[]) => [{ id: "t", name: "Test", alarm_rules: rules }];
const build = (rules: AlarmRing[], o = occ("1", "t", "2026-11-13", "07:00", "08:00")) =>
  buildAlarms({ occurrences: [o], types: withRules(rules), notes: new Map(), timezone: TZ, now });
// 2026-11-13 07:00 in Guayaquil = 12:00 UTC
const T07 = Date.parse("2026-11-13T12:00:00Z");
const MIN = 60_000;

test("a wake-up chain: the first ring and its repeats, louder each time", () => {
  const a = build([ring({ anchor: "start", offset: 0, sound: "rooster", repeats: 3, every: 5, louder: true })]);
  assert.deepEqual(a.map((x) => x.alarmAtMs), [T07, T07 + 5 * MIN, T07 + 10 * MIN, T07 + 15 * MIN]);
  assert.deepEqual(a.map((x) => x.seq), [0, 1, 2, 3]);
  assert.deepEqual(a.map((x) => x.total), [4, 4, 4, 4]);
  assert.deepEqual(a.map((x) => x.level), [0, 1, 2, 3]);
  assert.equal(new Set(a.map((x) => x.chain)).size, 1);
  assert.equal(new Set(a.map((x) => x.id)).size, 4);
  assert.ok(a.every((x) => x.sound === "rooster" && x.anchor === "start" && x.every === 5));
});

test("without louder every ring has level 0; a repeat sound replaces the sound of the repeats only", () => {
  const a = build([ring({ anchor: "start", offset: 0, sound: "chime", repeatSound: "rooster", repeats: 2 })]);
  assert.deepEqual(a.map((x) => x.level), [0, 0, 0]);
  assert.deepEqual(a.map((x) => x.sound), ["chime", "rooster", "rooster"]);
});

test("rings of the end: before and after, even when the block ends the next day", () => {
  const a = build([ring({ anchor: "end", offset: -5, style: "notify" }), ring({ anchor: "end", offset: 5 })]);
  assert.deepEqual(a.map((x) => x.alarmAtMs), [T07 + 55 * MIN, T07 + 65 * MIN]);
  assert.deepEqual(a.map((x) => x.style), ["notify", "alarm"]);
  assert.equal(a[0].endsAtMs, T07 + 60 * MIN);
  const night = build([ring({ anchor: "end", offset: -10 })], occ("n", "t", "2026-11-13", "23:00", "07:00"));
  assert.equal(night[0].alarmAtMs, Date.parse("2026-11-14T12:00:00Z") - 10 * MIN);
});

test("repeats of a ring of the start stop when the block is over; the chain counts only the rings that remain", () => {
  const a = build(
    [ring({ anchor: "start", offset: 0, repeats: 5, every: 10 })],
    occ("1", "t", "2026-11-13", "07:00", "07:25")
  );
  assert.deepEqual(a.map((x) => x.alarmAtMs), [T07, T07 + 10 * MIN, T07 + 20 * MIN]);
  assert.ok(a.every((x) => x.total === 3));
});

test("rings of the end may ring after the block (a hard stop)", () => {
  const a = build([ring({ anchor: "end", offset: 0, repeats: 2, every: 3 })]);
  assert.deepEqual(a.map((x) => x.alarmAtMs), [T07 + 60 * MIN, T07 + 63 * MIN, T07 + 66 * MIN]);
});

test("a chain that already began keeps its remaining rings and its numbering", () => {
  // now = 07:07 on the 13th: rings at 07:00 and 07:05 are past, 07:10 and 07:15 remain
  const late = new Date(T07 + 7 * MIN);
  const a = buildAlarms({
    occurrences: [occ("1", "t", "2026-11-13", "07:00", "08:00")],
    types: withRules([ring({ anchor: "start", offset: 0, repeats: 3, every: 5, louder: true })]),
    notes: new Map(), timezone: TZ, now: late,
  });
  assert.deepEqual(a.map((x) => x.seq), [2, 3]);
  assert.deepEqual(a.map((x) => x.level), [2, 3]);
  assert.ok(a.every((x) => x.total === 4));
});

test("the same chain id for the whole chain changes when the block moves (so an old 'I'm up' does not apply)", () => {
  const a = build([ring({ anchor: "start", offset: 0, repeats: 1 })]);
  const b = build([ring({ anchor: "start", offset: 0, repeats: 1 })], occ("1", "t", "2026-11-13", "07:30", "08:00"));
  assert.notEqual(a[0].chain, b[0].chain);
  assert.equal(a[0].chain.split("|")[0], "1");
});

test("the old minutes-before setting still works as one ring; an empty rule list switches the alarm off", () => {
  assert.deepEqual(effectiveRules({ alarm_minutes_before: 15 }).map((r) => [r.anchor, r.offset]), [["start", -15]]);
  assert.deepEqual(effectiveRules({ alarm_minutes_before: 15, alarm_rules: [] }), []);
  assert.deepEqual(effectiveRules({}), []);
  const a = build([]);
  assert.equal(a.length, 0);
  const b = buildAlarms({
    occurrences: [occ("1", "t", "2026-11-13", "07:00", "08:00")],
    types: [{ id: "t", name: "Test", alarm_minutes_before: 10 }],
    notes: new Map(), timezone: TZ, now,
  });
  assert.equal(b[0].alarmAtMs, T07 - 10 * MIN);
  assert.equal(b[0].minutesBefore, 10);
  assert.equal(b[0].total, 1);
});

test("cleanRules clamps numbers, drops junk and unknown sounds, and limits the list", () => {
  const r = cleanRules([
    { anchor: "start", offset: 999, sound: "nope", repeats: 99, every: 0, louder: true, repeatSound: "bell", style: "x" },
    { anchor: "middle", offset: 1 },
    "junk",
    { anchor: "end", offset: -30.4, repeats: 0, louder: true, repeatSound: "bell", style: "notify" },
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { anchor: "start", offset: 180, sound: "default", repeatSound: "bell", style: "alarm", repeats: 5, every: 1, louder: true });
  assert.deepEqual(r[1], { anchor: "end", offset: -30, sound: "default", repeatSound: null, style: "notify", repeats: 0, every: 5, louder: false });
  assert.deepEqual(cleanRules("x"), []);
  assert.equal(cleanRules(Array.from({ length: 20 }, () => ({ anchor: "start", offset: 0 }))).length, 8);
});

test("every preset is valid and survives cleaning unchanged", () => {
  for (const p of PRESETS) {
    assert.ok(p.rings.length > 0, p.id);
    assert.deepEqual(cleanRules(p.rings), p.rings, p.id);
    for (const r of p.rings) assert.ok(describeRing(r).length > 10);
  }
  const wake = PRESETS.find((p) => p.id === "wake")!.rings[0];
  assert.equal(wake.sound, "rooster");
  assert.ok(wake.repeats >= 1 && wake.louder);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
