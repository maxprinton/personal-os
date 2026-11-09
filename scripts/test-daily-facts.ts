// Tests of the daily facts helpers (src/lib/daily-facts.ts): clock parsing, which row a bedtime belongs to, formatters.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-daily-facts.ts
import assert from "node:assert/strict";
import { deltaText, formatDuration, heatLevel, oneDecimal, parseClock, sleepMinutes, sleepSlot } from "@/lib/daily-facts";

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

test("parseClock reads 24h and am/pm forms", () => {
  assert.equal(parseClock("23:30"), 23 * 60 + 30);
  assert.equal(parseClock("7"), 7 * 60);
  assert.equal(parseClock("7am"), 7 * 60);
  assert.equal(parseClock("11:30 pm"), 23 * 60 + 30);
  assert.equal(parseClock("12am"), 0);
  assert.equal(parseClock("12 pm"), 12 * 60);
  assert.equal(parseClock("0715"), 7 * 60 + 15);
  assert.equal(parseClock("715"), 7 * 60 + 15);
  assert.equal(parseClock("23h"), 23 * 60);
  assert.equal(parseClock("11:30 p.m."), 23 * 60 + 30);
});

test("parseClock rejects things that are not a time", () => {
  for (const bad of ["", "abc", "25:00", "7:75", "13pm", "0am", "7:5"]) assert.equal(parseClock(bad), null, bad);
});

test("bed now in the evening goes on tomorrow's row", () => {
  const s = sleepSlot({ date: "2026-11-10", minutes: 23 * 60 + 40 }, null);
  assert.deepEqual(s, { rowDate: "2026-11-11", bedDate: "2026-11-10", bedMinutes: 23 * 60 + 40 });
});

test("bed now after midnight goes on today's row", () => {
  const s = sleepSlot({ date: "2026-11-11", minutes: 30 }, null);
  assert.deepEqual(s, { rowDate: "2026-11-11", bedDate: "2026-11-11", bedMinutes: 30 });
});

test("an evening time typed in the morning is last night", () => {
  const s = sleepSlot({ date: "2026-11-11", minutes: 7 * 60 }, 23 * 60 + 30);
  assert.deepEqual(s, { rowDate: "2026-11-11", bedDate: "2026-11-10", bedMinutes: 23 * 60 + 30 });
});

test("an evening time typed in the evening is tonight", () => {
  const s = sleepSlot({ date: "2026-11-10", minutes: 20 * 60 }, 23 * 60);
  assert.deepEqual(s, { rowDate: "2026-11-11", bedDate: "2026-11-10", bedMinutes: 23 * 60 });
});

test("an after-midnight time follows the row's own day", () => {
  assert.deepEqual(sleepSlot({ date: "2026-11-11", minutes: 8 * 60 }, 60), { rowDate: "2026-11-11", bedDate: "2026-11-11", bedMinutes: 60 });
  assert.deepEqual(sleepSlot({ date: "2026-11-10", minutes: 21 * 60 }, 60), { rowDate: "2026-11-11", bedDate: "2026-11-11", bedMinutes: 60 });
});

test("a month change moves the row date correctly", () => {
  const s = sleepSlot({ date: "2026-11-30", minutes: 23 * 60 }, null);
  assert.equal(s.rowDate, "2026-12-01");
});

test("formatDuration and sleepMinutes", () => {
  assert.equal(formatDuration(435), "7h 15m");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(45), "45m");
  assert.equal(sleepMinutes("2026-11-10T04:30:00Z", "2026-11-10T12:00:00Z"), 450);
  assert.equal(sleepMinutes(null, "2026-11-10T12:00:00Z"), null);
  assert.equal(sleepMinutes("2026-11-10T12:00:00Z", "2026-11-10T04:30:00Z"), null);
});

test("heatLevel buckets scores and keeps free and unlogged days quiet", () => {
  assert.equal(heatLevel(90), "great");
  assert.equal(heatLevel(85), "great");
  assert.equal(heatLevel(70), "good");
  assert.equal(heatLevel(40), "mid");
  assert.equal(heatLevel(39), "low");
  assert.equal(heatLevel(null), "none");
  assert.equal(heatLevel(null, { free: true }), "free");
  assert.equal(heatLevel(80, { unlogged: true }), "none");
});

test("deltaText and oneDecimal", () => {
  assert.equal(deltaText(75, 60), "+15");
  assert.equal(deltaText(50, 60), "-10");
  assert.equal(deltaText(null, 60), "—");
  assert.equal(oneDecimal(7), "7");
  assert.equal(oneDecimal(7.26), "7.3");
  assert.equal(oneDecimal(null), "—");
});

console.log(`daily facts: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
