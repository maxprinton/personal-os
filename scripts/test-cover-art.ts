// Checks ✨ AI covers: what is asked of the AI, how its plan is read, the house style, which covers the bulk button may replace,
// and how the Cloudflare answers (fake network, nothing is sent). Run: npm run test:cover-art
import { COVER_STYLE, COVER_SYSTEM, buildImagePrompt, coverBg, coverInput, isAiCover, isReplaceableCover, needsFit, parseCoverPlan, promptRecord, withCoverBg } from "@/lib/cover-art";
import { FIT_MIN, FIT_PAD, cropRaw, featherAlpha, findSubject, frameFor, hexOf, ringColor, type Rgb } from "@/lib/cover-fit";
import { coverStyle } from "@/lib/covers";
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
ok("style asks for ONE flat background and margins (needed to fit the picture)", /plain solid flat/.test(COVER_STYLE) && /no gradient/.test(COVER_STYLE) && /nothing touches/.test(COVER_STYLE));
ok("prompt fits the image model", img.length < 2000);

// ---- which covers the bulk button may replace
const ai = "/api/files/u1/covers/ai-1234abcd-xyz.webp";
ok("no cover → replaceable", isReplaceableCover(null) && isReplaceableCover(undefined) && isReplaceableCover(""));
ok("gradient / color → replaceable", isReplaceableCover("gradient:3") && isReplaceableCover("color:navy"));
ok("AI covers are not replaced in bulk", !isReplaceableCover(ai) && !isReplaceableCover(`${ai}#bg=f3ebdd`));
ok("own upload / link → kept", !isReplaceableCover("/api/files/u1/2026-10/ab12-foto.png") && !isReplaceableCover("https://example.com/a.jpg"));
ok("old AI cover (no color) needs fitting", needsFit(ai) && needsFit("/api/files/u1/covers/ai-1234abcd-xyz.jpg"));
ok("fitted AI cover / own picture don't", !needsFit(`${ai}#bg=f3ebdd`) && !needsFit("/api/files/u1/2026-10/ab12-foto.png") && !needsFit(null));
ok("isAiCover", isAiCover(ai) && !isAiCover("gradient:1") && !isAiCover(null));
ok("background color in the link", coverBg(`${ai}#bg=F3EBDD`) === "f3ebdd" && coverBg(ai) === null && withCoverBg(`${ai}#bg=000000`, "abcdef") === `${ai}#bg=abcdef`);

// ---- how a cover is shown
const st = coverStyle(`${ai}#bg=f3ebdd`, 20);
ok("AI cover: whole picture, centered, over its color", st.backgroundSize === "contain" && st.backgroundPosition === "center" && st.backgroundColor === "#f3ebdd" && String(st.backgroundImage).includes("ai-1234abcd-xyz.webp") && !String(st.backgroundImage).includes("#bg"));
const own = coverStyle("/api/files/u1/x.png", 20);
ok("own picture: still cover + position", own.backgroundPosition === "center 20%" && own.backgroundSize === undefined);
ok("gradients unchanged", String(coverStyle("gradient:1").background ?? "").includes("linear-gradient"));

// ---- the last prompt is kept (whoever wrote it)
const rec = promptRecord("A lighthouse on a small island", "  un faro   azul ", "2026-10-30T12:00:00.000Z");
ok("record keeps scene, idea and the full prompt", rec.scene === "A lighthouse on a small island" && rec.idea === "un faro azul" && rec.prompt.startsWith("A lighthouse on a small island. ") && rec.prompt.endsWith(COVER_STYLE) && rec.at === "2026-10-30T12:00:00.000Z");
ok("record without an idea", promptRecord("A kite", undefined).idea === "");

// ---- fitting the picture (pure math; sharp itself is checked in the cloud run)
const mk = (w: number, h: number, bg: Rgb, boxes: { x0: number; y0: number; x1: number; y1: number; c: Rgb }[] = [], noise = 0) => {
  const px = new Uint8Array(w * h * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2 * noise;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = bg;
      for (const b of boxes) if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) c = b.c;
      const i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, Math.round(c[k] + rnd())));
    }
  return px;
};
const cream: Rgb = [243, 235, 221];
const coral: Rgb = [224, 122, 95];
const G = 256;
const grain = mk(G, G, cream, [{ x0: 130, y0: 100, x1: 210, y1: 140, c: coral }], 5);
const bgc = ringColor(grain, G, G);
ok("background color found (with grain)", Math.abs(bgc[0] - 243) <= 3 && Math.abs(bgc[1] - 235) <= 3 && Math.abs(bgc[2] - 221) <= 3);
ok("hex of a color", hexOf([243, 235, 221]) === "f3ebdd");
const box = findSubject(grain, G, G, bgc);
ok("subject found despite grain", !!box && box.x0 === 130 && box.x1 === 210 && box.y0 === 100 && box.y1 === 140, JSON.stringify(box));
const fr = frameFor(box!, G, G, 1024, 1024);
ok("frame is centered on the subject", Math.abs(fr.left + fr.width / 2 - 680) <= 2 && Math.abs(fr.top + fr.height / 2 - 480) <= 2, JSON.stringify(fr));
ok("frame never smaller than the minimum cut", fr.height >= 1024 * FIT_MIN - 1 && fr.width >= fr.height);
const big = mk(G, G, cream, [{ x0: 40, y0: 60, x1: 216, y1: 196, c: coral }]);
const fr2 = frameFor(findSubject(big, G, G, cream)!, G, G, 1024, 1024);
ok("a big subject gets the margin around it", Math.abs(fr2.height - 4 * 136 * (1 + 2 * FIT_PAD)) <= 2, JSON.stringify(fr2));
ok("subject is at least 70% of the frame height when it is large", 4 * 136 / fr2.height >= 0.7);
ok("two separate elements → one box around both", (() => {
  const two = mk(G, G, cream, [{ x0: 40, y0: 100, x1: 80, y1: 140, c: coral }, { x0: 180, y0: 110, x1: 220, y1: 150, c: [31, 92, 99] }]);
  const b = findSubject(two, G, G, cream);
  return !!b && b.x0 === 40 && b.x1 === 220 && b.y0 === 100 && b.y1 === 150;
})());
ok("empty picture → no subject", findSubject(mk(G, G, cream), G, G, cream) === null);
ok("a single speck is ignored", findSubject(mk(G, G, cream, [{ x0: 10, y0: 10, x1: 11, y1: 11, c: coral }]), G, G, cream) === null);
ok("full-bleed picture → no cut", findSubject(mk(G, G, cream, [{ x0: 1, y0: 1, x1: 255, y1: 255, c: coral }]), G, G, cream) === null);
ok("noisy background → no cut", findSubject(mk(G, G, cream, [], 80), G, G, [243, 235, 221]) === null);
// cutting a frame that goes outside the picture fills with the background
const small = mk(4, 4, [10, 20, 30]);
const cut = cropRaw(small, 4, 4, { left: -2, top: -1, width: 8, height: 6 }, [200, 100, 50]);
const at = (x: number, y: number) => [...cut.subarray((y * 8 + x) * 3, (y * 8 + x) * 3 + 3)];
ok("crop: outside is background, inside is the picture", cut.length === 8 * 6 * 3 && at(0, 0).join() === "200,100,50" && at(2, 1).join() === "10,20,30" && at(5, 4).join() === "10,20,30" && at(6, 2).join() === "200,100,50");
// feathered borders
const al = featherAlpha(100, 60);
ok("alpha: transparent corners, opaque center", al[0] === 0 && al[100 * 60 - 1] === 0 && al[30 * 100 + 50] === 255);
ok("alpha: fades from the border", al[30 * 100 + 0] === 0 && al[30 * 100 + 2] > 0 && al[30 * 100 + 2] < 255 && al[30 * 100 + 10] === 255);

// ---- Cloudflare errors
ok("quota by status", imageErrorFrom(429, null).quota === true);
ok("quota by code 4006", imageErrorFrom(400, { errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] }).quota === true);
ok("bad token", /token/i.test(imageErrorFrom(403, { errors: [{ code: 10000, message: "Authentication error" }] }).error));
ok("bad token shows what Cloudflare said", /10000 Authentication error/.test(imageErrorFrom(403, { errors: [{ code: 10000, message: "Authentication error" }] }).error));
ok("wrong account id", /account/i.test(imageErrorFrom(404, { errors: [{ code: 7003, message: "Could not route" }] }).error));
ok("other error shows the message", /boom/.test(imageErrorFrom(500, { errors: [{ message: "boom" }] }).error));

// ---- generateImage with a fake network
const realFetch = globalThis.fetch;
const realEnv = { a: process.env.CF_ACCOUNT_ID, t: process.env.CF_API_TOKEN };
delete process.env.CF_ACCOUNT_ID;
delete process.env.CF_API_TOKEN;
ok("not connected without keys", !hasImageAi() && "error" in (await generateImage("x")));
process.env.CF_ACCOUNT_ID = '"acc1" ';
process.env.CF_API_TOKEN = " tok1\n";
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
