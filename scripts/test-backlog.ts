// Backlog rules (TypeScript mirror of the database trigger): every shared scenario, move options, codes, due dates.
// The same scenarios run against the real trigger with scripts/test-backlog-sql.mjs (needs Postgres; Claude runs it).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-backlog.ts
import { readFileSync } from "node:fs";
import {
  CREATE_STATUSES,
  DEFAULT_CAPS,
  STATUSES,
  TRANSITIONS,
  checkCreate,
  checkMove,
  cleanTitle,
  itemCode,
  missingFor,
  moveOptions,
  parseCode,
  verifyDue,
  type BacklogStatus,
  type BacklogType,
  type RuleItem,
} from "@/lib/backlog/rules";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

type Fixture = {
  caps: { now: number; next: number; verifying: number };
  scenarios: {
    name: string;
    item: Partial<RuleItem>;
    to: BacklogStatus;
    counts?: { now?: number; next?: number; verifying?: number };
    ok?: boolean;
    error?: string;
    reopen?: boolean;
  }[];
  creates: {
    name: string;
    item: Partial<RuleItem>;
    counts?: { now?: number; next?: number; verifying?: number };
    ok?: boolean;
    error?: string;
  }[];
};
const fx = JSON.parse(readFileSync("scripts/fixtures/backlog-scenarios.json", "utf8")) as Fixture;
const base = (it: Partial<RuleItem>): RuleItem => ({ type: "feature" as BacklogType, status: "inbox", ...it });

ok("default caps match the fixture", DEFAULT_CAPS.now === fx.caps.now && DEFAULT_CAPS.next === fx.caps.next && DEFAULT_CAPS.verifying === fx.caps.verifying);

// ---- shared scenarios (same ones the trigger runs) ----
for (const s of fx.scenarios) {
  const res = checkMove(base(s.item), s.to, s.counts ?? {}, DEFAULT_CAPS);
  if (s.ok) {
    ok(s.name, res.ok === true, res.ok ? "" : res.message);
    if (s.reopen) ok(`${s.name} (reopen flag)`, res.ok === true && res.reopen === true);
    else ok(`${s.name} (no reopen flag)`, res.ok === true && res.reopen === false);
  } else {
    ok(s.name, res.ok === false && res.message === s.error, res.ok ? "allowed" : res.message);
  }
}
for (const s of fx.creates) {
  const res = checkCreate(base(s.item), s.counts ?? {}, DEFAULT_CAPS);
  if (s.ok) ok(s.name, res.ok === true, res.ok ? "" : res.message);
  else ok(s.name, res.ok === false && res.message === s.error, res.ok ? "allowed" : res.message);
}

// ---- structure ----
ok("every status has a transition list", STATUSES.every((st) => Array.isArray(TRANSITIONS[st])));
ok("no status moves to itself", STATUSES.every((st) => !TRANSITIONS[st].includes(st)));
ok("done is only reachable from verifying", STATUSES.filter((st) => TRANSITIONS[st].includes("done")).join() === "verifying");
ok("create statuses exclude verifying and done", !CREATE_STATUSES.includes("verifying") && !CREATE_STATUSES.includes("done"));
ok("same status is a no-op", checkMove(base({ status: "now" }), "now").ok === true);

// ---- caps are per column and bugs are exempt from the Now cap, not from the others ----
const sized = { size: "S" as const, spec_link: "claude/x.md" };
ok("bug into Next still obeys the Next cap", checkMove(base({ type: "bug", status: "inbox", size: "S" }), "next", { next: 5 }).ok === false);
ok("bug into Verifying still obeys the Verifying cap", checkMove(base({ type: "bug", status: "now" }), "verifying", { verifying: 3 }).ok === false);
ok("moving down is never blocked by a Now cap", checkMove(base({ status: "now", ...sized }), "later", { now: 2 }).ok === true);
ok("custom cap is used in the message", (() => {
  const r = checkMove(base({ status: "next", ...sized }), "now", { now: 4 }, { now: 4, next: 5, verifying: 3 });
  return r.ok === false && r.message === "Now already has 4 items. Finish, verify or move one first.";
})());

// ---- missing fields and move options (for the UI) ----
ok("missing size and spec for Now", missingFor(base({ status: "later" }), "now").join() === "size,spec_link");
ok("bug needs nothing for Now", missingFor(base({ type: "bug", status: "later" }), "now").length === 0);
ok("parking asks for a reason", missingFor(base({ status: "inbox" }), "parked").join() === "reason");
const opts = moveOptions(base({ status: "later", ...sized }), { now: 2 });
ok("Now option is blocked when Now is full", opts.find((o) => o.to === "now")?.ok === false);
ok("Next option is fine", opts.find((o) => o.to === "next")?.ok === true);
const inboxOpts = moveOptions(base({ status: "inbox" }), {});
ok("inbox -> next is OK once the size is collected (missing: size)", (() => {
  const o = inboxOpts.find((x) => x.to === "next");
  return o?.ok === true && o.missing.join() === "size";
})());
ok("verifying -> now is flagged as a reopen", moveOptions(base({ status: "verifying", ...sized }), { now: 2 }).find((o) => o.to === "now")?.reopen === true);
ok("options only list allowed transitions", inboxOpts.map((o) => o.to).sort().join() === TRANSITIONS.inbox.slice().sort().join());

// ---- codes ----
ok("code", itemCode(14) === "BL-14");
ok("parse BL-12", parseCode("BL-12") === 12);
ok("parse bl12", parseCode("bl12") === 12);
ok("parse #12", parseCode("#12") === 12);
ok("parse 12", parseCode(" 12 ") === 12);
ok("parse nonsense", parseCode("BL-") === null && parseCode("abc") === null && parseCode("12x") === null);

// ---- Verifying due ----
const now = new Date("2026-11-20T12:00:00Z");
ok("not due after 6 days", verifyDue("2026-11-14T12:00:01Z", now, 7) === false);
ok("due after exactly 7 days", verifyDue("2026-11-13T12:00:00Z", now, 7) === true);
ok("due after 10 days", verifyDue(new Date("2026-11-10T12:00:00Z"), now, 7) === true);
ok("custom days", verifyDue("2026-11-13T12:00:00Z", now, 10) === false);
ok("null is never due", verifyDue(null, now) === false && verifyDue(undefined, now) === false);
ok("garbage date is never due", verifyDue("not a date", now) === false);

// ---- titles ----
ok("title is trimmed and flattened", cleanTitle("  Add   dark\nmode  ") === "Add dark mode");
ok("empty title is rejected", cleanTitle("   ") === null);
ok("title is capped at 200", (cleanTitle("x".repeat(300)) ?? "").length === 200);

console.log(`\nbacklog rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
