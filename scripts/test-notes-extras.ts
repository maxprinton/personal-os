// Notes database extras: "Review on" (Today + morning message), the ✨ one-line AI summary, and
// "@os NOTE-12" in Telegram (fake network and fake database: nothing is sent).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-notes-extras.ts
import { pickToReview, reviewLine, reviewProps, REVIEW_LOOKBACK_DAYS } from "@/lib/notes-db/review";
import { cleanSummary, summaryInput, SUMMARY_INPUT_LIMIT, SUMMARY_MAX } from "@/lib/notes-db/ai-summary";
import { askNotes, noteRefs } from "@/lib/bot/ask";
import { morningText } from "@/lib/reminders";
import { HELP } from "@/lib/telegram";
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

// ---- Review on -------------------------------------------------------------------------------
const PROPS = [
  { id: "pr", key: "review_on", config: {} },
  {
    id: "ps",
    key: "status",
    config: {
      defaultOptionId: "inbox",
      options: [
        { id: "inbox", name: "Inbox", color: "gray" as const, group: "todo" as const },
        { id: "desarrollando", name: "Desarrollando", color: "blue" as const, group: "in_progress" as const },
        { id: "lista", name: "Lista", color: "green" as const, group: "done" as const },
        { id: "archivada", name: "Archivada", color: "brown" as const, group: "done" as const },
      ],
    },
  },
];
const rp = reviewProps(PROPS)!;
ok("review props found", rp.reviewId === "pr" && rp.statusId === "ps" && rp.doneIds.has("lista") && rp.doneIds.has("archivada") && !rp.doneIds.has("inbox"));
ok("no Review on property → null", reviewProps([PROPS[1]]) === null);
const today = "2026-10-29";
const row = (id: string, start: string | null, status?: string, extra: Partial<{ title: string; block_name: string; icon: string }> = {}) => ({
  id,
  title: extra.title ?? id,
  block_name: extra.block_name ?? null,
  page: extra.icon ? { icon: extra.icon } : null,
  props: { ...(start ? { pr: { start, end: null, time: null } } : {}), ...(status ? { ps: status } : {}) },
});
const picked = pickToReview(
  [
    row("due-today", today, undefined, { icon: "📚" }),
    row("overdue-3", "2026-10-26", "desarrollando"),
    row("future", "2026-10-30"),
    row("done", "2026-10-28", "lista"),
    row("archived", "2026-10-28", "archivada"),
    row("too-old", "2026-10-01"),
    row("edge-old", "2026-10-15"),
    row("no-date", null),
    row("block", today, undefined, { block_name: "Gym", title: "" }),
    { id: "broken", title: "x", block_name: null, page: null, props: { pr: "nope" as never } },
  ],
  rp,
  today,
);
const ids = picked.map((p) => p.id);
ok("due today is shown", ids.includes("due-today") && picked.find((p) => p.id === "due-today")!.overdueDays === 0 && picked.find((p) => p.id === "due-today")!.icon === "📚");
ok("overdue is shown with its days", picked.find((p) => p.id === "overdue-3")?.overdueDays === 3);
ok("future is not shown", !ids.includes("future"));
ok("done group (Lista / Archivada) is not shown", !ids.includes("done") && !ids.includes("archived"));
ok(`older than ${REVIEW_LOOKBACK_DAYS} days is not shown`, !ids.includes("too-old") && ids.includes("edge-old"));
ok("no date / bad value is not shown", !ids.includes("no-date") && !ids.includes("broken"));
ok("block notes use their name", picked.find((p) => p.id === "block")?.title === "Gym");
ok("most overdue first", ids[0] === "edge-old" && ids[1] === "overdue-3", ids.join(","));
ok("review line", reviewLine([{ title: "A" }, { title: "B" }]) === "\n📖 To review: A · B");
ok("review line +N more", reviewLine([1, 2, 3, 4, 5, 6].map((n) => ({ title: `N${n}` }))) === "\n📖 To review: N1 · N2 · N3 · N4 (+2 more)");
ok("review line empty", reviewLine([]) === "");
{
  const day = { items: [], dayNotes: [], freeDay: false, payments: [], tasks: [], unassigned: 0, habits: [], review: [{ id: "1", title: "Libro X", icon: null, date: today, overdueDays: 0 }] };
  const t = morningText(today, day as never);
  ok("morning message lists notes to review", t.includes("📖 To review: Libro X"), t);
  const t2 = morningText(today, { ...day, review: [] } as never);
  ok("morning message without notes to review", !t2.includes("📖"));
  const t3 = morningText(today, { ...day, review: undefined } as never);
  ok("morning message survives no review data", !t3.includes("📖"));
}

// ---- ✨ AI summary ------------------------------------------------------------------------------
ok("empty note → null", summaryInput("Title", "  \n • \n☐ ") === null);
ok("note → input with title", summaryInput("Viaje", "Hotel Casa Azul")?.includes("TITLE: Viaje") === true);
ok("long note is cut", (summaryInput("t", "x".repeat(50_000)) ?? "").length < SUMMARY_INPUT_LIMIT + 200);
ok("clean: preface", cleanSummary("Summary: Trip to Cuenca on Nov 5.") === "Trip to Cuenca on Nov 5.");
ok("clean: spanish preface + quotes", cleanSummary("Resumen: “Viaje a Cuenca el 5 de noviembre.”") === "Viaje a Cuenca el 5 de noviembre.");
ok("clean: first line only, no markdown", cleanSummary("**Plan** de ventas para Q4.\n\nMore text") === "Plan de ventas para Q4.");
ok("clean: thinking + fence", cleanSummary("<think>x</think>```\nIdeas de negocio.\n```") === "Ideas de negocio.");
const long = cleanSummary("word ".repeat(100));
ok("clean: long is cut with …", long.length <= SUMMARY_MAX && long.endsWith("…"), String(long.length));

// ---- NOTE-12 ----------------------------------------------------------------------------------
const refs = (q: string) => noteRefs(q);
ok("NOTE-12 alone", JSON.stringify(refs("NOTE-12")) === JSON.stringify({ nums: [12], rest: "" }));
ok("note-12 lowercase", refs("note-12")?.nums[0] === 12);
ok("NOTE12 / NOTE #12 / NOTE – 12", refs("NOTE12")?.nums[0] === 12 && refs("what is NOTE #12?")?.nums[0] === 12 && refs("NOTE – 12")?.nums[0] === 12);
ok("'note 12' alone", refs("note 12")?.nums[0] === 12 && refs("nota 12?")?.nums[0] === 12);
ok("'note 12' inside a question is ambiguous", refs("write a note 12 ideas") === null);
ok("question about NOTE-12", refs("NOTE-12 when is the trip?")?.rest === "when is the trip?");
ok("only filler words → summary", refs("NOTE-12 and NOTE-15")?.rest === "" && JSON.stringify(refs("NOTE-12 and NOTE-15")?.nums) === "[12,15]");
ok("not inside words", refs("keynote-5") === null && refs("notes12") === null && refs("covid-19") === null);
ok("custom prefix", noteRefs("IDEA-7 summary?", ["IDEA"])?.nums[0] === 7);
ok("help mentions NOTE-12", HELP.includes("NOTE-12"));

process.env.GROQ_API_KEY = "test";
const realFetch = globalThis.fetch;
type Call = { url: string; body: Record<string, unknown> | null };
async function fake(answers: string[], run: () => Promise<void>): Promise<Call[]> {
  let i = 0;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: u, body });
    if (u.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b", active: true }, { id: "llama-3.1-8b-instant", active: true }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: answers[i++] ?? "ok" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}
const chat = (c: Call[]) => c.filter((x) => x.url.endsWith("/chat/completions"));

const NOTES = [
  { id: "11111111-1111-1111-1111-111111111111", seq: 12, title: "Viaje a Cuenca", content: "Salimos el 5 de noviembre. Hotel: **Casa Azul**.", block_name: null, updated_at: "2026-10-20T10:00:00Z" },
  { id: "22222222-2222-2222-2222-222222222222", seq: 15, title: "Ideas de negocio", content: "Vender cursos de Excel.", block_name: null, updated_at: "2026-10-21T10:00:00Z" },
];
/** A fake admin client: notes filtered by user and seq; `fullScan` counts the search's full reads. */
function fakeDb(opts: { seqError?: boolean } = {}) {
  const log = { inSeq: [] as number[][], fullScan: 0, users: [] as string[] };
  const from = (table: string) => {
    const f: { seq?: number[] } = {};
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "is", "order", "limit"]) chain[k] = () => chain;
    chain.eq = (col: string, v: string) => {
      if (col === "user_id") log.users.push(v);
      return chain;
    };
    chain.in = (col: string, v: number[]) => {
      if (col === "seq") {
        f.seq = v;
        log.inSeq.push(v);
      }
      return chain;
    };
    chain.range = (a: number) => {
      log.fullScan++;
      return Promise.resolve({ data: a === 0 ? NOTES : [], error: null });
    };
    chain.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
      if (table === "note_properties") return Promise.resolve({ data: [{ config: { prefix: "NOTE" } }], error: null }).then(res, rej);
      if (opts.seqError) return Promise.resolve({ data: null, error: { message: "column notes.seq does not exist" } }).then(res, rej);
      return Promise.resolve({ data: NOTES.filter((n) => f.seq?.includes(n.seq)), error: null }).then(res, rej);
    };
    return chain;
  };
  return { db: { from } as unknown as Ctx["admin"], log };
}
const ctxWith = (db: Ctx["admin"]) => ({ admin: db, userId: "u1", chatId: 1, tz: "America/Guayaquil", today, nowMin: 600 }) as Ctx;
{
  const { db, log } = fakeDb();
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake(["- Viaje a Cuenca el 5 de noviembre, hotel Casa Azul."], async () => void (r = await askNotes(ctxWith(db), "NOTE-12")));
  const cc = chat(calls);
  const body = JSON.stringify(cc[0]?.body ?? {});
  ok("NOTE-12: straight to the note (one AI call, no search)", cc.length === 1 && log.fullScan === 0 && JSON.stringify(log.inSeq) === "[[12]]", `${cc.length} ${log.fullScan}`);
  ok("NOTE-12 alone: asks for a summary", body.includes("summarize") && body.includes("Summarize the note"));
  ok("NOTE-12: the note is read (plain text)", body.includes("Casa Azul") && !body.includes("**Casa Azul**") && !body.includes("cursos de Excel"));
  ok("NOTE-12: answer names the note + button", !!r && r!.text.includes("📄 From: NOTE-12 Viaje a Cuenca") && r!.noteIds[0] === NOTES[0].id && r!.kb.length === 1, r?.text);
  ok("NOTE-12: every query filters by user", log.users.length > 0 && log.users.every((u) => u === "u1"));
}
{
  const { db, log } = fakeDb();
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake(["El 5 de noviembre."], async () => void (r = await askNotes(ctxWith(db), "¿cuándo salimos según note-12?")));
  const body = JSON.stringify(chat(calls)[0]?.body ?? {});
  ok("question about NOTE-12: answers it", body.includes("QUESTION: ¿cuándo salimos") && !body.includes("Summarize the note") && log.fullScan === 0);
  ok("question about NOTE-12: answer text", !!r && r!.text.startsWith("El 5 de noviembre."));
}
{
  const { db } = fakeDb();
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake(["- Viaje\n- Ideas"], async () => void (r = await askNotes(ctxWith(db), "NOTE-12 y NOTE-15 y NOTE-99")));
  ok("several NOTE refs at once", !!r && r!.noteIds.length === 2 && r!.text.includes("NOTE-15 Ideas de negocio") && r!.text.includes("(NOTE-99 not found)") && chat(calls).length === 1, r?.text);
}
{
  const { db } = fakeDb();
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  const calls = await fake([], async () => void (r = await askNotes(ctxWith(db), "NOTE-99")));
  ok("unknown NOTE number says so (no AI call)", !!r && /couldn't find NOTE-99/.test(r!.text) && r!.noteIds.length === 0 && chat(calls).length === 0, r?.text);
}
{
  const { db, log } = fakeDb({ seqError: true });
  let r = null as Awaited<ReturnType<typeof askNotes>> | null;
  await fake([JSON.stringify({ notes: [1] }), "Casa Azul."], async () => void (r = await askNotes(ctxWith(db), "NOTE-12 hotel")));
  ok("no migration 0021: falls back to the normal search", !!r && log.fullScan === 1 && r!.text.startsWith("Casa Azul."), r?.text);
}
{
  const { db, log } = fakeDb();
  await fake([JSON.stringify({ notes: [1] }), "Casa Azul."], async () => void (await askNotes(ctxWith(db), "¿cuál era el hotel del viaje?")));
  ok("normal questions still search", log.fullScan === 1 && log.inSeq.length === 0);
}

console.log(`\n${fail ? "⚠️" : "✅"} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
