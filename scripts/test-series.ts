// Recurring tasks that repeat AFTER being done: date math, "done creates the next one", undo, pause, skip,
// healing, series management (fake database: nothing is sent).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-series.ts
import { fakeDb, type Row } from "./fake-supabase";
import { addInterval } from "@/lib/calendar/recurrence";
import { describe as describeParsed, extractRepeat, ruleGuess, ruleParseStrict, validateParsed } from "@/lib/parse";
import {
  cleanEvery,
  cleanPolicy,
  cleanUnit,
  createSeries,
  avgGapDays,
  describeSeries,
  endSeries,
  getSeriesBriefs,
  healSeries,
  loadSeriesViews,
  seriesStatusLine,
  makeTaskRecurring,
  nextText,
  pauseIfOpenDropped,
  pauseSeries,
  resumeSeries,
  skipCurrent,
  spawnNextForCompleted,
  syncSeriesOnToggle,
  undoSpawn,
  updateSeries,
} from "@/lib/calendar/series";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const TZ = "America/Guayaquil"; // UTC-5
const U = "u1";
/** Pretend it is `localIso` (a local wall-clock time in Guayaquil, written as UTC+0 for simplicity of the test). */
function setNow(iso: string) {
  (globalThis as { __practiceNow?: () => Date }).__practiceNow = () => new Date(iso);
}
// 2026-11-12T20:00Z = Nov 12, 15:00 in Guayaquil
setNow("2026-11-12T20:00:00Z");

// ---- Date math ----
ok("days", addInterval("2026-11-12", "days", 3) === "2026-11-15");
ok("days over month end", addInterval("2026-11-29", "days", 3) === "2026-12-02");
ok("weeks", addInterval("2026-11-12", "weeks", 2) === "2026-11-26");
ok("months", addInterval("2026-11-12", "months", 1) === "2026-12-12");
ok("months clamp Jan 31 -> Feb 28", addInterval("2027-01-31", "months", 1) === "2027-02-28");
ok("months clamp leap year", addInterval("2028-01-31", "months", 1) === "2028-02-29");
ok("months wrap the year", addInterval("2026-11-30", "months", 3) === "2027-02-28");
ok("months 14", addInterval("2026-11-12", "months", 14) === "2028-01-12");
ok("years", addInterval("2026-11-12", "years", 1) === "2027-11-12");
ok("years clamp Feb 29", addInterval("2028-02-29", "years", 1) === "2029-02-28");
ok("every 0 counts as 1", addInterval("2026-11-12", "days", 0) === "2026-11-13");
ok("none = same day", addInterval("2026-11-12", "none", 5) === "2026-11-12");
ok("cleanEvery", cleanEvery(0) === 1 && cleanEvery("7") === 7 && cleanEvery(9999) === 366 && cleanEvery("x") === 1 && cleanEvery(2.9) === 2);
ok("cleanUnit", cleanUnit("weeks") === "weeks" && cleanUnit("fortnights") === "days" && cleanUnit(undefined) === "days");
ok("cleanPolicy", cleanPolicy("backlog") === "backlog" && cleanPolicy("graveyard") === "migrate" && cleanPolicy(undefined) === "migrate");
ok("describeSeries", describeSeries("days", 3) === "Every 3 days after done" && describeSeries("weeks", 1) === "Every week after done");

// ---- Helpers for the state machine ----
const DEFAULTS = { tasks: { hold_placement: false, rolled_over_count: 0 } };
function world(opts: { every?: number; unit?: string; home?: string | null; active?: boolean; completedAt?: string | null } = {}) {
  const tables: Record<string, Row[]> = {
    task_series: [
      {
        id: "s1",
        user_id: U,
        title: "Clean the bathroom",
        home_block_type_id: opts.home ?? null,
        rollover_policy: "migrate",
        repeat_unit: opts.unit ?? "days",
        repeat_every: opts.every ?? 3,
        mode: "after_done",
        active: opts.active ?? true,
        current_task_id: "t1",
        last_done_task_id: null,
        last_done_on: null,
        deleted_at: null,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
    ],
    tasks: [
      {
        id: "t1",
        user_id: U,
        title: "Clean the bathroom",
        status: opts.completedAt === null ? "pending" : "completed",
        completed_at: opts.completedAt === undefined ? "2026-11-12T20:00:00Z" : opts.completedAt,
        scheduled_for: "2026-11-12",
        series_id: "s1",
        home_block_type_id: opts.home ?? null,
        rollover_policy: "migrate",
        occurrence_id: null,
        event_id: null,
        rolled_over_count: 0,
        deleted_at: null,
        hold_placement: false,
      },
    ],
    entity_tags: [],
    block_occurrences: [],
    block_types: [],
    block_slots: [],
  };
  return { tables, sb: fakeDb(tables, DEFAULTS) };
}
const live = (t: Row[]) => t.filter((r) => !r.deleted_at);
const series = (w: ReturnType<typeof world>) => w.tables.task_series[0];

// ---- Done creates the next one ----
{
  const w = world();
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  const next = live(w.tables.tasks).find((t) => t.id !== "t1");
  ok("spawn: result", !!r && r.due === "2026-11-15" && r.title === "Clean the bathroom", JSON.stringify(r));
  ok("spawn: new task due exactly 3 days after done", next?.scheduled_for === "2026-11-15");
  ok("spawn: pending, same series, same title", next?.status === "pending" && next?.series_id === "s1" && next?.title === "Clean the bathroom");
  ok("spawn: no block, no placement", next?.occurrence_id == null && r?.blockName === null);
  ok("spawn: series points at the new task", series(w).current_task_id === next?.id);
  ok("spawn: remembers what was done", series(w).last_done_task_id === "t1" && series(w).last_done_on === "2026-11-12");
  ok("spawn: old task stays done (history)", w.tables.tasks[0].status === "completed");
  ok("spawn: nextText", r ? nextText(r) === "Next: Sun, Nov 15" : false, r ? nextText(r) : "");
}

// ---- Wiggle room: the interval counts from the day it was actually finished ----
{
  const w = world({ completedAt: "2026-11-16T18:00:00Z" }); // finished on day 4 (Nov 16)
  setNow("2026-11-16T18:00:00Z");
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  ok("wiggle: finished day 4 -> next due Nov 19", r?.due === "2026-11-19", r?.due);
  setNow("2026-11-12T20:00:00Z");
}

// ---- Completion day is the LOCAL day (00:30 Guayaquil = 05:30Z counts as the new day) ----
{
  const w = world({ completedAt: "2026-11-13T05:30:00Z" });
  setNow("2026-11-13T05:30:00Z");
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  ok("local day: done at 00:30 local counts as Nov 13", r?.due === "2026-11-16" && series(w).last_done_on === "2026-11-13", r?.due);
  const w2 = world({ completedAt: "2026-11-13T04:30:00Z" }); // 23:30 local on Nov 12
  setNow("2026-11-13T04:30:00Z");
  const r2 = await spawnNextForCompleted(w2.sb, U, TZ, "t1");
  ok("local day: done at 23:30 local counts as Nov 12", r2?.due === "2026-11-15", r2?.due);
  setNow("2026-11-12T20:00:00Z");
}

// ---- Double completion creates only one ----
{
  const w = world();
  const [a, b] = await Promise.all([spawnNextForCompleted(w.sb, U, TZ, "t1"), spawnNextForCompleted(w.sb, U, TZ, "t1")]);
  ok("double tap: only one new task", live(w.tables.tasks).length === 2, String(live(w.tables.tasks).length));
  ok("double tap: only one call got a result", [a, b].filter(Boolean).length === 1);
  const c = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  ok("completing the old task again does nothing", c === null && live(w.tables.tasks).length === 2);
}

// ---- Months: Jan 31 + 1 month ----
{
  const w = world({ unit: "months", every: 1, completedAt: "2027-01-31T15:00:00Z" });
  setNow("2027-01-31T15:00:00Z");
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  ok("months: Jan 31 -> Feb 28", r?.due === "2027-02-28", r?.due);
  setNow("2026-11-12T20:00:00Z");
}

// ---- Finished long ago (edited afterwards): never a past date ----
{
  const w = world({ completedAt: "2026-11-01T15:00:00Z" });
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  ok("old completion: due is clamped to today", r?.due === "2026-11-12", r?.due);
}

// ---- Tags are copied ----
{
  const w = world();
  w.tables.entity_tags.push({ id: "e1", user_id: U, tag_id: "tg1", entity_type: "task", entity_id: "t1", deleted_at: null });
  w.tables.entity_tags.push({ id: "e2", user_id: U, tag_id: "tg2", entity_type: "task", entity_id: "t1", deleted_at: "2026-11-01T00:00:00Z" });
  w.tables.entity_tags.push({ id: "e3", user_id: "other", tag_id: "tg9", entity_type: "task", entity_id: "t1", deleted_at: null });
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  const copied = w.tables.entity_tags.filter((e) => e.entity_id === r?.taskId);
  ok("tags: live tag copied, removed one and other user's not", copied.length === 1 && copied[0].tag_id === "tg1" && copied[0].user_id === U, JSON.stringify(copied));
}

// ---- Home block: placed when the block exists that day, otherwise stays unassigned ----
{
  const w = world({ home: "b1" });
  w.tables.block_types.push({ id: "b1", user_id: U, name: "Cleaning", color: "#fff", deleted_at: null });
  w.tables.block_occurrences.push({ id: "o1", user_id: U, block_type_id: "b1", slot_id: null, origin_date: "2026-11-15", date: "2026-11-15", start_time: "09:00:00", end_time: "10:00:00", status: "scheduled", is_override: false });
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  const next = live(w.tables.tasks).find((t) => t.id !== "t1");
  ok("block exists on the due day: goes into it", next?.occurrence_id === "o1" && r?.blockName === "Cleaning", JSON.stringify([next?.occurrence_id, r?.blockName]));
  ok("block exists: text says where", r ? nextText(r) === "Next: Sun, Nov 15 · in Cleaning" : false);
  ok("block exists: home block copied", next?.home_block_type_id === "b1");

  const w2 = world({ home: "b1" });
  w2.tables.block_types.push({ id: "b1", user_id: U, name: "Cleaning", color: "#fff", deleted_at: null });
  w2.tables.block_occurrences.push({ id: "o2", user_id: U, block_type_id: "b1", slot_id: null, origin_date: "2026-11-18", date: "2026-11-18", start_time: "09:00:00", end_time: "10:00:00", status: "scheduled", is_override: false });
  const r2 = await spawnNextForCompleted(w2.sb, U, TZ, "t1");
  const next2 = live(w2.tables.tasks).find((t) => t.id !== "t1");
  ok("block NOT on the due day: stays on that day, unassigned (never waits for a later block)", next2?.scheduled_for === "2026-11-15" && next2?.occurrence_id == null && r2?.blockName === null, JSON.stringify([next2?.scheduled_for, next2?.occurrence_id]));
  ok("block NOT on the due day: still has its home block", next2?.home_block_type_id === "b1");

  const w3 = world({ home: "b1" }); // the block was deleted: home is gone, task simply stays on its day
  w3.tables.tasks[0].home_block_type_id = null;
  w3.tables.task_series[0].home_block_type_id = null;
  const r3 = await spawnNextForCompleted(w3.sb, U, TZ, "t1");
  ok("block removed from the series: due day, no block", r3?.due === "2026-11-15" && r3.blockName === null);
}

// ---- Paused / deleted / not a series task / other user ----
{
  const w = world({ active: false });
  ok("paused series: no new task", (await spawnNextForCompleted(w.sb, U, TZ, "t1")) === null && live(w.tables.tasks).length === 1);
  const w2 = world();
  w2.tables.tasks[0].series_id = null;
  ok("one-off task: nothing happens", (await spawnNextForCompleted(w2.sb, U, TZ, "t1")) === null && w2.tables.tasks.length === 1);
  const w3 = world({ completedAt: null });
  ok("not done yet: nothing happens", (await spawnNextForCompleted(w3.sb, U, TZ, "t1")) === null && w3.tables.tasks.length === 1);
  const w4 = world();
  ok("another user cannot trigger it", (await spawnNextForCompleted(w4.sb, "u2", TZ, "t1")) === null && w4.tables.tasks.length === 1);
  const w5 = world();
  w5.tables.task_series[0].deleted_at = "2026-11-10T00:00:00Z";
  ok("deleted series: no new task", (await spawnNextForCompleted(w5.sb, U, TZ, "t1")) === null);
  const w6 = world();
  w6.tables.task_series[0].current_task_id = "other-task";
  ok("a task that is not the open one of its series does not spawn", (await spawnNextForCompleted(w6.sb, U, TZ, "t1")) === null && w6.tables.tasks.length === 1);
}

// ---- Undo: reopening the done task removes an untouched successor ----
{
  const w = world();
  const r = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  w.tables.tasks[0].status = "pending";
  w.tables.tasks[0].completed_at = null;
  const u = await undoSpawn(w.sb, U, "t1");
  const succ = w.tables.tasks.find((t) => t.id === r?.taskId);
  ok("undo: restored", u.restored === true);
  ok("undo: successor removed", !!succ?.deleted_at);
  ok("undo: reopened task is the open one again", series(w).current_task_id === "t1" && series(w).last_done_task_id === null);
  // done again later: a fresh spawn from the new completion
  setNow("2026-11-17T18:00:00Z");
  w.tables.tasks[0].status = "completed";
  w.tables.tasks[0].completed_at = "2026-11-17T18:00:00Z";
  const again = await spawnNextForCompleted(w.sb, U, TZ, "t1");
  ok("undo then done again: counts from the new day", again?.due === "2026-11-20", again?.due);
  ok("undo then done again: exactly one live successor", live(w.tables.tasks).filter((t) => t.id !== "t1").length === 1);
  setNow("2026-11-12T20:00:00Z");

  const w2 = world();
  const r2 = await spawnNextForCompleted(w2.sb, U, TZ, "t1");
  const succ2 = w2.tables.tasks.find((t) => t.id === r2?.taskId)!;
  succ2.status = "completed"; // already done: keep it
  w2.tables.tasks[0].status = "pending";
  const u2 = await undoSpawn(w2.sb, U, "t1");
  ok("undo: a successor already done is kept", u2.restored === false && !succ2.deleted_at && series(w2).current_task_id === r2?.taskId);

  const w3 = world();
  const r3 = await spawnNextForCompleted(w3.sb, U, TZ, "t1");
  const succ3 = w3.tables.tasks.find((t) => t.id === r3?.taskId)!;
  succ3.rolled_over_count = 2; // it has been moved around: it is in use
  const u3 = await undoSpawn(w3.sb, U, "t1");
  ok("undo: a successor that has moved is kept", u3.restored === false && !succ3.deleted_at);

  const w4 = world();
  w4.tables.task_series[0].last_done_task_id = "older";
  ok("undo: reopening an older task of the series does nothing", (await undoSpawn(w4.sb, U, "t1")).restored === false);
}

// ---- syncSeriesOnToggle never throws ----
{
  const w = world();
  const a = await syncSeriesOnToggle(w.sb, U, TZ, "t1", true);
  ok("toggle done: returns the next", a.next?.due === "2026-11-15");
  w.tables.tasks[0].status = "pending";
  const b = await syncSeriesOnToggle(w.sb, U, TZ, "t1", false);
  ok("toggle undone: restored", b.restored === true && b.next === null);
  const broken = { from: () => { throw new Error("no such table"); } } as never;
  const c = await syncSeriesOnToggle(broken, U, TZ, "t1", true);
  ok("toggle: a broken database (no migration) never breaks ticking a task", c.next === null && c.restored === false);
}

// ---- Dropping the open task pauses the series ----
{
  const w = world({ completedAt: null });
  const d = await pauseIfOpenDropped(w.sb, U, "t1");
  ok("drop open task: series paused", d.paused === true && series(w).active === false && series(w).current_task_id === null);
  const w2 = world();
  w2.tables.tasks.push({ id: "t0", user_id: U, title: "x", status: "pending", series_id: "s1", deleted_at: null });
  ok("drop a task that is not the open one: nothing", (await pauseIfOpenDropped(w2.sb, U, "t0")).paused === false && series(w2).active === true);
  const w3 = world();
  w3.tables.tasks[0].series_id = null;
  ok("drop a one-off task: nothing", (await pauseIfOpenDropped(w3.sb, U, "t1")).paused === false);
}

// ---- Skip this time ----
{
  const w = world({ completedAt: null });
  const s = await skipCurrent(w.sb, U, TZ, "t1");
  ok("skip: old task archived", w.tables.tasks[0].status === "archived" && !!w.tables.tasks[0].archived_at);
  ok("skip: next one due today + interval", s?.due === "2026-11-15", s?.due);
  ok("skip: series follows the new one", series(w).current_task_id === s?.taskId && series(w).active === true);
  const w2 = world();
  ok("skip: a done task cannot be skipped", (await skipCurrent(w2.sb, U, TZ, "t1")) === null);
}

// ---- Creating a series ----
{
  const w = world();
  w.tables.task_series.length = 0;
  w.tables.tasks.length = 0;
  const bad = await createSeries(w.sb, U, TZ, { title: "   " });
  ok("create: title required", "error" in bad);
  const r = await createSeries(w.sb, U, TZ, { title: " Water plants ", unit: "days", every: 2 });
  ok("create: series and first task, due today", !("error" in r) && r.due === "2026-11-12" && w.tables.task_series.length === 1 && w.tables.tasks.length === 1);
  const s = w.tables.task_series[0];
  const t = w.tables.tasks[0];
  ok("create: fields", s.title === "Water plants" && s.repeat_every === 2 && s.repeat_unit === "days" && s.current_task_id === t.id && t.series_id === s.id && t.scheduled_for === "2026-11-12");
  const past = await createSeries(w.sb, U, TZ, { title: "Past", firstDue: "2020-01-01", unit: "weeks", every: 1 });
  ok("create: first due never in the past", !("error" in past) && past.due === "2026-11-12");
  const future = await createSeries(w.sb, U, TZ, { title: "Later", firstDue: "2026-12-01", unit: "months", every: 1 });
  ok("create: first due in the future is respected", !("error" in future) && future.due === "2026-12-01");
  const junk = await createSeries(w.sb, U, TZ, { title: "Junk", unit: "fortnights", every: 0, policy: "graveyard" });
  const js = w.tables.task_series.find((x) => x.title === "Junk")!;
  ok("create: junk values are cleaned", !("error" in junk) && js.repeat_unit === "days" && js.repeat_every === 1 && js.rollover_policy === "migrate");
}

// ---- Making an existing task recurring ----
{
  const w = world({ completedAt: null });
  w.tables.tasks.push({ id: "t9", user_id: U, title: "Call mom", status: "pending", scheduled_for: "2026-11-12", series_id: null, home_block_type_id: null, rollover_policy: "graveyard", deleted_at: null, hold_placement: false });
  const r = await makeTaskRecurring(w.sb, U, "t9", { unit: "weeks", every: 1 });
  const t9 = w.tables.tasks.find((t) => t.id === "t9")!;
  const s9 = w.tables.task_series.find((s) => s.id === (r as { seriesId: string }).seriesId)!;
  ok("recurring: task becomes the first of a new series", !("error" in r) && t9.series_id === s9.id && s9.current_task_id === "t9" && s9.title === "Call mom");
  ok("recurring: graveyard policy becomes migrate", t9.rollover_policy === "migrate" && s9.rollover_policy === "migrate");
  const again = await makeTaskRecurring(w.sb, U, "t9", { unit: "days", every: 5 });
  ok("recurring: second call only changes the interval", !("error" in again) && w.tables.task_series.length === 2 && s9.repeat_unit === "days" && s9.repeat_every === 5);
  w.tables.tasks.push({ id: "t10", user_id: U, title: "Done thing", status: "completed", series_id: null, deleted_at: null });
  ok("recurring: a done task cannot start repeating", "error" in (await makeTaskRecurring(w.sb, U, "t10", { unit: "days", every: 1 })));
  ok("recurring: unknown task", "error" in (await makeTaskRecurring(w.sb, U, "nope", { unit: "days", every: 1 })));
}

// ---- Editing a series ----
{
  const w = world({ completedAt: null });
  w.tables.tasks.push({ id: "old", user_id: U, title: "Clean the bathroom", status: "completed", series_id: "s1", deleted_at: null });
  const r = await updateSeries(w.sb, U, "s1", { title: "Deep clean bathroom", every: 4, unit: "weeks", policy: "backlog" }, TZ);
  ok("edit: series fields", "ok" in r && series(w).title === "Deep clean bathroom" && series(w).repeat_every === 4 && series(w).repeat_unit === "weeks" && series(w).rollover_policy === "backlog");
  ok("edit: the open task follows", w.tables.tasks[0].title === "Deep clean bathroom" && w.tables.tasks[0].rollover_policy === "backlog");
  ok("edit: finished tasks keep their history", w.tables.tasks.find((t) => t.id === "old")!.title === "Clean the bathroom");
  ok("edit: empty title rejected", "error" in (await updateSeries(w.sb, U, "s1", { title: " " }, TZ)));
  ok("edit: other user cannot", "error" in (await updateSeries(w.sb, "u2", "s1", { title: "hack" }, TZ)) && series(w).title === "Deep clean bathroom");
}

// ---- Pause / resume / end ----
{
  const w = world({ completedAt: null });
  await pauseSeries(w.sb, U, "s1");
  ok("pause", series(w).active === false);
  const r1 = await resumeSeries(w.sb, U, TZ, "s1");
  ok("resume: the open task still exists, nothing new", "ok" in r1 && r1.created === false && series(w).active === true && w.tables.tasks.length === 1);

  const w2 = world();
  w2.tables.task_series[0].active = false;
  w2.tables.task_series[0].current_task_id = null;
  w2.tables.task_series[0].last_done_task_id = "t1";
  const r2 = await resumeSeries(w2.sb, U, TZ, "s1");
  ok("resume: no open task -> one is created for today", "ok" in r2 && r2.created === true && live(w2.tables.tasks).length === 2 && series(w2).current_task_id !== null);
  const w3 = world();
  w3.tables.task_series[0].current_task_id = null;
  const r3 = await resumeSeries(w3.sb, U, TZ, "s1", "2026-11-20");
  ok("resume: on a chosen day", "ok" in r3 && r3.created === true && r3.due === "2026-11-20");

  const w4 = world({ completedAt: null });
  const e = await endSeries(w4.sb, U, "s1");
  ok("end: series deleted, open task becomes a one-off", "ok" in e && !!series(w4).deleted_at && w4.tables.tasks[0].series_id === null && w4.tables.tasks[0].status === "pending");
}

// ---- Healing (cron safety net) ----
{
  const NOW = Date.parse("2026-11-12T20:00:00Z");
  const w = world();
  w.tables.task_series[0].current_task_id = null; // a completion path forgot to spawn
  w.tables.task_series[0].last_done_task_id = "t1";
  const n = await healSeries(w.sb, U, TZ, NOW);
  ok("heal: spawns the missing next task", n === 1 && live(w.tables.tasks).length === 2 && series(w).current_task_id !== null);
  const n2 = await healSeries(w.sb, U, TZ, NOW);
  ok("heal: runs twice safely", n2 === 0 && live(w.tables.tasks).length === 2);

  const w2 = world();
  w2.tables.task_series[0].current_task_id = null;
  w2.tables.task_series[0].last_done_task_id = "t1";
  w2.tables.task_series[0].updated_at = new Date(NOW - 30_000).toISOString(); // touched 30 s ago: may be mid-spawn
  ok("heal: leaves a series that was just touched", (await healSeries(w2.sb, U, TZ, NOW)) === 0 && w2.tables.tasks.length === 1);

  const w3 = world({ active: false });
  w3.tables.task_series[0].current_task_id = null;
  w3.tables.task_series[0].last_done_task_id = "t1";
  ok("heal: leaves paused series", (await healSeries(w3.sb, U, TZ, NOW)) === 0);

  const w4 = world({ completedAt: null });
  w4.tables.task_series[0].current_task_id = null;
  w4.tables.task_series[0].last_done_task_id = "t1";
  ok("heal: last task not done -> nothing", (await healSeries(w4.sb, U, TZ, NOW)) === 0);

  const w5 = world();
  w5.tables.task_series[0].current_task_id = null;
  w5.tables.task_series[0].last_done_task_id = "t1";
  ok("heal: another user's series untouched", (await healSeries(w5.sb, "u2", TZ, NOW)) === 0 && w5.tables.tasks.length === 1);
}

// ---- What the screens show ----
{
  ok("avg gap: none with fewer than two", avgGapDays([]) === null && avgGapDays(["2026-11-01"]) === null);
  ok("avg gap: 3,4,5-day wiggle", avgGapDays(["2026-11-01", "2026-11-04", "2026-11-08", "2026-11-13"]) === 4, String(avgGapDays(["2026-11-01", "2026-11-04", "2026-11-08", "2026-11-13"])));
  ok("avg gap: any order, duplicates ignored", avgGapDays(["2026-11-08", "2026-11-04", "2026-11-04"]) === 4);
  ok("avg gap: one decimal", avgGapDays(["2026-11-01", "2026-11-04", "2026-11-08"]) === 3.5);

  const base = { active: true, repeat_unit: "days" as const, repeat_every: 3, last_done_on: "2026-11-10" as string | null };
  const open = { scheduled_for: "2026-11-13" };
  ok("status: due in the future", seriesStatusLine(base, open, "2026-11-12").text === "Due Fri, Nov 13", seriesStatusLine(base, open, "2026-11-12").text);
  ok("status: due today", seriesStatusLine(base, open, "2026-11-13").text === "Due today");
  const late = seriesStatusLine(base, { scheduled_for: "2026-11-15" }, "2026-11-15"); // rollover moved the task, lateness still counts from last done + 3
  ok("status: overdue counts from last done + interval, not from the moved task day", late.late && late.text.startsWith("Overdue by 2 days"), late.text);
  ok("status: 1 day late is singular", seriesStatusLine(base, open, "2026-11-14").text.startsWith("Overdue by 1 day ·"));
  ok("status: paused", seriesStatusLine({ ...base, active: false }, open, "2026-11-12").text === "Paused");
  ok("status: no open task", seriesStatusLine(base, null, "2026-11-12").text.startsWith("No open task"));
  ok("status: first task uses its own day", seriesStatusLine({ ...base, last_done_on: null }, { scheduled_for: "2026-11-12" }, "2026-11-12").text === "Due today");

  const w = world({ completedAt: null });
  w.tables.tasks.push(
    { id: "d1", user_id: U, title: "x", status: "completed", completed_at: "2026-11-01T15:00:00Z", series_id: "s1", deleted_at: null },
    { id: "d2", user_id: U, title: "x", status: "completed", completed_at: "2026-11-05T15:00:00Z", series_id: "s1", deleted_at: null },
    { id: "d3", user_id: U, title: "x", status: "completed", completed_at: "2026-11-09T15:00:00Z", series_id: "s1", deleted_at: null },
    { id: "z", user_id: "other", title: "x", status: "completed", completed_at: "2026-11-02T15:00:00Z", series_id: "s1", deleted_at: null }
  );
  const views = await loadSeriesViews(w.sb, U, TZ);
  ok("views: one series with its open task", views.length === 1 && views[0].open?.id === "t1");
  ok("views: history newest first and average gap", views[0].history.join(",") === "2026-11-09,2026-11-05,2026-11-01" && views[0].avgGap === 4, JSON.stringify([views[0].history, views[0].avgGap]));
  ok("views: nothing for another user", (await loadSeriesViews(w.sb, "u2", TZ)).length === 0);

  const briefs = await getSeriesBriefs(w.sb, U, ["t1", "d1", "nope"]);
  ok("briefs: tasks of a series get a label", briefs.get("t1")?.label === "Every 3 days after done" && briefs.get("d1")?.every === 3 && !briefs.has("nope"));
  ok("briefs: empty input", (await getSeriesBriefs(w.sb, U, [])).size === 0);
  const broken = { from: () => { throw new Error("no such column series_id"); } } as never;
  ok("briefs: a database without the migration gives an empty map, not an error", (await getSeriesBriefs(broken, U, ["t1"])).size === 0);
}

// ---- Telegram / capture: "every 3 days" in a task ----
{
  const r = (t: string) => extractRepeat(t);
  ok("repeat: every 3 days", JSON.stringify(r("clean the bathroom every 3 days")) === JSON.stringify({ text: "clean the bathroom", repeat: { unit: "days", every: 3 } }), JSON.stringify(r("clean the bathroom every 3 days")));
  ok("repeat: cada 2 semanas", r("regar las plantas cada 2 semanas").repeat?.unit === "weeks" && r("regar las plantas cada 2 semanas").repeat?.every === 2 && r("regar las plantas cada 2 semanas").text === "regar las plantas");
  ok("repeat: cada 3 días (accent)", r("limpiar el baño cada 3 días").repeat?.unit === "days" && r("limpiar el baño cada 3 días").text === "limpiar el baño");
  ok("repeat: every month = 1", r("check filters every month").repeat?.unit === "months" && r("check filters every month").repeat?.every === 1);
  ok("repeat: each week", r("laundry each week").repeat?.unit === "weeks");
  ok("repeat: cada mes / cada año", r("revisar cada mes").repeat?.unit === "months" && r("renovar cada año").repeat?.unit === "years");
  ok("repeat: every other day = 2", r("floss every other day").repeat?.every === 2 && r("floss every other day").repeat?.unit === "days");
  ok("repeat: cada día", r("estirar cada día").repeat?.unit === "days" && r("estirar cada día").repeat?.every === 1);
  ok("repeat: 'after done' words are removed too", r("clean the bathroom every 3 days after I finish it").text === "clean the bathroom" && r("limpiar cada 3 días después de hacerla").text === "limpiar");
  ok("repeat: in the middle of the text", r("every 2 days water plants").text === "water plants" && r("every 2 days water plants").repeat?.every === 2);
  ok("repeat: weekday names are NOT a repeat", r("gym every monday").repeat === null && r("gym every monday").text === "gym every monday");
  ok("repeat: nothing to repeat if the title would be empty", r("every 3 days").repeat === null);
  ok("repeat: no repeat words", r("buy milk").repeat === null && r("buy milk").text === "buy milk");
  ok("repeat: huge number is capped", r("x every 999 days").repeat?.every === 366);

  const strict = ruleParseStrict("t: clean the bathroom every 3 days tomorrow", "2026-11-12");
  ok("parse: t: with repeat and a date", strict?.kind === "task" && strict.title === "Clean the bathroom" && strict.date === "2026-11-13" && strict.repeat?.every === 3 && strict.repeat.unit === "days", JSON.stringify(strict));
  const es = ruleParseStrict("tarea: limpiar el baño cada 3 días", "2026-11-12");
  ok("parse: tarea: cada 3 días", es?.kind === "task" && es.title === "Limpiar el baño" && es.repeat?.every === 3);
  const plain = ruleParseStrict("t: call mom", "2026-11-12");
  ok("parse: a normal task has no repeat key at all", plain?.kind === "task" && !("repeat" in plain));
  const guess = ruleGuess("water plants every 2 days", "2026-11-12");
  ok("guess: a short text with a repeat becomes a repeating task", guess.kind === "task" && guess.repeat?.every === 2);
  ok("describe: mentions the repeat", describeParsed({ kind: "task", title: "Clean", date: null, repeat: { unit: "days", every: 3 } }) === "Task: Clean · repeats every 3 days after done", describeParsed({ kind: "task", title: "Clean", date: null, repeat: { unit: "days", every: 3 } }));
  ok("describe: every 1 month", describeParsed({ kind: "task", title: "Check", date: null, repeat: { unit: "months", every: 1 } }).endsWith("repeats every month after done"));
  ok("AI json: valid repeat kept", (validateParsed({ kind: "task", title: "Water", date: null, repeat: { unit: "weeks", every: 2 } }) as { repeat?: { every: number } } | null)?.repeat?.every === 2);
  const bad = validateParsed({ kind: "task", title: "Water", date: null, repeat: { unit: "fortnights", every: 2 } });
  ok("AI json: invalid repeat dropped, task kept", bad?.kind === "task" && !("repeat" in bad));
  const bad2 = validateParsed({ kind: "task", title: "Water", date: null, repeat: { unit: "days", every: 0 } });
  ok("AI json: zero interval dropped", bad2?.kind === "task" && !("repeat" in bad2));
}

console.log(`${fail ? "❌" : "✅"} recurring tasks: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
