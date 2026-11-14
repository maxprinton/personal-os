// Backlog phases 1-6: board helpers, Telegram texts and parsers, bot view/buttons, the cron. Fake database, nothing is sent.
// Run: npm run test:backlog-app
import { fakeDb, type Row } from "./fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { capMeter, peek, countsFor, filterItems, groupByStatus, positionFor, sortByScore, staleNext, triageSnapshot, verifyDueItems, DEFAULT_SETTINGS, type BacklogItem } from "@/lib/backlog/board";
import { isBacklogView, isCaptureHelp, isIdeasView, mondaySummaryText, parseBacklogCapture, triageText, verifyNudgeText } from "@/lib/backlog/text";
import { backlogCallback, backlogView, handleBacklogCapture, ideasView, runBacklogCron, runStepsCron } from "@/lib/bot/backlog";
import { makeCtx } from "@/lib/bot/core";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const U = "u1";
const NOW = new Date("2026-11-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();
const item = (number: number, status: string, extra: Row = {}): Row => ({
  id: `i${number}`, user_id: U, number, title: `Item ${number}`, type: "feature", status, size: "S", area: null, spec_link: "claude/x.md", notes: null,
  parked_reason: null, value: null, effort: null, position: number * 1000, source: "web", reopened_count: 0, created_at: daysAgo(30),
  status_changed_at: daysAgo(1), verifying_since: null, done_at: null, deleted_at: null, ...extra,
});
const rows = (): Row[] => [
  item(1, "now"), item(2, "now", { type: "bug" }), item(3, "verifying", { verifying_since: daysAgo(8) }), item(4, "verifying", { verifying_since: daysAgo(2) }),
  item(5, "next", { status_changed_at: daysAgo(40), value: 3, effort: 1 }), item(6, "next", { value: 1, effort: 3 }), item(7, "inbox", { size: null, title: "Dark mode" }),
  item(8, "parked", { parked_reason: "later" }), item(9, "done", { done_at: daysAgo(2) }),
];
const asItems = (r: Row[]) => r as unknown as BacklogItem[];
const mk = (r = rows(), extra: Record<string, Row[]> = {}) => fakeDb({ backlog_items: r, backlog_events: [], backlog_settings: [], reminder_log: [], ...extra }) as unknown as SupabaseClient;

// ——— parsing ———
ok("idea: → feature", parseBacklogCapture("idea: dark mode")?.type === "feature");
ok("bug: → bug", parseBacklogCapture("Bug : tasks vanish")?.type === "bug");
ok("/idea text", parseBacklogCapture("/idea@MyBot dark mode")?.title === "dark mode");
ok("empty idea is not a capture", parseBacklogCapture("idea:   ") === null && parseBacklogCapture("a good idea: x") === null);
ok("/idea alone = help", isCaptureHelp("/idea") && isCaptureHelp("/bug") && !isCaptureHelp("/idea x"));
ok("views recognised", isBacklogView("/backlog") && isBacklogView("Backlog") && isIdeasView("/ideas") && !isBacklogView("my backlog is big"));

// ——— board helpers ———
{
  const it = asItems(rows());
  const c = countsFor(it);
  ok("Now count ignores bugs", c.now === 1 && c.verifying === 2 && c.next === 2, JSON.stringify(c));
  ok("countsFor can exclude one item", countsFor(it, "i1").now === 0);
  ok("group by status", groupByStatus(it).inbox.length === 1 && groupByStatus(it).done.length === 1);
  ok("filter by text, code and type", filterItems(it, { q: "dark" }).length === 1 && filterItems(it, { q: "BL-5" }).length === 1 && filterItems(it, { type: "bug" }).length === 1);
  ok("filter by size", filterItems(it, { size: "S" }).length === 8);
  ok("verify due after 7 days", verifyDueItems(it, NOW, 7).map((i) => i.number).join() === "3");
  ok("stale Next after 30 days", staleNext(it, NOW).map((i) => i.number).join() === "5");
  const sorted = sortByScore(asItems(rows()).filter((i) => i.status === "next"));
  ok("score sort puts high value / low effort first", sorted[0].number === 5);
  const col = asItems(rows()).filter((i) => i.status === "next");
  const p = positionFor(col, "i6", 5, "before");
  ok("positionFor lands before the target", p !== null && p < 5000, String(p));
  const t = triageSnapshot(it, DEFAULT_SETTINGS);
  ok("triage lists Next and Now counts", t.next.length > 0 && t.nowCap === 2);
  ok("triage text names the items", /BL-5/.test(triageText(t, "Done")));
}

// ——— texts ———
{
  const it = asItems(rows());
  ok("verify nudge mentions the code", /BL-3/.test(verifyNudgeText(it[2], NOW)));
  const s = mondaySummaryText(it, DEFAULT_SETTINGS, NOW);
  ok("Monday summary has content", !!s && /Now/.test(s), s ?? "null");
  ok("Monday summary skipped when the backlog is empty", mondaySummaryText([], DEFAULT_SETTINGS, NOW) === null);
}

// ——— bot ———
{
  const admin = mk();
  const c = makeCtx(admin, U, 1, "UTC");
  const r = await handleBacklogCapture(c, { type: "bug", title: "Streak resets" });
  ok("capture saves to the inbox", /saved to the Inbox/.test(r.text), r.text);
  const help = await handleBacklogCapture(c, "help");
  ok("help explains /idea and /bug", /\/idea/.test(help.text) && /\/bug/.test(help.text), help.text);
  const v = await backlogView(c);
  ok("/backlog shows Now and a verify button", /Now/.test(v.text) && JSON.stringify(v.kb).includes("bl:w:3"));
  const inbox = await ideasView(c);
  ok("/ideas lists the inbox", /Dark mode/.test(inbox.text));
}

// ——— buttons ———
{
  const admin = mk();
  const c = makeCtx(admin, U, 1, "UTC");
  const w = await backlogCallback(c, "w", "3");
  ok("worked → Done", /Done/.test(w.text ?? ""));
  const again = await backlogCallback(c, "w", "3");
  ok("tapping twice is a plain message, not a crash", typeof again.toast === "string");
  const x = await backlogCallback(c, "x", "4");
  ok("did not work → back to Now (reopened)", /Now/.test(x.text ?? "") || x.alert === true, JSON.stringify(x));
  const bad = await backlogCallback(c, "w", "abc");
  ok("bad button expires", bad.alert === true);
  const skip = await backlogCallback(c, "s", "0");
  ok("skip clears the keyboard", skip.kb?.length === 0);
}

// ——— cron ———
{
  const sent: string[] = [];
  const claimed = new Set<string>();
  const io = {
    claim: async (u: string, k: string, r: string) => (claimed.has(`${u}${k}${r}`) ? false : (claimed.add(`${u}${k}${r}`), true)),
    deliver: async (_c: number, t: string) => void sent.push(t),
  };
  const ON = { backlog_settings: [{ user_id: U, telegram_push: true }] as Row[] };
  const s = { user_id: U, telegram_chat_id: 1 };
  const early = await runBacklogCron(mk(rows(), ON), s, { date: "2026-11-13", minutes: 300 }, io, NOW);
  ok("nothing outside the windows", early === 0);
  const n1 = await runBacklogCron(mk(rows(), ON), s, { date: "2026-11-13", minutes: 9 * 60 + 35 }, io, NOW);
  ok("09:30 asks about the item in real use", n1 === 1 && /BL-3/.test(sent[0] ?? ""), sent.join("|"));
  const n2 = await runBacklogCron(mk(rows(), ON), s, { date: "2026-11-13", minutes: 9 * 60 + 40 }, io, NOW);
  ok("only once per day", n2 === 0);
  const mon = await runBacklogCron(mk(rows(), ON), s, { date: "2026-11-16", minutes: 8 * 60 + 40 }, io, NOW);
  ok("Monday sends the summary", mon >= 1, String(mon));
  const empty = await runBacklogCron(mk([], ON), s, { date: "2026-11-23", minutes: 8 * 60 + 40 }, io, NOW);
  ok("empty backlog stays quiet", empty === 0);

  // BL-97: with the default settings (telegram_push off) Telegram pushes nothing about the Backlog
  const before = sent.length;
  const offVerify = await runBacklogCron(mk(), s, { date: "2026-11-20", minutes: 9 * 60 + 35 }, io, NOW);
  const offMonday = await runBacklogCron(mk(), s, { date: "2026-11-23", minutes: 8 * 60 + 40 }, io, NOW);
  ok("push off: no did-it-work question and no Monday summary", offVerify === 0 && offMonday === 0 && sent.length === before, `${offVerify}/${offMonday}`);
  const offExplicit = await runBacklogCron(mk(rows(), { backlog_settings: [{ user_id: U, telegram_push: false, monday_summary: true }] }), s, { date: "2026-11-27", minutes: 9 * 60 + 35 }, io, NOW);
  ok("push off in the settings row also stays quiet", offExplicit === 0);
  const stepRow = { id: "st1", user_id: U, status: "pending", notified_at: null, deleted_at: null } as Row;
  const stepsDb = mk(rows(), { backlog_steps: [stepRow] });
  const offSteps = await runStepsCron(stepsDb, s, { deliver: io.deliver });
  ok("push off: steps send nothing and are not marked as notified", offSteps === 0 && stepRow.notified_at === null, String(offSteps));
}

{
  // Dashboard helpers (BL-95)
  const m1 = capMeter(1, 2);
  ok("cap meter half full", m1?.pct === 50 && m1.full === false, JSON.stringify(m1));
  const m2 = capMeter(3, 3);
  ok("cap meter at cap is full", m2?.pct === 100 && m2.full === true);
  const m3 = capMeter(4, 3);
  ok("cap meter never above 100", m3?.pct === 100 && m3.full === true);
  ok("no cap means no meter", capMeter(5, null) === null && capMeter(1, 0) === null);
  const pk = peek([1, 2, 3, 4, 5], 3);
  ok("peek shows the first items and counts the rest", pk.shown.join() === "1,2,3" && pk.hidden === 2);
  const pk2 = peek([1], 6);
  ok("peek with room hides nothing", pk2.shown.length === 1 && pk2.hidden === 0);
}

console.log(`\nbacklog app: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
