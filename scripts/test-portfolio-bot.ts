// Portfolio add-on, Phase 8: Telegram commands (/portfolio, /inbox) and the weekly nudge. Fake database, nothing is sent.
// Run: npm run test:portfolio-bot
import { fakeDb, type Row } from "./fake-supabase";
import { ago, inboxText, isInboxRequest, isPortfolioSummary, nudgeText, portfolioText, runPortfolioNudge, weekKey, weekday } from "@/lib/bot/portfolio";
import { loadSlotViews } from "@/lib/portfolio/link";
import { HELP } from "@/lib/telegram";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxRow } from "@/lib/portfolio/inbox";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const U = "user-1";
const slot = (id: string, kind: string, key: string, extra: Row = {}): Row => ({ id, user_id: U, kind, key, previous_keys: [], position: 0, featured: false, archived: false, meta: {}, langs: {}, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...extra });
const note = (id: string, slotId: string, lang: string, title: string, updated: string, extra: Row = {}): Row => ({ id, user_id: U, title, page: null, updated_at: updated, deleted_at: null, portfolio_slot_id: slotId, portfolio_lang: lang, ...extra });
const page = (slotId: string, lang: string, published: string, live = true): Row => ({ user_id: U, slot_id: slotId, lang, version: 1, is_live: live, published_at: published, slug: "x" });

function db(extra: Record<string, Row[]> = {}) {
  return fakeDb({
    portfolio_slots: [slot("s-home", "home", "home"), slot("s-os", "project", "os"), slot("s-blog", "article", "first-post"), slot("s-old", "project", "old", { archived: true })],
    notes: [
      note("n1", "s-home", "en", "Home", "2026-10-01T00:00:00Z"),
      note("n2", "s-os", "en", "Personal OS", "2026-11-05T00:00:00Z"), // edited after publishing
      note("n3", "s-os", "es", "Personal OS", "2026-10-02T00:00:00Z"),
      note("n4", "s-blog", "en", "My first post", "2026-11-01T00:00:00Z"), // never published
    ],
    portfolio_pages: [page("s-home", "en", "2026-10-02T00:00:00Z"), page("s-os", "en", "2026-10-10T00:00:00Z"), page("s-os", "es", "2026-10-10T00:00:00Z")],
    portfolio_page_versions: [],
    portfolio_site: [{ user_id: U, name: "Max", nudge_weekly: true }],
    portfolio_inbox: [],
    ...extra,
  }) as unknown as SupabaseClient;
}

// ——— command recognition ———
{
  ok("/portfolio is recognised", ["/portfolio", "/portafolio", "portfolio", "Portafolio", "/portfolio@MyBot", " /portfolio "].every(isPortfolioSummary));
  ok("/inbox is recognised", ["/inbox", "/bandeja", "inbox", "Bandeja", "/inbox@MyBot"].every(isInboxRequest));
  ok("normal sentences are not commands", !isPortfolioSummary("my portfolio is nice") && !isPortfolioSummary("note: portfolio") && !isInboxRequest("inbox zero today") && !isInboxRequest("/inbox 3"));
  ok("help mentions both commands", HELP.includes("/portfolio") && HELP.includes("/inbox"));
}

// ——— /portfolio text ———
{
  const { slots } = await loadSlotViews(db(), U);
  const t = portfolioText(slots, 2);
  ok("portfolio: header counts live pages", /🌐 Portfolio · 3 live/.test(t), t.split("\n")[0]);
  ok("portfolio: a changed page is flagged with its language", /🟠 Project: Personal OS \(EN\) — changed since published/.test(t), t);
  ok("portfolio: the unchanged language is listed separately", /✅ Project: Personal OS \(ES\) — live/.test(t), t);
  ok("portfolio: same status in all languages → one line", /✅ Home \(EN\) — live/.test(t));
  ok("portfolio: draft is shown", /📝 Article: My first post \(EN\) — draft, not published/.test(t));
  ok("portfolio: archived slots are hidden", !t.includes("old"));
  ok("portfolio: unread count and pointer to /inbox", /📬 2 unread messages · \/inbox/.test(t));
  ok("portfolio: no stray double blank lines", !/\n\n\n/.test(t));
  ok("portfolio: empty site", /No pages yet/.test(portfolioText([], 0)));
  const none = portfolioText(slots, 0);
  ok("portfolio: no unread line when zero", !none.includes("unread"));
}

// ——— /inbox text ———
{
  const now = new Date("2026-11-07T12:00:00Z");
  const row = (o: Partial<InboxRow>): InboxRow => ({ id: "m", name: "Ana", email: "ana@example.com", message: "Hello there", lang: "es", spam: false, spam_score: 0, read_at: null, handled_at: null, created_at: "2026-11-07T10:00:00Z", ...o });
  const t = inboxText([row({}), row({ id: "2", name: null, email: null, lang: null, read_at: "2026-11-06T00:00:00Z", created_at: "2026-11-03T12:00:00Z", message: "Second\n\nmessage\twith   spaces" })], 1, now);
  ok("inbox: header", t.startsWith("📬 Inbox · 1 unread"));
  ok("inbox: unread marker, sender, language and age", t.includes("🔵 Ana · ana@example.com · ES · 2 h ago"), t);
  ok("inbox: read message, anonymous sender", t.includes("▫️ Anonymous · 4 d ago"), t);
  ok("inbox: whitespace collapsed to one line", t.includes("“Second message with spaces”"));
  const long = inboxText([row({ message: "x".repeat(500) })], 1, now);
  ok("inbox: long messages are cut", long.includes("…”") && long.length < 600);
  const many = inboxText(Array.from({ length: 8 }, (_, i) => row({ id: String(i) })), 8, now);
  ok("inbox: shows 5 and says how many more", (many.match(/🔵/g) ?? []).length === 5 && many.includes("…and 3 more"));
  ok("inbox: empty", /No messages/.test(inboxText([], 0, now)));
  ok("inbox: control characters never reach Telegram", !/[\u0000-\u0008\u000b\u001f\u2028]/.test(inboxText([row({ message: "a\u0000b\u2028c\u0007d" })], 1, now)));
  ok("ago: units", ago("2026-11-07T11:59:30Z", now) === "just now" && ago("2026-11-07T11:30:00Z", now) === "30 min ago" && ago("2026-11-05T12:00:00Z", now) === "2 d ago");
}

// ——— weekly nudge: text ———
{
  const { slots } = await loadSlotViews(db(), U);
  const t = nudgeText(slots);
  ok("nudge: lists changed pages", !!t && /1 page changed since you published it/.test(t) && t.includes("• Project: Personal OS (EN)"), String(t));
  ok("nudge: drafts alone do not trigger it", nudgeText(slots.filter((s) => s.key === "first-post")) === null);
  ok("nudge: nothing changed → null", nudgeText(slots.filter((s) => s.key === "home")) === null);
  ok("nudge: says how to turn it off", !!t && t.includes("Portfolio → Settings"));
  const trashed = (await loadSlotViews(db({ notes: [note("n1", "s-home", "en", "Home", "2026-10-01T00:00:00Z", { deleted_at: "2026-11-01T00:00:00Z" })] }), U)).slots;
  const tt = nudgeText(trashed);
  ok("nudge: live page whose note is in the trash", !!tt && tt.includes("🗑") && tt.includes("Home (EN)"), String(tt));
}

// ——— weekly nudge: schedule ———
{
  ok("weekday: Monday is 1, Sunday is 7", weekday("2026-11-09") === 1 && weekday("2026-11-08") === 7 && weekday("2026-11-07") === 6);
  ok("weekKey: ISO weeks, year boundary", weekKey("2026-11-09") === "2026-W46" && weekKey("2026-11-15") === "2026-W46" && weekKey("2026-11-16") === "2026-W47" && weekKey("2027-01-01") === "2026-W53" && weekKey("2025-12-29") === "2026-W01", [weekKey("2027-01-01"), weekKey("2025-12-29")].join(" "));

  const sent: string[] = [];
  const claimed = new Set<string>();
  const io = {
    claim: async (u: string, k: string, r: string) => (claimed.has(`${u}|${k}|${r}`) ? false : (claimed.add(`${u}|${k}|${r}`), true)),
    deliver: async (_chat: number, text: string) => void sent.push(text),
  };
  const s = { user_id: U, timezone: "America/Guayaquil", telegram_chat_id: 7 };
  const run = (d: string, minutes: number, sb = db()) => runPortfolioNudge(sb, s, { date: d, minutes }, io);

  ok("nudge: not on Tuesday", (await run("2026-11-10", 10 * 60 + 5)) === 0 && sent.length === 0);
  ok("nudge: not before 10:00", (await run("2026-11-09", 9 * 60 + 59)) === 0);
  ok("nudge: not after the one-hour window", (await run("2026-11-09", 11 * 60)) === 0 && claimed.size === 0);
  ok("nudge: Monday 10:05 sends once", (await run("2026-11-09", 10 * 60 + 5)) === 1 && sent.length === 1);
  ok("nudge: the next cron run in the same week does not repeat it", (await run("2026-11-09", 10 * 60 + 10)) === 0 && sent.length === 1);
  ok("nudge: next Monday it can send again", (await run("2026-11-16", 10 * 60 + 5)) === 1 && sent.length === 2);

  const off = db({ portfolio_site: [{ user_id: U, name: "Max", nudge_weekly: false }] });
  ok("nudge: switched off in Settings → nothing, and nothing claimed", (await run("2026-11-23", 10 * 60 + 5, off)) === 0 && ![...claimed].some((k) => k.endsWith("2026-W48")));
  const calm = db({ notes: [note("n1", "s-home", "en", "Home", "2026-10-01T00:00:00Z")], portfolio_pages: [page("s-home", "en", "2026-10-02T00:00:00Z")] });
  ok("nudge: nothing to say → no message", (await run("2026-11-30", 10 * 60 + 5, calm)) === 0 && sent.length === 2);
  const noSite = db({ portfolio_site: [] });
  ok("nudge: no saved settings counts as ON (default)", (await run("2026-12-07", 10 * 60 + 5, noSite)) === 1);
}

console.log(`\nportfolio-bot: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
