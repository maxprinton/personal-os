import assert from "node:assert/strict";
import { findPatterns, type DayRow } from "@/lib/patterns";

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; };
const day = (i: number, o: Partial<DayRow> = {}): DayRow => ({
  date: `2026-12-${String((i % 28) + 1).padStart(2, "0")}`, score: 70, unlogged: false, free: false, mood: 6, energy: 6,
  sleepMin: 450, bedAfter18: 330, spent: 10, focus: null, ...o,
});

t("locked below 28 logged days", () => {
  const r = findPatterns(Array.from({ length: 20 }, (_, i) => day(i)));
  assert.equal(r.unlocked, false);
  assert.equal(r.patterns.length, 0);
  assert.equal(r.loggedDays, 20);
});
t("unlogged days do not count", () => {
  const rows = [...Array.from({ length: 20 }, (_, i) => day(i)), ...Array.from({ length: 20 }, (_, i) => day(i, { unlogged: true, score: null }))];
  assert.equal(findPatterns(rows).unlocked, false);
});
t("sleep vs score is found", () => {
  const rows = Array.from({ length: 40 }, (_, i) => (i % 2 ? day(i, { sleepMin: 480, score: 85 }) : day(i, { sleepMin: 360, score: 60 })));
  const r = findPatterns(rows);
  assert.equal(r.unlocked, true);
  const p = r.patterns.find((x) => x.id === "sleep-score");
  assert.ok(p);
  assert.match(p.text, /tends to be 25 points higher/);
});
t("small differences are ignored", () => {
  const rows = Array.from({ length: 40 }, (_, i) => (i % 2 ? day(i, { sleepMin: 480, score: 72 }) : day(i, { sleepMin: 360, score: 70 })));
  assert.equal(findPatterns(rows).patterns.find((x) => x.id === "sleep-score"), undefined);
});
t("a group under 8 days is ignored", () => {
  const rows = Array.from({ length: 40 }, (_, i) => (i < 5 ? day(i, { sleepMin: 300, score: 20 }) : day(i, { sleepMin: 480, score: 80 })));
  assert.equal(findPatterns(rows).patterns.find((x) => x.id === "sleep-score"), undefined);
});
t("late nights vs energy", () => {
  const rows = Array.from({ length: 40 }, (_, i) => (i % 2 ? day(i, { bedAfter18: 450, energy: 4 }) : day(i, { bedAfter18: 300, energy: 7 })));
  const p = findPatterns(rows).patterns.find((x) => x.id === "late-energy");
  assert.ok(p);
  assert.match(p.text, /lower/);
});

console.log(`patterns: ${passed} passed, 0 failed`);
