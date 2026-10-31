// Checks ✨ AI covers: what is asked of the AI, how its plan is read, the house style, which covers the bulk button may replace,
// and how the Cloudflare answers (fake network, nothing is sent). Run: npm run test:cover-art
import { COVER_STYLE, COVER_SYSTEM, buildImagePrompt, coverInput, isReplaceableCover, parseCoverPlan } from "@/lib/cover-art";
import { generateImage, hasImageAi, imageErrorFrom } from "@/lib/cloudflare-image";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ---- what goes to the AI
ok("empty note, no title, no idea → nothing", coverInput("", "   ", "") === null);
ok("a title alone is enough", (coverInput("Viaje a Cuenca", "") ?? "").includes("Viaje a Cuenca"));
ok("an idea alone is enough", (coverInput("", "", "un faro") ?? "").includes("DIRECTION FROM THE USER: un faro"));
ok("long notes are cut", (coverInput("T", "x".repeat(20000)) ?? "").length < 7000);
ok("idea is cut", (coverInput("T", "texto de la nota", "y".repeat(900)) ?? "").length < 800);
ok("system asks for English JSON in order", COVER_SYSTEM.indexOf('"about"') < COVER_SYSTEM.indexOf('"idea"') && COVER_SYSTEM.indexOf('"metaphor"') < COVER_SYSTEM.indexOf('"scene"') && /English/.test(COVER_SYSTEM));

// ---- reading the plan
const good = '```json\n{"about":"Plan de gym","idea":"discipline","metaphor":"a dumbbell","scene":"A single dumbbell resting on a stack of three smooth stones."}\n```';
const p = parseCoverPlan(good);
ok("plan parsed from a fenced answer", !!p && p.scene.startsWith("A single dumbbell") && p.about === "Plan de gym");
ok("plan parsed with <think> before it", !!parseCoverPlan('<think>hmm {not json}</think>{"scene":"A lighthouse on a small round island"}'));
ok("falls back to the metaphor", parseCoverPlan('{"metaphor":"a lighthouse on a hill","scene":""}')?.scene === "a lighthouse on a hill");
ok("garbage → null", parseCoverPlan("lo siento") === null && parseCoverPlan("{broken") === null && parseCoverPlan('{"scene":"x"}') === null);
ok("scene is capped", (parseCoverPlan(`{"scene":"${"a ".repeat(500)}"}`)?.scene.length ?? 999) <= 420);
ok("'a sign that says …' is removed", !/says/i.test(parseCoverPlan('{"scene":"A wooden desk with a sign that says HELLO WORLD, a lamp"}')?.scene ?? "says"));

// ---- the house style
const img = buildImagePrompt("A lighthouse on a small island.");
ok("prompt = scene + the one style", img.startsWith("A lighthouse on a small island. ") && img.endsWith(COVER_STYLE));
ok("style forbids text and faces", /No text/.test(COVER_STYLE) && /no human faces/.test(COVER_STYLE));
ok("prompt fits the image model", img.length < 2000);

// ---- which covers the bulk button may replace
ok("no cover → replaceable", isReplaceableCover(null) && isReplaceableCover(undefined) && isReplaceableCover(""));
ok("gradient / color → replaceable", isReplaceableCover("gradient:3") && isReplaceableCover("color:navy"));
ok("earlier AI cover → replaceable", isReplaceableCover("/api/files/u1/covers/ai-1234abcd-xyz.jpg"));
ok("own upload / link → kept", !isReplaceableCover("/api/files/u1/2026-10/ab12-foto.png") && !isReplaceableCover("https://example.com/a.jpg"));

// ---- Cloudflare errors
ok("quota by status", imageErrorFrom(429, null).quota === true);
ok("quota by code 4006", imageErrorFrom(400, { errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] }).quota === true);
ok("bad token", /token/i.test(imageErrorFrom(403, { errors: [{ code: 10000, message: "Authentication error" }] }).error));
ok("other error shows the message", /boom/.test(imageErrorFrom(500, { errors: [{ message: "boom" }] }).error));

// ---- generateImage with a fake network
const realFetch = globalThis.fetch;
const realEnv = { a: process.env.CF_ACCOUNT_ID, t: process.env.CF_API_TOKEN };
delete process.env.CF_ACCOUNT_ID;
delete process.env.CF_API_TOKEN;
ok("not connected without keys", !hasImageAi() && "error" in (await generateImage("x")));
process.env.CF_ACCOUNT_ID = "acc1";
process.env.CF_API_TOKEN = "tok1";
ok("connected with keys", hasImageAi());
const calls: { url: string; auth: string | null; body: { prompt: string; steps: number } }[] = [];
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(900, 7)]);
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
  return new Response(JSON.stringify({ result: { image: jpeg.toString("base64") }, success: true }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const r1 = await generateImage("a lighthouse");
ok("returns the bytes", "bytes" in r1 && r1.bytes.length === jpeg.length && r1.mime === "image/jpeg");
const seen = calls[0];
ok("calls FLUX schnell with the token", !!seen && seen.url.includes("/accounts/acc1/ai/run/@cf/black-forest-labs/flux-1-schnell") && seen.auth === "Bearer tok1" && seen.body.prompt === "a lighthouse" && seen.body.steps === 4);
globalThis.fetch = (async () => new Response(JSON.stringify({ success: false, errors: [{ code: 4006, message: "daily free allocation used (neurons)" }] }), { status: 429, headers: { "content-type": "application/json" } })) as typeof fetch;
const r2 = await generateImage("x");
ok("quota is reported", "error" in r2 && r2.quota === true);
globalThis.fetch = (async () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch;
ok("raw image answer works", "bytes" in (await generateImage("x")));
globalThis.fetch = (async () => {
  throw new Error("network down");
}) as typeof fetch;
ok("network error → message", "error" in (await generateImage("x")));
globalThis.fetch = realFetch;
if (realEnv.a === undefined) delete process.env.CF_ACCOUNT_ID;
else process.env.CF_ACCOUNT_ID = realEnv.a;
if (realEnv.t === undefined) delete process.env.CF_API_TOKEN;
else process.env.CF_API_TOKEN = realEnv.t;

console.log(`${fail ? "✗" : "✓"} cover-art: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
