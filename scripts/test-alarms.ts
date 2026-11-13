// Tests of the phone-alarm logic (src/lib/alarms.ts): which blocks ring, when, and the key helpers.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-alarms.ts
import assert from "node:assert/strict";
import { buildAlarms, generateAlarmKey, hashAlarmKey, noteSnippet } from "@/lib/alarms";
import { cleanRules, describeRing, effectiveRules, PRESETS, type AlarmRing } from "@/lib/alarm-rules";
import { cleanAlarmEvent, habitMarkFor, ringsToAnswer } from "@/lib/alarm-answers";

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

// ---- The phone answers back: wake / bed / check-in flags, event checks, rings-to-answer ------------------

test("the wake chain = the earliest full-screen start ring of a block before noon; it asks the check-in until done", () => {
  const types = [
    { id: "m", name: "Morning", alarm_rules: [ring({ anchor: "start", offset: -15, sound: "rooster", repeats: 2 })] },
    { id: "w", name: "Work", alarm_rules: [ring({ anchor: "start", offset: -5 })] },
    { id: "q", name: "Quiet", alarm_rules: [ring({ anchor: "start", offset: -60, style: "notify" })] },
    { id: "s", name: "Sleep", alarm_rules: [ring({ anchor: "start", offset: 0 })] },
  ];
  const occs = [
    occ("m1", "m", "2026-11-13", "06:00", "07:00"),
    occ("w1", "w", "2026-11-13", "07:00", "14:00"),
    occ("q1", "q", "2026-11-13", "05:30", "06:00"),
    occ("s1", "s", "2026-11-13", "21:00", "05:00"),
    occ("m2", "m", "2026-11-14", "07:00", "08:00"),
  ];
  const a = buildAlarms({ occurrences: occs, types, notes: new Map(), timezone: TZ, now, checkinDone: new Set(["2026-11-14"]) });
  const wake = a.filter((x) => x.wake);
  assert.deepEqual([...new Set(wake.map((x) => x.occurrenceId))], ["m1", "m2"]);
  assert.equal(wake.filter((x) => x.date === "2026-11-13").length, 3); // the whole chain
  assert.ok(a.filter((x) => x.date === "2026-11-13" && x.wake).every((x) => x.checkin));
  assert.ok(a.filter((x) => x.date === "2026-11-14").every((x) => !x.checkin));
  assert.ok(!a.find((x) => x.occurrenceId === "q1")!.wake); // a quiet banner is never the wake-up
  // Sleep runs overnight: its start ring offers "Going to sleep"
  assert.ok(a.find((x) => x.occurrenceId === "s1")!.bed);
  assert.ok(!a.find((x) => x.occurrenceId === "w1")!.bed);
});

test("habits and tasks travel with their ids for ticking", () => {
  const a = buildAlarms({
    occurrences: [occ("1", "gym", "2026-11-13", "07:00", "08:00")],
    types, notes: new Map(), timezone: TZ, now,
    habitItems: new Map([["1", [{ id: "h1", name: "Stretch" }]]]),
    taskItems: new Map([["1", [{ id: "t1", title: "Buy chalk" }]]]),
  });
  assert.deepEqual(a[0].habitItems, [{ id: "h1", name: "Stretch" }]);
  assert.deepEqual(a[0].taskItems, [{ id: "t1", title: "Buy chalk" }]);
  assert.equal(a[0].occurrenceId, "1");
  assert.equal(a[0].blockTypeId, "gym");
});

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-13T12:00:00Z");

test("events from the phone are checked field by field", () => {
  const ok = cleanAlarmEvent({ clientId: "c1", kind: "answer", answer: "skip", at: NOW - 1000, occurrenceId: U1, seq: 2, total: 4, anchor: "start", wake: true }, NOW);
  assert.equal(ok?.answer, "skip");
  assert.equal(ok?.seq, 2);
  assert.equal(ok?.wake, true);
  assert.equal(cleanAlarmEvent({ clientId: "c1", kind: "answer", answer: "explode", at: NOW }, NOW), null);
  assert.equal(cleanAlarmEvent({ clientId: "c1", kind: "nope", at: NOW }, NOW), null);
  assert.equal(cleanAlarmEvent({ kind: "rang", at: NOW }, NOW), null);
  assert.equal(cleanAlarmEvent({ clientId: "c1", kind: "rang", at: NOW + 3600_000 }, NOW), null); // future
  assert.equal(cleanAlarmEvent({ clientId: "c1", kind: "rang", at: NOW - 9 * 86_400_000 }, NOW), null); // too old
  assert.equal(cleanAlarmEvent({ clientId: "c1", kind: "rang", at: NOW, occurrenceId: "not-a-uuid" }, NOW)?.occurrenceId, undefined);
  // a habit tick needs its block; a task tick doesn't
  assert.equal(cleanAlarmEvent({ clientId: "c2", kind: "tick", habitId: U2, at: NOW }, NOW), null);
  assert.equal(cleanAlarmEvent({ clientId: "c2", kind: "tick", habitId: U2, occurrenceId: U1, at: NOW, done: false }, NOW)?.done, false);
  assert.equal(cleanAlarmEvent({ clientId: "c3", kind: "tick", taskId: U2, at: NOW }, NOW)?.done, true);
  // check-in: scales clamped to their range, at least one answer
  const ci = cleanAlarmEvent({ clientId: "c4", kind: "checkin", date: "2026-11-13", at: NOW, mood: 7, energy: 11, sleepQuality: 4, highlight: "  Gym PR  " }, NOW);
  assert.equal(ci?.mood, 7);
  assert.equal(ci?.energy, undefined);
  assert.equal(ci?.sleepQuality, 4);
  assert.equal(ci?.highlight, "Gym PR");
  assert.equal(cleanAlarmEvent({ clientId: "c5", kind: "checkin", date: "2026-11-13", at: NOW }, NOW), null);
  assert.equal(cleanAlarmEvent({ clientId: "c6", kind: "checkin", date: "13/11", at: NOW, mood: 5 }, NOW), null);
});

test("answers leave the right habit mark: skip excused, didn't do it missed, done done", () => {
  assert.equal(habitMarkFor("skip"), "skipped");
  assert.equal(habitMarkFor("not_done"), "missed");
  assert.equal(habitMarkFor("done"), "done");
  assert.equal(habitMarkFor("already_done"), "done");
  assert.equal(habitMarkFor("partial"), null);
  assert.equal(habitMarkFor("started"), null);
  assert.equal(habitMarkFor("silence"), null);
});

test("rings to answer: first real answer of each chain, averaged per block; Silence doesn't count", () => {
  const rows = [
    { chain: "a|0|1", kind: "answer", answer: "silence", seq: 0, block_type_id: "m", at: "2026-11-10T10:00:00Z" },
    { chain: "a|0|1", kind: "answer", answer: "started", seq: 2, block_type_id: "m", at: "2026-11-10T10:10:00Z" },
    { chain: "a|0|1", kind: "answer", answer: "done", seq: 3, block_type_id: "m", at: "2026-11-10T10:15:00Z" },
    { chain: "b|0|2", kind: "answer", answer: "started", seq: 0, block_type_id: "m", at: "2026-11-11T10:00:00Z" },
    { chain: "c|0|3", kind: "answer", answer: "done", seq: 1, block_type_id: "g", at: "2026-11-11T20:00:00Z" },
    { chain: "d|0|4", kind: "rang", answer: null, seq: 0, block_type_id: "g", at: "2026-11-12T20:00:00Z" },
  ];
  const r = ringsToAnswer(rows);
  assert.deepEqual(r.get("m"), { average: 2, chains: 2 }); // 3 rings, then 1 ring
  assert.deepEqual(r.get("g"), { average: 2, chains: 1 });
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
