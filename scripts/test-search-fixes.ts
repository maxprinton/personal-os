// Tests for the search + AI fixes (Nov 6): citation check, Cloudflare backup, @os through the search engine.
import { weakCitations, claimStems, type Source } from "@/lib/search/ai-evidence";
import { aiChat } from "@/lib/ai";
import { usageLine } from "@/lib/ai-usage";
import { askNotes } from "@/lib/bot/ask";
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

// ---- Citation check ----
const SRC: Source[] = [
  { n: 1, id: "a", title: "Viaje a Cuenca", parentTitle: null, props: ["Type: Trip"], passages: [{ label: "Text", text: "Hotel Casa Azul, cuarenta dólares la noche, salida el 5 de noviembre" }] },
  { n: 2, id: "b", title: "Presupuesto mensual", parentTitle: null, props: [], passages: [{ label: "Text", text: "Gastos de comida y transporte del mes" }] },
];
ok("claim backed by the note → not weak", weakCitations("El hotel del viaje fue Casa Azul", [1], SRC).length === 0);
ok("claim not in the note → weak", JSON.stringify(weakCitations("El hotel del viaje fue Casa Azul", [2], SRC)) === "[2]");
ok("mixed citation: only the wrong one is weak", JSON.stringify(weakCitations("Hotel Casa Azul en noviembre", [1, 2], SRC)) === "[2]");
ok("stems: planning ~ planned", claimStems("planning").includes("plann") && claimStems("planned").includes("plann"));
ok("plural/singular match", weakCitations("Varios presupuestos de gastos", [2], SRC).length === 0);
ok("searched words don't count as support", JSON.stringify(weakCitations("Cuenca trip budget", [2], SRC, ["cuenca"])) === "[2]");
ok("too short to judge → never weak", weakCitations("Ver nota", [2], SRC).length === 0);
ok("unknown citation number ignored", weakCitations("Hotel Casa Azul", [9], SRC).length === 0);

// ---- Cloudflare backup ----
const realFetch = globalThis.fetch;
type Call = { url: string; body: Record<string, unknown> | null };
async function net(handler: (url: string) => Response, run: () => Promise<void>): Promise<Call[]> {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return handler(u);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}
const models = () => new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b", active: true }, { id: "llama-3.1-8b-instant", active: true }] }), { status: 200 });
process.env.GROQ_API_KEY = "test";
process.env.CF_ACCOUNT_ID = "acc123";
process.env.CF_API_TOKEN = "tok";
{
  let out = null as Awaited<ReturnType<typeof aiChat>> | null;
  const calls = await net(
    (u) => (u.endsWith("/models") ? models() : u.includes("groq") ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ result: { response: "respuesta de respaldo", usage: { prompt_tokens: 10, completion_tokens: 5 } } }), { status: 200 })),
    async () => void (out = await aiChat("sys", [{ text: "hola" }], { timeoutMs: 20000 })),
  );
  ok("Groq out of quota → Cloudflare answers", !!out && "text" in out! && out!.text === "respuesta de respaldo" && (out as { model?: string }).model!.startsWith("cloudflare:"), JSON.stringify(out));
  const cf = calls.filter((c) => c.url.includes("api.cloudflare.com"));
  ok("backup uses the account and the big model first", cf.length === 1 && cf[0].url.includes("/accounts/acc123/ai/run/@cf/meta/llama-3.3-70b"));
  ok("backup gets system + user messages", JSON.stringify(cf[0].body?.messages ?? "").includes("hola"));
}
{
  let out = null as Awaited<ReturnType<typeof aiChat>> | null;
  const calls = await net((u) => (u.endsWith("/models") ? models() : new Response(JSON.stringify({ choices: [{ message: { content: "groq ok" } }] }), { status: 200 })), async () => void (out = await aiChat("s", [{ text: "x" }])));
  ok("Groq works → backup not used", !!out && "text" in out! && out!.text === "groq ok" && !calls.some((c) => c.url.includes("cloudflare")));
}
{
  let out = null as Awaited<ReturnType<typeof aiChat>> | null;
  const calls = await net((u) => (u.endsWith("/models") ? models() : new Response("{}", { status: 429 })), async () => void (out = await aiChat("s", [{ image: { mime: "image/jpeg", base64: "AA" } }], { kind: "vision" })));
  ok("photos never go to the backup", !!out && "error" in out! && !calls.some((c) => c.url.includes("cloudflare")));
}
{
  let out = null as Awaited<ReturnType<typeof aiChat>> | null;
  await net((u) => (u.endsWith("/models") ? models() : new Response("{}", { status: 429 })), async () => void (out = await aiChat("s", [{ text: "x" }])));
  ok("both down → the clear Groq message", !!out && "error" in out! && /free AI limit/.test((out as { error: string }).error));
}
{
  process.env.AI_BACKUP = "off";
  const calls = await net((u) => (u.endsWith("/models") ? models() : new Response("{}", { status: 429 })), async () => void (await aiChat("s", [{ text: "x" }])));
  ok("AI_BACKUP=off turns the backup off", !calls.some((c) => c.url.includes("cloudflare")));
  delete process.env.AI_BACKUP;
}
ok("usage line names the backup", (usageLine([{ feature: "f", model: "cloudflare:llama", prompt: 10, completion: 5, at: "" }], null, "2026-11-06") ?? "").includes("Cloudflare backup"));

// ---- @os through the search engine ----
const NOTES = [
  { id: "n1", title: "Viaje a Cuenca", content: "Hotel: Casa Azul, $40 la noche.", block_name: null, updated_at: "2026-10-20T10:00:00Z" },
  { id: "n2", title: "Ideas de negocio", content: "Vender cursos de Excel.", block_name: null, updated_at: "2026-10-21T10:00:00Z" },
];
function engineDb() {
  const log = { fullScan: 0, loadedIds: [] as string[][], rpc: [] as string[] };
  const from = (table: string) => {
    const f: { ids?: string[]; limit?: number } = {};
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "order"]) chain[k] = () => chain;
    chain.limit = (n: number) => ((f.limit = n), chain);
    chain.in = (_c: string, v: string[]) => ((f.ids = v), chain);
    chain.range = () => {
      log.fullScan++;
      return Promise.resolve({ data: NOTES, error: null });
    };
    chain.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
      let out: unknown = { data: [], error: null };
      if (table === "notes" && f.ids) {
        log.loadedIds.push(f.ids);
        out = { data: NOTES.filter((n) => f.ids!.includes(n.id)).map((n) => ({ ...n, title: n.title, parent_id: null, page: null, deleted_at: null, is_template: false })), error: null };
      } else if (table === "notes") out = { data: NOTES.map((n) => ({ ...n, content: "" })), error: null };
      else if (table === "search_chunks") out = { data: [{ note_id: "n1", body: "Type: Trip\nAI summary: viaje a Cuenca" }], error: null };
      else if (table === "search_state") out = { data: null, count: 2, error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return chain;
  };
  const rpc = (name: string) => {
    log.rpc.push(name);
    if (name === "search_notes") return Promise.resolve({ data: [{ note_id: "n1", score: 1, total: 1, hits: { pieces: 1, top: [{ kind: "text", label: null, anchor: null, file: null, body: "Hotel: Casa Azul, $40 la noche." }] } }], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  return { db: { from, rpc } as unknown as Ctx["admin"], log };
}
{
  const { db, log } = engineDb();
  const ctx = { admin: db, userId: "u", chatId: 1, tz: "America/Guayaquil", today: "2026-11-06", nowMin: 600 } as Ctx;
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  let k = 0;
  const calls = await net(
    (u) => {
      if (u.endsWith("/models")) return models();
      k++;
      return new Response(JSON.stringify({ choices: [{ message: { content: k === 1 ? JSON.stringify({ notes: [1] }) : "El hotel es Casa Azul." } }] }), { status: 200 });
    },
    async () => void (r = await askNotes(ctx, "¿cuál era el hotel del viaje a Cuenca?")),
  );
  const chats = calls.filter((c) => c.url.includes("chat/completions"));
  ok("@os: uses the search engine (no full scan)", log.rpc.includes("search_notes") && log.fullScan === 0, JSON.stringify(log));
  ok("@os: search hit is offered first, with its properties", JSON.stringify(chats[0]?.body ?? "").includes("[1] Viaje a Cuenca") && JSON.stringify(chats[0]?.body ?? "").includes("Type: Trip"));
  ok("@os: only the chosen note is loaded in full", log.loadedIds.some((ids) => JSON.stringify(ids) === '["n1"]'));
  ok("@os: answer reads the full note", JSON.stringify(chats[1]?.body ?? "").includes("Casa Azul") && !!r && r!.text.includes("📄 From: Viaje a Cuenca"), r?.text);
}

console.log(`\n${fail ? "⚠️" : "✅"} search fixes: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
