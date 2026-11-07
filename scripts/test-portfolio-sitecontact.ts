// Public site, Phase 6: the site's side of the contact form (honeypot, origin, Turnstile, signed forward, error mapping).
// Fake network. Run: npm run test:portfolio-sitecontact
import { handleSiteContact, MAX_BODY, MIN_FILL_MS, type ContactEnv } from "../portfolio/src/lib/contact";
import { verifyTurnstile } from "../portfolio/src/lib/turnstile";
import { handleContact } from "@/lib/portfolio/contact";
import { SIGNATURE_HEADER } from "@/lib/portfolio/sign";
import { fakeDb, type Row } from "./fake-supabase";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

const env: ContactEnv = { TURNSTILE_SECRET_KEY: "ts-secret", PORTFOLIO_REVALIDATE_SECRET: "shared", PORTFOLIO_OS_URL: "https://os.test/" };
const good = { name: "Ana", email: "ana@example.com", message: "Hello Max, I have a question about your project.", lang: "es", token: "tok", elapsed: 15000, website: "" };
const req = (over: object = {}, r: Partial<{ ip: string | null; origin: string | null; host: string | null; raw: string }> = {}) => ({
  body: r.raw ?? JSON.stringify({ ...good, ...over }),
  ip: r.ip === undefined ? "203.0.113.7" : r.ip,
  origin: r.origin === undefined ? "https://site.test" : r.origin,
  host: r.host === undefined ? "site.test" : r.host,
});

function net(opts: { turnstile?: boolean; os?: number; osThrows?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string>, body });
    if (u.includes("turnstile")) return new Response(JSON.stringify({ success: opts.turnstile !== false }), { status: 200 });
    if (opts.osThrows) throw new Error("down");
    return new Response("{}", { status: opts.os ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

{
  const n = net();
  const r = await handleSiteContact(req(), env, n.f);
  ok("site: good message → 200", r.status === 200 && r.body.ok === true);
  ok("site: Turnstile asked first, with the secret, token and visitor address", n.calls[0].url.includes("challenges.cloudflare.com/turnstile/v0/siteverify") && n.calls[0].body.includes("secret=ts-secret") && n.calls[0].body.includes("response=tok") && n.calls[0].body.includes("remoteip=203.0.113.7"));
  ok("site: forwarded to the OS endpoint (no double slash), signed", n.calls[1].url === "https://os.test/api/portfolio/contact" && /^t=\d+,v1=[0-9a-f]{64}$/.test(n.calls[1].headers[SIGNATURE_HEADER]));
  const sent = JSON.parse(n.calls[1].body);
  ok("site: the OS gets a hash, never the address, and none of the site-only fields", /^[0-9a-f]{32}$/.test(sent.ip_hash) && !n.calls[1].body.includes("203.0.113.7") && !("token" in sent) && !("website" in sent) && !("elapsed" in sent) && sent.fast === false);
  const again = net();
  await handleSiteContact(req(), env, again.f);
  ok("site: same visitor → same hash; other visitor → other hash", JSON.parse(again.calls[1].body).ip_hash === sent.ip_hash && JSON.parse((await (async () => { const m = net(); await handleSiteContact(req({}, { ip: "198.51.100.2" }), env, m.f); return m.calls[1]; })()).body).ip_hash !== sent.ip_hash);
}
{
  const n = net();
  ok("site: missing settings → 503, nothing called", (await handleSiteContact(req(), { ...env, TURNSTILE_SECRET_KEY: "" }, n.f)).status === 503 && (await handleSiteContact(req(), { ...env, PORTFOLIO_OS_URL: undefined }, n.f)).status === 503 && (await handleSiteContact(req(), {}, n.f)).status === 503 && n.calls.length === 0);
  ok("site: another website cannot post here", (await handleSiteContact(req({}, { origin: "https://evil.test" }), env, n.f)).status === 403 && (await handleSiteContact(req({}, { origin: "not a url" }), env, n.f)).status === 403);
  ok("site: no origin header (an API client) is still checked by Turnstile", (await handleSiteContact(req({}, { origin: null }), env, net({ turnstile: false }).f)).status === 400);
  ok("site: huge body → 413, bad JSON / arrays → 400", (await handleSiteContact(req({}, { raw: "x".repeat(MAX_BODY + 1) }), env, n.f)).status === 413 && (await handleSiteContact(req({}, { raw: "nope" }), env, n.f)).status === 400 && (await handleSiteContact(req({}, { raw: "[1]" }), env, n.f)).status === 400 && (await handleSiteContact(req({}, { raw: "null" }), env, n.f)).status === 400);
  ok("site: nothing was sent anywhere for those", n.calls.length === 0);
}
{
  const n = net();
  const r = await handleSiteContact(req({ website: "http://spam.example" }), env, n.f);
  ok("site: honeypot filled → looks like success, nothing sent", r.status === 200 && r.body.ok === true && n.calls.length === 0);
}
{
  const n = net();
  const r = await handleSiteContact(req({ email: "nope", message: "hi" }), env, n.f);
  ok("site: invalid fields → 400 with the fields, before Turnstile is spent", r.status === 400 && r.body.error === "invalid" && r.body.fields?.email === "invalid" && r.body.fields?.message === "short" && n.calls.length === 0);
}
{
  const n = net({ turnstile: false });
  const r = await handleSiteContact(req(), env, n.f);
  ok("site: failed Turnstile → 400 verify, nothing forwarded", r.status === 400 && r.body.error === "verify" && n.calls.length === 1);
  ok("site: missing / huge token → verify", (await handleSiteContact(req({ token: "" }), env, net().f)).body.error === "verify" && (await handleSiteContact(req({ token: "x".repeat(3000) }), env, net().f)).body.error === "verify");
}
{
  ok("site: filled in under two seconds → flagged fast", JSON.parse((await (async () => { const n = net(); await handleSiteContact(req({ elapsed: MIN_FILL_MS - 1 }), env, n.f); return n.calls[1]; })()).body).fast === true);
  ok("site: missing elapsed is not flagged", JSON.parse((await (async () => { const n = net(); await handleSiteContact(req({ elapsed: undefined }), env, n.f); return n.calls[1]; })()).body).fast === false);
}
{
  ok("site: OS says 429 → too_many", (await handleSiteContact(req(), env, net({ os: 429 }).f)).body.error === "too_many");
  const bad = await handleSiteContact(req(), env, net({ os: 500 }).f);
  ok("site: OS error / unreachable → 502 failed, no details leaked", bad.status === 502 && bad.body.error === "failed" && (await handleSiteContact(req(), env, net({ osThrows: true }).f)).status === 502);
  ok("turnstile: network failure → false, no throw", (await verifyTurnstile("s", "t", null, (async () => { throw new Error("x"); }) as typeof fetch)) === false);
}

// ——— the two sides together: what the site signs, the OS accepts ———
{
  const tables: Record<string, Row[]> = { portfolio_site: [{ user_id: "u1" }], portfolio_inbox: [], portfolio_contact_hits: [] };
  const forward = net();
  await handleSiteContact(req(), env, forward.f);
  const os = forward.calls[1];
  const pings: string[] = [];
  const r = await handleContact({ db: fakeDb(tables), secret: "shared", notify: async (_u, t) => void pings.push(t) }, os.body, new Headers({ [SIGNATURE_HEADER]: os.headers[SIGNATURE_HEADER] }));
  ok("end to end: the OS accepts what the site forwards", r.status === 200 && tables.portfolio_inbox.length === 1 && tables.portfolio_inbox[0].email === "ana@example.com" && tables.portfolio_inbox[0].lang === "es" && pings.length === 1);
  const wrong = await handleContact({ db: fakeDb(tables), secret: "different", notify: async () => {} }, os.body, new Headers({ [SIGNATURE_HEADER]: os.headers[SIGNATURE_HEADER] }));
  ok("end to end: with a different secret the OS refuses", wrong.status === 401 && tables.portfolio_inbox.length === 1);
}

console.log(`${fail ? "❌" : "✅"} portfolio site contact: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
