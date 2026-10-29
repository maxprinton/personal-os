// Checks what the ✨ AI in notes sends to the AI (Groq), how it cleans the answer, and how the Groq
// connection behaves when models are busy, out of quota or gone (fake network, nothing is sent).
// Run: npm run test:ai
import { buildAiPrompt, cleanAiMarkdown, AI_MODES, SELECTION_MODES } from "@/lib/ai-notes";
import { aiChat, aiJson, modelsFor, transcribe } from "@/lib/ai";
import { askNotes, askQuestion, forTelegram, keywords, score } from "@/lib/bot/ask";
import type { Ctx } from "@/lib/bot/core";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const page = { title: "Viaje a Cuenca", content: '<callout icon="💡" color="gray_bg">\n\nLlevar **pasaporte**\n\n</callout>\n\n- comprar pasajes\n- reservar hotel' };

for (const mode of AI_MODES) {
  const r = buildAiPrompt({ mode, page, text: "hola mundo", prompt: "x", notes: [{ title: "A", content: "uno" }] });
  ok(`${mode} builds`, !("error" in r));
}
const sum = buildAiPrompt({ mode: "summarize", page });
ok("summary has the title", "user" in sum && sum.user.includes("Viaje a Cuenca"));
ok("callout tags are simplified", "user" in sum && !sum.user.includes("<callout") && sum.user.includes("pasaporte"));
for (const m of SELECTION_MODES) ok(`${m} needs a selection`, "error" in buildAiPrompt({ mode: m, page }));
ok("write needs a request", "error" in buildAiPrompt({ mode: "write", page }));
ok("write with a request", !("error" in buildAiPrompt({ mode: "write", page, prompt: "un plan de viaje" })));
const tr = buildAiPrompt({ mode: "translate", page, text: "hola", prompt: "English" });
ok("translate names the language", "user" in tr && tr.user.includes("English") && tr.temperature <= 0.3);
const ref = buildAiPrompt({ mode: "write", page, prompt: "plan", previous: "Draft 1", refine: "more formal" });
ok("refine sends the previous draft", "user" in ref && ref.user.includes("Draft 1") && ref.user.includes("more formal"));
ok("empty notes refuse", "error" in buildAiPrompt({ mode: "summarize-notes", notes: [{ title: "", content: "  " }] }));
const many = buildAiPrompt({ mode: "summarize-notes", notes: [{ title: "A", content: "uno" }, { title: "B", content: "dos" }] });
ok("several notes are all sent", "user" in many && many.user.includes("NOTE 1: A") && many.user.includes("NOTE 2: B"));
const big = buildAiPrompt({ mode: "summarize", page: { title: "t", content: "a".repeat(200_000) } });
ok("huge pages are cut", "user" in big && big.user.length < 16_000);
ok("bad mode", "error" in buildAiPrompt({ mode: "nope" as never }));

ok("fence removed", cleanAiMarkdown("```markdown\n- a\n- b\n```") === "- a\n- b");
ok("preface removed", cleanAiMarkdown("Here is the summary:\n\n- a") === "- a");
ok("spanish preface removed", cleanAiMarkdown("Aquí tienes el resumen:\n- a") === "- a");
ok("normal text kept", cleanAiMarkdown("  ## Title\n\ntext  ") === "## Title\n\ntext");
ok("inner code kept", cleanAiMarkdown("Text\n\n```js\nx()\n```") === "Text\n\n```js\nx()\n```");

// ---- Groq connection (fake network) ----
process.env.GROQ_API_KEY = "test";
const realFetch = globalThis.fetch;
type Call = { url: string; body: Record<string, unknown> | null };
const MODELS = ["openai/gpt-oss-120b", "llama-3.1-8b-instant", "qwen/qwen3.8-27b", "whisper-large-v3-turbo", "meta-llama/llama-guard-4-12b"];
async function fake(chatStatuses: (number | string)[], run: () => Promise<void>): Promise<Call[]> {
  let i = 0;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: u, body });
    if (u.endsWith("/models")) return new Response(JSON.stringify({ data: MODELS.map((id) => ({ id, active: true })) }), { status: 200 });
    if (u.endsWith("/audio/transcriptions")) return new Response(JSON.stringify({ text: "gasté 5 en almuerzo" }), { status: 200 });
    const st = chatStatuses[i++] ?? 200;
    if (typeof st === "string") return new Response(JSON.stringify({ choices: [{ message: { content: st } }] }), { status: 200 });
    return st === 200
      ? new Response(JSON.stringify({ choices: [{ message: { content: "ok text" } }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "x" } }), { status: st });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}
const chatCalls = (c: Call[]) => c.filter((x) => x.url.endsWith("/chat/completions"));
{
  let w: string[] = [];
  let v: string[] = [];
  await fake([], async () => {
    w = await modelsFor("write");
    v = await modelsFor("vision");
  });
  ok("best text model first", w[0] === "openai/gpt-oss-120b");
  ok("models the key doesn't have are skipped", !w.includes("llama-3.3-70b-versatile"));
  ok("guard / whisper are never chat models", !w.some((m) => /guard|whisper/.test(m)));
  ok("vision model found", v[0] === "qwen/qwen3.8-27b");
}
{
  let r: Awaited<ReturnType<typeof aiChat>> | null = null;
  const c = await fake([503, 200], async () => void (r = await aiChat("s", [{ text: "u" }])));
  const cc = chatCalls(c);
  ok("busy (503) → second try works", !!r && "text" in r! && cc.length === 2 && cc[0].body?.model === cc[1].body?.model);
  ok("gpt-oss gets low reasoning", cc[0].body?.reasoning_effort === "low");
}
{
  let r: Awaited<ReturnType<typeof aiChat>> | null = null;
  const c = await fake([429, 200], async () => void (r = await aiChat("s", [{ text: "u" }])));
  const cc = chatCalls(c);
  ok("out of quota (429) → next model", !!r && "text" in r! && cc.length === 2 && cc[0].body?.model !== cc[1].body?.model);
}
{
  let r: Awaited<ReturnType<typeof aiChat>> | null = null;
  await fake([429, 429, 429, 429, 429, 429], async () => void (r = await aiChat("s", [{ text: "u" }])));
  ok("all out of quota → clear message", !!r && "error" in r! && /limit/.test((r as { error: string }).error));
}
{
  let r: Awaited<ReturnType<typeof aiChat>> | null = null;
  await fake([401], async () => void (r = await aiChat("s", [{ text: "u" }])));
  ok("bad key → says so", !!r && "error" in r! && /refused the key/.test((r as { error: string }).error));
}
{
  let r: Awaited<ReturnType<typeof aiChat>> | null = null;
  await fake(["<think>hmm let me think</think>\n- real answer"], async () => void (r = await aiChat("s", [{ text: "u" }])));
  ok("thinking is removed", !!r && "text" in r! && (r as { text: string }).text === "- real answer");
}
{
  let out: unknown = null;
  const c = await fake([JSON.stringify({ kind: "transaction", amount: 12 })], async () => void (out = await aiJson("s", [{ text: "Caption" }, { image: { mime: "image/jpeg", base64: "AAAA" } }], "vision")));
  const body = chatCalls(c)[0]?.body as { model?: string; messages?: { content: unknown }[]; response_format?: unknown } | undefined;
  const content = body?.messages?.[1]?.content as { type: string; image_url?: { url: string } }[] | undefined;
  ok("photo goes to the vision model", body?.model === "qwen/qwen3.8-27b");
  ok("photo is sent as an image", Array.isArray(content) && content.some((p) => p.type === "image_url" && p.image_url!.url.startsWith("data:image/jpeg;base64,")));
  ok("JSON answer is read", (out as { amount?: number } | null)?.amount === 12);
}
{
  let t: string | null = null;
  const c = await fake([], async () => void (t = await transcribe(Buffer.from("fake").toString("base64"), "audio/ogg")));
  ok("voice note → Whisper", t === "gasté 5 en almuerzo" && c.some((x) => x.url.endsWith("/audio/transcriptions")));
}
{
  const big = buildAiPrompt({ mode: "summarize-notes", notes: Array.from({ length: 5 }, (_, k) => ({ title: `N${k}`, content: "x".repeat(20_000) })) });
  ok("several long notes fit the free limit", "user" in big && big.user.length < 16_000);
  const sel = buildAiPrompt({ mode: "improve", text: "y".repeat(50_000), page: { title: "t", content: "z".repeat(50_000) } });
  ok("long selection fits the free limit", "user" in sel && sel.user.length < 16_000);
  const cont = buildAiPrompt({ mode: "continue", text: "start " + "w".repeat(30_000) + " THE END", page: { title: "t" } });
  ok("continue keeps the end of the text", "user" in cont && cont.user.includes("THE END") && cont.user.length < 16_000);
}

// ---- Ask your notes (Telegram) ----
ok("@os question", askQuestion("@os qué dice mi nota del viaje?") === "qué dice mi nota del viaje?");
ok("@OS works in capitals", askQuestion("@OS what about the budget") === "what about the budget");
ok("/os question", askQuestion("/os resumen de mis ideas") === "resumen de mis ideas");
ok("/os@bot question", askQuestion("/os@maxpersonalos_bot hola") === "hola");
ok("os: question", askQuestion("os: qué escribí del gym") === "qué escribí del gym");
ok("voice: 'OS, …'", askQuestion("OS, qué escribí sobre el gimnasio") === "qué escribí sobre el gimnasio");
ok("voice: 'O.S., …'", askQuestion("O.S., qué dice la nota X") === "qué dice la nota X");
ok("@gem is gone", askQuestion("@gem hola") === null && askQuestion("@ai hola") === null);
ok("/ai alone is the connection check", askQuestion("/ai") === null);
ok("normal messages are not questions", askQuestion("gasté 5 en osos") === null && askQuestion("@osvaldo call him") === null && askQuestion("/oscar") === null && askQuestion("os voy a llamar mañana") === null);
ok("keywords drop filler words", JSON.stringify(keywords("¿Qué escribí sobre el viaje a Cuenca?")) === JSON.stringify(["viaje", "cuenca"]), keywords("¿Qué escribí sobre el viaje a Cuenca?").join(","));
ok("title matches count more", score({ title: "Viaje a Cuenca", content: "" }, ["viaje"]) > score({ title: "Otra", content: "viaje" }, ["viaje"]));
ok("plurals match", score({ title: "", content: "anoté un gasto grande" }, ["gastos"]) === 0 || score({ title: "Gastos del mes", content: "" }, ["gastos"]) > 0);
ok("telegram text has no markdown", forTelegram("## Hi\n**bold** and *it*\n- one\n- [ ] todo") === "Hi\nbold and it\n• one\n☐ todo", forTelegram("## Hi\n**bold** and *it*\n- one\n- [ ] todo"));

function fakeDb(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "is", "order"]) chain[k] = () => chain;
  chain.range = (a: number) => Promise.resolve({ data: a === 0 ? rows : [], error: null });
  return { from: () => chain } as unknown as Ctx["admin"];
}
const NOTES = [
  { id: "11111111-1111-1111-1111-111111111111", title: "Viaje a Cuenca", content: "Salimos el 5 de noviembre. Hotel: Casa Azul, $40 la noche.", block_name: null, updated_at: "2026-10-20T10:00:00Z" },
  { id: "22222222-2222-2222-2222-222222222222", title: "Ideas de negocio", content: "Vender cursos de Excel.", block_name: null, updated_at: "2026-10-21T10:00:00Z" },
  { id: "33333333-3333-3333-3333-333333333333", title: "Gym", content: "Lunes pecho, martes pierna.", block_name: "Gym", updated_at: "2026-10-22T10:00:00Z" },
];
const ctx = { admin: fakeDb(NOTES), userId: "u", chatId: 1, tz: "America/Guayaquil", today: "2026-10-29", nowMin: 600 } as Ctx;
{
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake([JSON.stringify({ notes: [1] }), "El hotel es **Casa Azul**, a $40 la noche."], async () => void (r = await askNotes(ctx, "¿Cuál era el hotel del viaje a Cuenca?")));
  const cc = chatCalls(calls);
  const pickMsg = JSON.stringify(cc[0]?.body ?? {});
  ok("ask: the matching note is offered first", pickMsg.includes("[1] Viaje a Cuenca"));
  const answerMsg = JSON.stringify(cc[1]?.body ?? {});
  ok("ask: the chosen note is read in full", answerMsg.includes("Casa Azul") && !answerMsg.includes("cursos de Excel"));
  ok("ask: answer + source + button", !!r && r!.text.includes("Casa Azul, a $40") && r!.text.includes("📄 From: Viaje a Cuenca") && r!.kb.length === 1 && r!.noteIds[0] === NOTES[0].id, r ? r!.text : "");
}
{
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake([JSON.stringify({ notes: [1, 2] }), "- Viaje: Casa Azul\n- Gym: lunes pecho"], async () => void (r = await askNotes(ctx, "resume el viaje y el gym")));
  ok("ask: several notes at once", !!r && r!.noteIds.length === 2 && r!.text.includes("•"));
  ok("ask: block notes show as ✏️", JSON.stringify(chatCalls(calls)[0]?.body ?? {}).includes("✏️ Gym"));
}
{
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  await fake([JSON.stringify({ notes: [] })], async () => void (r = await askNotes(ctx, "¿qué dice sobre marte?")));
  ok("ask: nothing found says so", !!r && r!.noteIds.length === 0 && /couldn't find/.test(r!.text));
}
{
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake([JSON.stringify({ notes: [] }), "Sí, $40."], async () => void (r = await askNotes(ctx, "¿y cuánto costaba?", { ids: [NOTES[0].id], q: "hotel del viaje", a: "Casa Azul" })));
  ok("ask: follow-up keeps the same notes", !!r && r!.noteIds[0] === NOTES[0].id && JSON.stringify(chatCalls(calls)[1]?.body ?? {}).includes("EARLIER QUESTION"));
}

console.log(`\n${fail ? "⚠️" : "✅"} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
