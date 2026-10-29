// Tests of note templates (pure parts): variables, schedule math, the "untouched" fingerprint, and that
// the starter templates' Markdown survives the editor (parse → serialize keeps them the same).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-templates.ts
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { BlockAttrs, NHeading, NParagraph, TextColor } from "@/lib/editor/nodes/text";
import { Callout } from "@/lib/editor/nodes/callout";
import { MentionPage, PageLink } from "@/lib/editor/nodes/page";
import {
  cleanSchedule,
  creationMoment,
  describeSchedule,
  dueKey,
  expandVars,
  formatRun,
  isUntouched,
  isoWeek,
  madeHash,
  matchesDate,
  nextKeyToMake,
  nextRun,
  remapNoteLinks,
  timingChanged,
} from "@/lib/notes-db/tpl-core";
import { STARTERS } from "@/lib/notes-db/tpl-starters";
import type { Schedule } from "@/lib/notes-db/types";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.log(`✗ ${name}\n   want ${w}\n   got  ${g}`);
  }
}

const TZ = "America/Guayaquil"; // UTC-5, no DST
const at = (iso: string) => new Date(iso);
const S = (s: Partial<Schedule>) => cleanSchedule({ time: "09:00", ...s } as Schedule)!;

// ---- Variables
eq("date", expandVars("{{date}}", "2026-10-29", "21:00"), "Oct 29, 2026");
eq("date_iso", expandVars("{{date_iso}}", "2026-10-29", "21:00"), "2026-10-29");
eq("weekday", expandVars("{{weekday}}", "2026-10-29", "21:00"), "Thursday");
eq("week", expandVars("{{week}}", "2026-10-29", "21:00"), "44");
eq("month/year", expandVars("{{month}} {{year}}", "2026-10-29", "21:00"), "October 2026");
eq("time", expandVars("{{time}}", "2026-10-29", "21:00"), "21:00");
eq("fecha", expandVars("Diario — {{fecha}}", "2026-10-29", "21:00"), "Diario — jueves 29 de octubre");
eq("dia/mes", expandVars("{{dia}} · {{mes}}", "2026-11-01", "08:00"), "domingo · noviembre");
eq("spaces + case", expandVars("{{ Fecha }}", "2026-10-29", "21:00"), "jueves 29 de octubre");
eq("unknown stays", expandVars("{{nope}} {{date_iso}} {x}", "2026-10-29", "21:00"), "{{nope}} 2026-10-29 {x}");
eq("no vars", expandVars("plain", "2026-10-29", "21:00"), "plain");
eq("iso week 2026-01-01 (Thu)", isoWeek("2026-01-01"), 1);
eq("iso week 2027-01-01 (Fri) = 53 of 2026", isoWeek("2027-01-01"), 53);
eq("iso week 2025-12-29 (Mon) = 1 of 2026", isoWeek("2025-12-29"), 1);
eq("iso week 2024-12-30", isoWeek("2024-12-30"), 1);

// ---- Schedule: cleaning
eq("clean null", cleanSchedule(null), null);
eq("clean bad freq", cleanSchedule({ freq: "hourly" } as never), null);
eq("clean weekly days", cleanSchedule({ freq: "weekly", days: [5, 1, 9, 1], time: "7:00" } as never), { freq: "weekly", time: "09:00", days: [1, 5], until: null });
eq("clean monthly", cleanSchedule({ freq: "monthly", monthDay: 40, time: "21:00", advanceHours: 3 }), { freq: "monthly", time: "21:00", monthDay: 1, advanceHours: 3, until: null });

// ---- Daily
const daily = S({ freq: "daily", time: "21:00" });
// 2026-10-29 20:59 local = 2026-10-30 01:59Z → yesterday's (28) is the latest due
eq("daily before time → yesterday", dueKey(daily, TZ, at("2026-10-30T01:59:00Z")), "2026-10-28");
eq("daily after time → today", dueKey(daily, TZ, at("2026-10-30T02:00:00Z")), "2026-10-29");
eq("daily lastKey today → none", dueKey(daily, TZ, at("2026-10-30T02:05:00Z"), "2026-10-29"), null);
eq("daily missed 3 days → only latest", dueKey(daily, TZ, at("2026-10-30T02:05:00Z"), "2026-10-26"), "2026-10-29");
eq("daily next", nextRun(daily, TZ, at("2026-10-29T15:00:00Z"))?.key, "2026-10-29");
eq("daily next at", nextRun(daily, TZ, at("2026-10-29T15:00:00Z"))?.at.toISOString(), "2026-10-30T02:00:00.000Z");
eq("formatRun", formatRun(nextRun(daily, TZ, at("2026-10-30T03:00:00Z"))!.at, TZ), "Fri Oct 30, 21:00");

// ---- advanceHours crossing midnight: the 00:30 note of the 30th, created 3 h before = 29th 21:30
const adv = S({ freq: "daily", time: "00:30", advanceHours: 3 });
eq("advance creation moment", creationMoment(adv, "2026-10-30", TZ).toISOString(), "2026-10-30T02:30:00.000Z");
eq("advance: 29th 21:29 local → key 29", dueKey(adv, TZ, at("2026-10-30T02:29:00Z")), "2026-10-29");
eq("advance: 29th 21:30 local → key 30 (tomorrow)", dueKey(adv, TZ, at("2026-10-30T02:30:00Z")), "2026-10-30");
eq("advance next from 29th 22:00 → 31st", nextRun(adv, TZ, at("2026-10-30T03:00:00Z"), "2026-10-30")?.key, "2026-10-31");
const adv48 = S({ freq: "weekly", days: [1], time: "08:00", advanceHours: 48 });
// Monday Nov 2 08:00 note created Saturday Oct 31 08:00
eq("advance 48h weekly", dueKey(adv48, TZ, at("2026-10-31T13:00:00Z"), "2026-10-26"), "2026-11-02");
eq("advance 48h weekly, just before", dueKey(adv48, TZ, at("2026-10-31T12:59:00Z"), "2026-10-26"), null);

// ---- Weekly
const wk = S({ freq: "weekly", days: [1, 3, 5], time: "07:00" }); // Mon Wed Fri
eq("weekly matches Fri 30", matchesDate(wk, "2026-10-30"), true);
eq("weekly not Thu 29", matchesDate(wk, "2026-10-29"), false);
eq("weekly due on Thu → Wed 28", dueKey(wk, TZ, at("2026-10-29T20:00:00Z")), "2026-10-28");
eq("weekly next from Thu → Fri 30", nextRun(wk, TZ, at("2026-10-29T20:00:00Z"))?.key, "2026-10-30");
eq("weekly next from Fri 08:00 → Mon Nov 2", nextRun(wk, TZ, at("2026-10-30T13:00:00Z"))?.key, "2026-11-02");

// ---- Monthly (31 → last day of shorter months)
const m31 = S({ freq: "monthly", monthDay: 31, time: "10:00" });
eq("monthly 31 in Feb → 28", matchesDate(m31, "2027-02-28"), true);
eq("monthly 31 not Feb 27", matchesDate(m31, "2027-02-27"), false);
eq("monthly 31 in Nov → 30", nextRun(m31, TZ, at("2026-11-05T12:00:00Z"))?.key, "2026-11-30");
eq("monthly 31 leap Feb 2028 → 29", nextRun(m31, TZ, at("2028-02-10T12:00:00Z"))?.key, "2028-02-29");
eq("monthly 30 Feb → 28", nextRun(S({ freq: "monthly", monthDay: 30, time: "10:00" }), TZ, at("2027-02-01T12:00:00Z"))?.key, "2027-02-28");
eq("monthly 15 due", dueKey(S({ freq: "monthly", monthDay: 15, time: "10:00" }), TZ, at("2026-10-29T12:00:00Z")), "2026-10-15");

// ---- Yearly
const birthday = S({ freq: "yearly", month: 2, monthDay: 29, time: "08:00" });
eq("yearly Feb 29 → Feb 28 in 2027", nextRun(birthday, TZ, at("2026-10-29T12:00:00Z"))?.key, "2027-02-28");
eq("yearly Feb 29 → Feb 29 in 2028", nextRun(birthday, TZ, at("2027-03-01T12:00:00Z"))?.key, "2028-02-29");
eq("yearly due (last one)", dueKey(S({ freq: "yearly", month: 1, monthDay: 1, time: "00:00" }), TZ, at("2026-10-29T12:00:00Z")), "2026-01-01");

// ---- start / until / paused
eq("until: no note after it", dueKey(S({ freq: "daily", time: "09:00", until: "2026-10-27" }), TZ, at("2026-10-29T20:00:00Z")), "2026-10-27");
eq("until passed + made → none", dueKey(S({ freq: "daily", time: "09:00", until: "2026-10-27" }), TZ, at("2026-10-29T20:00:00Z"), "2026-10-27"), null);
eq("until: next none", nextRun(S({ freq: "daily", time: "09:00", until: "2026-10-28" }), TZ, at("2026-10-29T20:00:00Z")), null);
eq("until: today still ok", nextRun(S({ freq: "daily", time: "21:00", until: "2026-10-29" }), TZ, at("2026-10-29T20:00:00Z"))?.key, "2026-10-29");
eq("start in future: not due", dueKey(S({ freq: "daily", time: "09:00", start: "2026-11-01" }), TZ, at("2026-10-29T20:00:00Z")), null);
eq("start in future: next = start", nextRun(S({ freq: "daily", time: "09:00", start: "2026-11-01" }), TZ, at("2026-10-29T20:00:00Z"))?.key, "2026-11-01");
eq("paused: nothing due", dueKey(S({ freq: "daily", time: "09:00", paused: true }), TZ, at("2026-10-29T20:00:00Z")), null);
eq("paused: no next", nextRun(S({ freq: "daily", time: "09:00", paused: true }), TZ, at("2026-10-29T20:00:00Z")), null);
eq("create one now: due first", nextKeyToMake(daily, TZ, at("2026-10-30T03:00:00Z"), "2026-10-28"), "2026-10-29");
eq("create one now: then the next", nextKeyToMake(daily, TZ, at("2026-10-30T03:00:00Z"), "2026-10-29"), "2026-10-30");
eq("timingChanged off→on", timingChanged(null, daily), true);
eq("timingChanged notify only", timingChanged(daily, { ...daily, notify: true }), false);
eq("timingChanged time", timingChanged(daily, { ...daily, time: "22:00" }), true);
eq("describe weekdays", describeSchedule(S({ freq: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" })), "Weekdays at 08:00");
eq("describe yearly", describeSchedule(birthday), "Every Feb 29 at 08:00");

// Another timezone with DST: New York, the day the clocks go back (Nov 1, 2026)
eq("DST NY 09:00 after change", nextRun(S({ freq: "daily", time: "09:00" }), "America/New_York", at("2026-11-01T05:00:00Z"))?.at.toISOString(), "2026-11-01T14:00:00.000Z");
eq("DST NY 09:00 before change", creationMoment(S({ freq: "daily", time: "09:00" }), "2026-10-31", "America/New_York").toISOString(), "2026-10-31T13:00:00.000Z");

// ---- Untouched
const made = { title: "Diario — jueves 29 de octubre", content: "## ¿Cómo me siento?\n\n- [ ] Primera cosa\n", props: { a: "diario", b: ["x"] } };
const h = madeHash(made);
eq("untouched same", isUntouched({ ...made, template: { made: { hash: h } } }), true);
eq("untouched: props order doesn't matter", isUntouched({ ...made, props: { b: ["x"], a: "diario" }, template: { made: { hash: h } } }), true);
eq("untouched: re-saved spacing doesn't count", isUntouched({ ...made, content: "## ¿Cómo me siento?\n- [ ] Primera cosa", template: { made: { hash: h } } }), true);
eq("touched: text", isUntouched({ ...made, content: made.content + "\nhola", template: { made: { hash: h } } }), false);
eq("touched: to-do ticked", isUntouched({ ...made, content: made.content.replace("[ ]", "[x]"), template: { made: { hash: h } } }), false);
eq("touched: title", isUntouched({ ...made, title: "Otro", template: { made: { hash: h } } }), false);
eq("touched: value", isUntouched({ ...made, props: { ...made.props, c: true }, template: { made: { hash: h } } }), false);
eq("no fingerprint = touched", isUntouched({ ...made, template: {} }), false);

// ---- Links to copied sub-pages
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
eq("remap", remapNoteLinks(`<page url="/notes/${A}">Sub</page> <mention-page url="/notes/${C}">X</mention-page>`, new Map([[A, B]])), `<page url="/notes/${B}">Sub</page> <mention-page url="/notes/${C}">X</mention-page>`);

// ---- Starter templates: the editor keeps them as written
const md = new MarkdownManager({
  markedOptions: { gfm: true },
  extensions: [StarterKit.configure({ paragraph: false, heading: false, blockquote: false }), NParagraph, NHeading, BlockAttrs, TextColor, Blockquote, TaskList, TaskItem.configure({ nested: true }), Callout, PageLink, MentionPage],
});
const norm = (s: string) => s.replace(/\n{2,}/g, "\n\n").trim();
for (const s of STARTERS) {
  let out = "";
  try {
    out = md.serialize(md.parse(s.content));
  } catch (e) {
    out = `threw ${(e as Error).message}`;
  }
  eq(`starter "${s.starter}" round-trips`, norm(out), norm(s.content));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
