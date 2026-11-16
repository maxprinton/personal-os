// BL-22: @os on the web. Depth levels, what extra data a question needs, the daily AI limit, saved turns, Backlog text.
// Pure helpers only: the AI is never called. Run: npm run test:ask-web
import { DEPTHS, aiLimitMessage, backlogContext, conversationTitle, isDepth, turnsFromMessages, wantsBacklog, wantsFinance } from "@/lib/ask/web";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ——— depth ———
ok("three levels, Normal equals Telegram (4 notes, 11,000 characters)", DEPTHS.normal.maxNotes === 4 && DEPTHS.normal.readLimit === 11_000);
ok("Quick reads less, Deep reads more", DEPTHS.quick.maxNotes < DEPTHS.normal.maxNotes && DEPTHS.deep.maxNotes >= 8 && DEPTHS.deep.readLimit > DEPTHS.normal.readLimit);
ok("depth guard", isDepth("deep") && isDepth("quick") && !isDepth("huge") && !isDepth(undefined));

// ——— what the question needs ———
ok("money questions add finance (English)", wantsFinance("how much did I spend on food?") && wantsFinance("what is my balance in Pichincha account"));
ok("money questions add finance (Spanish)", wantsFinance("¿cuánto gasté este mes?") && wantsFinance("cuál es mi saldo"));
ok("other questions do not add finance", !wantsFinance("what did I write about the trip?") && !wantsFinance("resume mi nota de Coursera"));
ok("backlog questions add the Backlog", wantsBacklog("what is in Now?") && wantsBacklog("status of BL-22") && wantsBacklog("¿qué sigue en el backlog?") && wantsBacklog("any bugs pending"));
ok("other questions do not add the Backlog", !wantsBacklog("what did my teacher say about stakeholders?") && !wantsBacklog("receta de arepas"));

// ——— the daily AI limit ———
const L = { requests: 1000, tokens: 200_000 };
const day = "2026-11-16";
ok("room left: no message", aiLimitMessage([{ day, calls: 10, tokens: 5000 }], [], day, L) === null);
ok("no usage at all: no message", aiLimitMessage([], [], day, L) === null);
ok("requests used up: stops", /limit for today is reached/.test(aiLimitMessage([{ day, calls: 1000, tokens: 10 }], [], day, L) ?? ""));
ok("tokens used up (several rows added together): stops", aiLimitMessage([{ day, calls: 5, tokens: 150_000 }, { day, calls: 5, tokens: 60_000 }], [], day, L) !== null);
ok("yesterday's usage does not count", aiLimitMessage([{ day: "2026-11-15", calls: 5000, tokens: 900_000 }], [], day, L) === null);
ok("the provider says 0 requests left: stops", aiLimitMessage([], [{ remaining_requests: 0, remaining_tokens: 5000 }], day, L) !== null);
ok("almost no tokens left: stops with a softer message", /almost no room/.test(aiLimitMessage([], [{ remaining_requests: 50, remaining_tokens: 300 }], day, L) ?? ""));
ok("unknown remaining values are ignored", aiLimitMessage([], [{ remaining_requests: null, remaining_tokens: null }], day, L) === null);
ok("the message says nothing was sent", /Nothing was sent/.test(aiLimitMessage([{ day, calls: 1000, tokens: 0 }], [], day, L) ?? ""));

// ——— saved conversation → turns ———
{
  const msgs = [
    { role: "user" as const, content: "q1" },
    { role: "assistant" as const, content: "a1", sources: [{ id: "n1", title: "Trip" }] },
    { role: "user" as const, content: "q2" },
    { role: "assistant" as const, content: "a2", sources: [] },
    { role: "user" as const, content: "q3" },
    { role: "assistant" as const, content: "a3", sources: null },
    { role: "user" as const, content: "q4" },
    { role: "assistant" as const, content: "a4", sources: [{ id: "n2", title: "X" }, { id: "n3", title: "Y" }] },
  ];
  const t = turnsFromMessages(msgs);
  ok("only the last 3 turns go with a new question", t.length === 3 && t[0].q === "q2" && t[2].q === "q4");
  ok("each turn carries the notes it used", t[2].ids.join() === "n2,n3" && t[0].ids.length === 0 && t[1].ids.length === 0);
  ok("a question without an answer is skipped", turnsFromMessages([{ role: "user", content: "alone" }]).length === 0);
  ok("two questions in a row: only the answered one", turnsFromMessages([{ role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "B" }]).map((x) => x.q).join() === "b");
  ok("empty conversation", turnsFromMessages([]).length === 0);
}

// ——— titles ———
ok("short question is the title", conversationTitle("  what is  in Now? ") === "what is in Now?");
ok("long question is cut", conversationTitle("x".repeat(200)).length === 58 && conversationTitle("x".repeat(200)).endsWith("…"));
ok("empty question still gets a title", conversationTitle("   ") === "Conversation");

// ——— Backlog text for the AI ———
{
  const items = [
    { number: 22, title: "Ask your notes", status: "now", size: "M", type: "feature" },
    { number: 2, title: "Security cleanup", status: "next", size: "S", type: "improvement" },
    { number: 102, title: "Backlog on mobile", status: "inbox", size: null, type: "bug" },
    { number: 9, title: "Old idea", status: "parked", size: null, type: "feature" },
    { number: 10, title: "Shipped", status: "done", size: "S", type: "feature" },
  ];
  const text = backlogContext(items);
  ok("lists Now, Verifying, Next and Inbox with counts", /NOW \(1\):\n- BL-22 \[feature, M\] Ask your notes/.test(text) && /VERIFYING \(0\):/.test(text) && /NEXT \(1\):/.test(text) && /INBOX \(1\):\n- BL-102 \[bug\]/.test(text), text);
  ok("the rest is only counted", /Also: later 0, parked 1, done 1\./.test(text) && !/Old idea/.test(text));
  const many = backlogContext(Array.from({ length: 20 }, (_, i) => ({ number: i + 1, title: `Idea ${i + 1}`, status: "inbox", size: null, type: "feature" })));
  ok("a long list is cut and says how many more", /…and 5 more/.test(many) && !/Idea 16/.test(many));
}

console.log(`\nask web: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
