// AI usage: every Groq call is counted in its scope with what Groq says is left, saved, and summed up.
import { aiChat } from "@/lib/ai";
import { scopeCalls, startOfDay, usageLine, usageReport, withAiUsage, type UsageSummary } from "@/lib/ai-usage";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));

process.env.GROQ_API_KEY = "test";
process.env.AI_MODEL = "openai/gpt-oss-120b";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }] }), { status: 200 });
  return new Response(JSON.stringify({ choices: [{ message: { content: "Hola" } }], usage: { prompt_tokens: 1200, completion_tokens: 640 } }), {
    status: 200,
    headers: { "x-ratelimit-remaining-requests": "912", "x-ratelimit-limit-requests": "1000", "x-ratelimit-remaining-tokens": "6100", "x-ratelimit-limit-tokens": "8000" },
  });
}) as typeof fetch;

const inserted: Record<string, unknown>[] = [];
const sb = { from: () => ({ insert: async (rows: Record<string, unknown>[]) => (inserted.push(...rows), { error: null }) }) } as never;

let calls: ReturnType<typeof scopeCalls> = [];
await withAiUsage(
  "telegram",
  async () => {
    await withAiUsage("bot-ask", () => aiChat("sys", [{ text: "hi" }]));
    await aiChat("sys", [{ text: "again" }]);
    calls = [...scopeCalls()];
  },
  { sb, userId: "u1" },
);
globalThis.fetch = realFetch;
ok("calls counted", calls.length === 2, String(calls.length));
ok("tokens and headers read", calls[0].prompt === 1200 && calls[0].completion === 640 && calls[0].remReq === 912 && calls[0].limReq === 1000 && calls[0].remTok === 6100);
ok("feature of the inner scope", calls[0].feature === "bot-ask" && calls[1].feature === "telegram");
ok("saved at the end", inserted.length === 2 && inserted[0].user_id === "u1" && inserted[0].model === "openai/gpt-oss-120b" && inserted[0].remaining_requests === 912);
ok("no scope = nothing recorded", (await aiChat("s", [{ text: "x" }]).then(() => scopeCalls().length)) === 0);

const sum: UsageSummary = {
  rows: [
    { day: "2026-10-30", model: "openai/gpt-oss-120b", feature: "bot-ask", calls: 10, tokens: 21_560 },
    { day: "2026-10-30", model: "openai/gpt-oss-120b", feature: "telegram", calls: 2, tokens: 1840 },
    { day: "2026-10-30", model: "whisper-large-v3-turbo", feature: "telegram", calls: 3, tokens: 0 },
    { day: "2026-10-29", model: "openai/gpt-oss-120b", feature: "notes-ai", calls: 5, tokens: 9000 },
  ],
  latest: [{ model: "openai/gpt-oss-120b", at: "2026-10-30T15:00:00Z", remaining_requests: 912, limit_requests: 1000, remaining_tokens: 6100, limit_tokens: 8000 }],
};
const line = usageLine([calls[0]], sum, "2026-10-30");
ok("usage line", line === "✨ 1,840 tokens · today 23K of 200K tokens · 912 of 1,000 requests left · 12% of today's limit", line ?? "");
ok("no calls, no line", usageLine([], sum, "2026-10-30") === null);
const rep = usageReport(sum, "2026-10-30") ?? "";
ok("report totals", rep.includes("15 requests · 23,400 tokens"), rep);
ok("report by model", rep.includes("openai/gpt-oss-120b: 12 requests · 23K of 200K tokens (12%) · 912 of 1,000 requests left") && rep.includes("whisper-large-v3-turbo: 3 requests"), rep);
ok("report by feature", rep.includes("Telegram @os: 10") && rep.includes("Telegram (voice, photos, messages): 5"), rep);
ok("short report (morning)", usageReport(sum, "2026-10-29", { title: "yesterday", short: true }) === "✨ AI yesterday: 9.0K tokens in 5 requests.");
ok("short report, nothing", usageReport(sum, "2026-10-01", { short: true }) === null);
ok("no migration", (usageReport(null, "2026-10-30") ?? "").includes("MIGRACION-0025"));
ok("start of day in Guayaquil", startOfDay("2026-10-30", "America/Guayaquil") === "2026-10-30T05:00:00.000Z", startOfDay("2026-10-30", "America/Guayaquil"));
console.log(`${fail ? "❌" : "✅"} ai usage: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
