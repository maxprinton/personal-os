// Portfolio add-on, Phase 6: contact form checks, spam score, signed endpoint logic, rate limits, inbox, Telegram text.
// Fake database, nothing is sent. Run: npm run test:portfolio-contact
import { readFileSync } from "node:fs";
import { fakeDb, type Row } from "./fake-supabase";
import { handleContact, LIMITS, spamScore, SPAM_THRESHOLD, telegramText, type ContactDeps } from "@/lib/portfolio/contact";
import { validateContact, CONTACT_LIMITS } from "@/lib/portfolio/contact-validate";
import { SIGNATURE_HEADER, signBody } from "@/lib/portfolio/sign";
import { deleteMessage, emptySpam, listInbox, markAllRead, replyHref, setHandled, setRead, setSpam, unreadCount } from "@/lib/portfolio/inbox";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ——— validation ———
{
  const good = { name: "Ana", email: "ana@example.com", message: "Hello, I would like to talk about a project.", lang: "es" };
  const v = validateContact(good);
  ok("validate: good input", v.ok && v.value.lang === "es" && v.value.name === "Ana");
  ok("validate: not an object → everything required", !validateContact(null).ok && !validateContact("x").ok && !validateContact(5).ok);
  const bad = (o: object) => validateContact({ ...good, ...o });
  const err = (o: object) => { const r = bad(o); return r.ok ? null : r.errors; };
  ok("validate: email required / invalid", err({ email: "" })?.email === "required" && ["no-at", "a@b", "a b@c.com", "a@b.c", "@x.com", "a@@x.com", "a..b@x.com", ".a@x.com", "a.@x.com", "a@x.com\nBcc: evil@x.com", "a@x.com,b@x.com", "<a@x.com>", "a@x..com", '"a"@x.com'].every((e) => err({ email: e })?.email === "invalid"), JSON.stringify(["a@b", "a@@x.com"].map((e) => err({ email: e }))));
  ok("validate: normal emails accepted", ["a@b.co", "first.last+tag@sub.example.com", "ñandú@example.mx"].every((e) => bad({ email: e }).ok));
  ok("validate: email too long", err({ email: "a".repeat(250) + "@x.com" })?.email === "invalid");
  ok("validate: message required / short / long", err({ message: "" })?.message === "required" && err({ message: "   \n " })?.message === "required" && err({ message: "hi" })?.message === "short" && err({ message: "x".repeat(CONTACT_LIMITS.message + 1) })?.message === "long" && bad({ message: "x".repeat(CONTACT_LIMITS.message) }).ok);
  ok("validate: name optional, capped", bad({ name: "" }).ok && err({ name: "n".repeat(81) })?.name === "long");
  const clean = validateContact({ ...good, name: "A\u0000n‪\n a ", message: "line1\r\nline2\u0007\n\n\n\n\n\nend    \nx".padEnd(30, "!") });
  ok("validate: control characters and newlines cleaned", clean.ok && clean.value.name === "An a".replace("A", "A") || (clean.ok && !/[\u0000\u0007\n]/.test(clean.value.name) && !clean.value.message.includes("\r") && !clean.value.message.includes("\u0007") && !/\n{4}/.test(clean.value.message)), clean.ok ? JSON.stringify(clean.value) : "");
  ok("validate: unknown language → en", validateContact({ ...good, lang: "fr" }).ok && (validateContact({ ...good, lang: "fr" }) as { value: { lang: string } }).value.lang === "en");
  ok("validate: non-string fields are ignored, not crashed", !validateContact({ name: 5, email: ["a@b.com"], message: {} }).ok);
  ok("validate: the site copy is identical", read("portfolio/src/lib/contact-validate.ts") === read("src/lib/portfolio/contact-validate.ts"));
}

// ——— spam score ———
{
  const m = (message: string, name = "Ana") => ({ name, email: "a@b.co", message, lang: "en" as const });
  const plain = spamScore(m("Hi Max, I watched your video about the OS and would love to ask a couple of questions."));
  ok("spam: normal message scores 0", plain.score === 0 && plain.reasons.length === 0);
  ok("spam: one link is fine, three are not", spamScore(m("Look at https://my.site/portfolio for context please")).score < SPAM_THRESHOLD && spamScore(m("see http://a.co http://b.co https://c.co ok")).score >= SPAM_THRESHOLD);
  ok("spam: sales words", spamScore(m("Best casino and viagra offers, click here now")).score >= SPAM_THRESHOLD);
  ok("spam: link markup", spamScore(m('<a href="http://x.co">x</a> hello there my friend')).score >= SPAM_THRESHOLD);
  ok("spam: shouting + repeated characters", spamScore(m("HELLO THIS IS A VERY IMPORTANT MESSAGE FOR YOU!!!!!!!!!!")).score >= 3);
  ok("spam: sent too fast and duplicates", spamScore(m("A fine message here ok"), { fast: true }).score === 2 && spamScore(m("A fine message here ok"), { duplicate: true }).score >= SPAM_THRESHOLD);
  ok("spam: link in the name", spamScore(m("A fine message here ok", "visit www.spam.co")).score >= 2);
  ok("spam: spanish messages are not penalised", spamScore({ name: "Ñandú", email: "n@x.mx", message: "Hola Max, me encantó tu proyecto del sistema personal. ¿Podemos hablar?", lang: "es" }).score === 0);
}

// ——— the endpoint logic ———
const SECRET = "s3cret-for-tests";
const T0 = new Date("2026-11-07T12:00:00Z");
const IP1 = "a".repeat(32);
const IP2 = "b".repeat(32);
function setup(over: { secret?: string | undefined; owner?: boolean } = {}) {
  const tables: Record<string, Row[]> = { portfolio_site: over.owner === false ? [] : [{ user_id: "u1" }], portfolio_inbox: [], portfolio_contact_hits: [] };
  let clock = T0.getTime();
  const pings: string[] = [];
  const d: ContactDeps = { db: fakeDb(tables), secret: "secret" in over ? over.secret : SECRET, now: () => new Date(clock), notify: async (_u, t) => void pings.push(t) };
  const send = (payload: object | string, opts: { secret?: string; at?: number; header?: string | null } = {}) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const sig = opts.header !== undefined ? opts.header : signBody(opts.secret ?? SECRET, body, opts.at ?? clock);
    const headers = new Headers(sig ? { [SIGNATURE_HEADER]: sig } : {});
    return handleContact(d, body, headers);
  };
  return { tables, d, send, pings, tick: (ms: number) => (clock += ms) };
}
const msg = (over: object = {}) => ({ name: "Ana", email: "ana@example.com", message: "Hi Max, I would like to ask about your portfolio system.", lang: "en", ip_hash: IP1, ...over });

{
  const e = setup();
  const r = await e.send(msg());
  ok("endpoint: good message → 200 and saved", r.status === 200 && r.body.ok === true && e.tables.portfolio_inbox.length === 1);
  const row = e.tables.portfolio_inbox[0];
  ok("endpoint: row has the cleaned data for the right owner", row.user_id === "u1" && row.name === "Ana" && row.email === "ana@example.com" && row.lang === "en" && row.spam === false && row.spam_score === 0 && row.read_at === undefined);
  ok("endpoint: only a hash of the visitor is stored", row.ip_hash === IP1 && !JSON.stringify(row).match(/\d+\.\d+\.\d+\.\d+/));
  ok("endpoint: the owner is told once, with sender and text", e.pings.length === 1 && e.pings[0].includes("ana@example.com") && e.pings[0].includes("portfolio system"));
  ok("endpoint: a hit was recorded", e.tables.portfolio_contact_hits.length === 1);
}
{
  const e = setup({ secret: undefined });
  ok("endpoint: no secret configured → 503, nothing saved", (await e.send(msg())).status === 503 && e.tables.portfolio_inbox.length === 0);
}
{
  const e = setup();
  ok("endpoint: no signature → 401", (await e.send(msg(), { header: null })).status === 401);
  ok("endpoint: wrong secret → 401", (await e.send(msg(), { secret: "other" })).status === 401);
  ok("endpoint: old signature (replay after 10 minutes) → 401", (await e.send(msg(), { at: T0.getTime() - 600_000 })).status === 401);
  ok("endpoint: body changed after signing → 401", (await handleContact(e.d, JSON.stringify(msg({ email: "evil@x.com" })), new Headers({ [SIGNATURE_HEADER]: signBody(SECRET, JSON.stringify(msg()), T0.getTime()) }))).status === 401);
  ok("endpoint: unsigned requests leave no trace", e.tables.portfolio_inbox.length === 0 && e.tables.portfolio_contact_hits.length === 0 && e.pings.length === 0);
  const big = JSON.stringify(msg({ message: "x".repeat(LIMITS.bodyBytes) }));
  ok("endpoint: huge body → 413", (await e.send(big)).status === 413);
  ok("endpoint: not JSON → 400", (await e.send("not json")).status === 400);
  ok("endpoint: invalid fields → 400", (await e.send(msg({ email: "nope" }))).status === 400 && (await e.send(msg({ message: "hi" }))).status === 400);
  ok("endpoint: bad visitor hash → 400", (await e.send(msg({ ip_hash: "1.2.3.4" }))).status === 400 && (await e.send(msg({ ip_hash: undefined }))).status === 400);
  ok("endpoint: bad requests are not saved", e.tables.portfolio_inbox.length === 0);
}
{
  const e = setup({ owner: false });
  ok("endpoint: site not set up → 503", (await e.send(msg())).status === 503);
}
{
  const e = setup();
  for (let i = 0; i < LIMITS.perIpPerHour; i++) ok(`rate: message ${i + 1} from one visitor is accepted`, (await e.send(msg({ message: `Distinct message number ${i} about the portfolio` }))).status === 200);
  const blocked = await e.send(msg({ message: "Yet another distinct message about the portfolio" }));
  ok("rate: the next one within the hour → 429, not saved, no ping", blocked.status === 429 && e.tables.portfolio_inbox.length === LIMITS.perIpPerHour && e.pings.length === LIMITS.perIpPerHour);
  ok("rate: another visitor is not affected", (await e.send(msg({ ip_hash: IP2, message: "A message from somebody else entirely" }))).status === 200);
  e.tick(3_600_000 + 1000);
  ok("rate: after an hour the first visitor can write again", (await e.send(msg({ message: "Back again after an hour has passed" }))).status === 200);
}
{
  const e = setup();
  for (let i = 0; i < LIMITS.perDay; i++) e.tables.portfolio_contact_hits.push({ ip_hash: String(i).padStart(32, "0"), created_at: new Date(T0.getTime() - 1000).toISOString() });
  ok("rate: daily cap for the whole site → 429", (await e.send(msg())).status === 429 && e.tables.portfolio_inbox.length === 0);
}
{
  const e = setup();
  e.tables.portfolio_contact_hits.push({ ip_hash: IP2, created_at: new Date(T0.getTime() - 3 * 86_400_000).toISOString() });
  await e.send(msg());
  ok("housekeeping: counters older than two days are deleted", e.tables.portfolio_contact_hits.length === 1 && e.tables.portfolio_contact_hits[0].ip_hash === IP1);
}
{
  const e = setup();
  const s = await e.send(msg({ message: "Best casino and viagra offers, click here now http://a.co http://b.co" }));
  ok("spam: accepted quietly (200) so bots learn nothing", s.status === 200 && s.body.ok === true);
  ok("spam: saved as spam, no ping", e.tables.portfolio_inbox.length === 1 && e.tables.portfolio_inbox[0].spam === true && (e.tables.portfolio_inbox[0].spam_score as number) >= SPAM_THRESHOLD && e.pings.length === 0);
}
{
  const e = setup();
  await e.send(msg({ ip_hash: IP1 }));
  e.tick(1000);
  await e.send(msg({ ip_hash: IP2 }));
  ok("duplicate: the same text again within a day is treated as spam", e.tables.portfolio_inbox.length === 2 && e.tables.portfolio_inbox[1].spam === true && e.pings.length === 1);
}
{
  const e = setup();
  ok("fast: a form sent in under two seconds is flagged", (await e.send(msg({ fast: true }))).status === 200 && e.tables.portfolio_inbox[0].spam_score === 2 && e.tables.portfolio_inbox[0].spam === false);
}
{
  const e = setup();
  e.d.notify = async () => {
    throw new Error("telegram down");
  };
  ok("telegram failing never fails the request", (await e.send(msg())).status === 200 && e.tables.portfolio_inbox.length === 1);
}
{
  const t = telegramText({ name: "", email: "a@b.co", message: "x".repeat(1000) });
  ok("telegram text: short, says who, no name placeholder", t.length < 600 && t.includes("(no name)") && t.includes("a@b.co") && t.includes("…"));
}

// ——— the owner's inbox ———
{
  const now = new Date("2026-11-08T09:00:00Z");
  const tables: Record<string, Row[]> = {
    portfolio_inbox: [
      { id: "m1", user_id: "u1", name: "Ana", email: "ana@example.com", message: "one", lang: "es", spam: false, spam_score: 0, read_at: null, handled_at: null, created_at: "2026-11-07T10:00:00Z" },
      { id: "m2", user_id: "u1", name: "Bo", email: "bo@example.com", message: "two", lang: "en", spam: false, spam_score: 0, read_at: null, handled_at: null, created_at: "2026-11-07T11:00:00Z" },
      { id: "m3", user_id: "u1", name: "Bot", email: "bot@spam.com", message: "buy", lang: "en", spam: true, spam_score: 5, read_at: null, handled_at: null, created_at: "2026-11-07T12:00:00Z" },
      { id: "m4", user_id: "other", name: "Eve", email: "eve@x.com", message: "not yours", lang: "en", spam: false, spam_score: 0, read_at: null, handled_at: null, created_at: "2026-11-07T13:00:00Z" },
    ],
  };
  const sb = fakeDb(tables);
  ok("inbox: newest first, only mine, spam apart", (await listInbox(sb, "u1", false)).map((m) => m.id).join() === "m2,m1" && (await listInbox(sb, "u1", true)).map((m) => m.id).join() === "m3");
  ok("inbox: unread count ignores spam and other people's mail", (await unreadCount(sb, "u1")) === 2);
  await setRead(sb, "u1", "m1", true, now);
  ok("inbox: mark read", (await unreadCount(sb, "u1")) === 1 && tables.portfolio_inbox[0].read_at === now.toISOString());
  await setRead(sb, "u1", "m1", false);
  ok("inbox: mark unread", (await unreadCount(sb, "u1")) === 2);
  await setHandled(sb, "u1", "m2", true, now);
  ok("inbox: handled also reads", tables.portfolio_inbox[1].handled_at === now.toISOString() && tables.portfolio_inbox[1].read_at === now.toISOString() && (await unreadCount(sb, "u1")) === 1);
  await setHandled(sb, "u1", "m2", false);
  ok("inbox: reopen keeps it read", tables.portfolio_inbox[1].handled_at === null && tables.portfolio_inbox[1].read_at !== null);
  await setSpam(sb, "u1", "m1", true, now);
  ok("inbox: mark as spam moves it to the spam tab, read", (await listInbox(sb, "u1", true)).map((m) => m.id).sort().join() === "m1,m3" && (await unreadCount(sb, "u1")) === 0);
  await setSpam(sb, "u1", "m3", false);
  ok("inbox: not spam brings it back unread", (await listInbox(sb, "u1", false)).some((m) => m.id === "m3") && (await unreadCount(sb, "u1")) === 1);
  await setRead(sb, "u1", "m4", true);
  ok("inbox: cannot touch another user's message", tables.portfolio_inbox[3].read_at === null);
  await deleteMessage(sb, "u1", "m4");
  ok("inbox: cannot delete another user's message", tables.portfolio_inbox.some((m) => m.id === "m4"));
  await markAllRead(sb, "u1", now);
  ok("inbox: mark all read", (await unreadCount(sb, "u1")) === 0 && tables.portfolio_inbox[3].read_at === null);
  await emptySpam(sb, "u1");
  ok("inbox: empty spam deletes only my spam", !tables.portfolio_inbox.some((m) => m.id === "m1") && tables.portfolio_inbox.some((m) => m.id === "m4") && tables.portfolio_inbox.length === 3);
  await deleteMessage(sb, "u1", "m2");
  ok("inbox: delete", !tables.portfolio_inbox.some((m) => m.id === "m2"));
  const href = replyHref({ email: "ana@example.com", message: "Hola\nque tal", lang: "es", created_at: "2026-11-07T10:00:00Z" })!;
  ok("reply: mailto with subject and quoted message, in the sender's language", href.startsWith("mailto:ana@example.com?subject=") && decodeURIComponent(href).includes("Re: tu mensaje") && decodeURIComponent(href).includes("> Hola\n> que tal") && decodeURIComponent(href).includes("El 2026-11-07"));
  ok("reply: no link for a bad address", replyHref({ email: "a@b.com\nBcc: x@y.com", message: "m", lang: "en", created_at: "2026-11-07T10:00:00Z" }) === null && replyHref({ email: null, message: "m", lang: "en", created_at: "2026-11-07T10:00:00Z" }) === null);
}

console.log(`${fail ? "❌" : "✅"} portfolio contact: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
