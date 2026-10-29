// Checks what the ✨ AI in notes sends to Gemini and how it cleans the answer (no network).
// Run: npm run test:ai
import { buildAiPrompt, cleanAiMarkdown, AI_MODES, SELECTION_MODES } from "@/lib/ai-notes";
import { geminiWrite } from "@/lib/gemini";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}`);
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
ok("huge pages are cut", "user" in big && big.user.length < 70_000);
ok("bad mode", "error" in buildAiPrompt({ mode: "nope" as never }));

ok("fence removed", cleanAiMarkdown("```markdown\n- a\n- b\n```") === "- a\n- b");
ok("preface removed", cleanAiMarkdown("Here is the summary:\n\n- a") === "- a");
ok("spanish preface removed", cleanAiMarkdown("Aquí tienes el resumen:\n- a") === "- a");
ok("normal text kept", cleanAiMarkdown("  ## Title\n\ntext  ") === "## Title\n\ntext");
ok("inner code kept", cleanAiMarkdown("Text\n\n```js\nx()\n```") === "Text\n\n```js\nx()\n```");

// Gemini busy (503) / out of quota (429): retry, then the next model (fake network)
process.env.GEMINI_API_KEY = "test";
const realFetch = globalThis.fetch;
const answer = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
async function withFetch(statuses: number[], run: () => Promise<void>) {
  let i = 0;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url).split("/models/")[1]?.split(":")[0] ?? "");
    const st = statuses[i++] ?? 200;
    return st === 200 ? answer("ok text") : new Response("{}", { status: st });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
}
{
  let r: Awaited<ReturnType<typeof geminiWrite>> | null = null;
  const seen = await withFetch([503, 200], async () => void (r = await geminiWrite("s", [{ text: "u" }])));
  ok("503 then retry works", !!r && "text" in r! && seen.length === 2 && seen[0] === seen[1]);
}
{
  let r: Awaited<ReturnType<typeof geminiWrite>> | null = null;
  const seen = await withFetch([503, 503, 200], async () => void (r = await geminiWrite("s", [{ text: "u" }])));
  ok("busy model → next model", !!r && "text" in r! && seen.length === 3 && seen[2] !== seen[0]);
}
{
  let r: Awaited<ReturnType<typeof geminiWrite>> | null = null;
  await withFetch([503, 503, 503, 503, 503, 503, 503, 503, 503, 503], async () => void (r = await geminiWrite("s", [{ text: "u" }], { timeoutMs: 60000 })));
  ok("all busy → clear message", !!r && "error" in r! && /busy/.test((r as { error: string }).error));
}
{
  let r: Awaited<ReturnType<typeof geminiWrite>> | null = null;
  await withFetch([429, 429, 429, 429, 429, 429, 429, 429, 429, 429], async () => void (r = await geminiWrite("s", [{ text: "u" }], { timeoutMs: 60000 })));
  ok("quota → quota message", !!r && "error" in r! && /quota/.test((r as { error: string }).error));
}

console.log(`\n${fail ? "⚠️" : "✅"} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
