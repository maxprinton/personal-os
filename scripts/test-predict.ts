// Next-word prediction learned from your own text.
import { buildModel, emptyModel, learnInto, ngramRows, ngramsOf, predict } from "@/lib/writing/predict";
import { mistakesLine } from "@/lib/writing/insight";
import { mondayOf, spellOn, predictOn, aiOn, cleanPatch } from "@/lib/writing/settings";
import { fixesToIssues, parseFixes } from "@/lib/ai-writing";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));

const m = emptyModel();
learnInto(m, ngramsOf("Mañana voy al gimnasio. Hoy voy al gimnasio con Ana. Luego voy al cine. Gimnasio y gimnasia. The meeting is tomorrow. The meeting was long."));
const p = (t: string) => predict(m, t);
ok("next word after two words", p("Luego voy al ")?.word === "gimnasio", JSON.stringify(p("Luego voy al ")));
ok("completes a word", p("Mañana voy al gimn")?.insert === "asio", JSON.stringify(p("Mañana voy al gimn")));
ok("keeps the capital", p("Gimn")?.word === "Gimnasio", JSON.stringify(p("Gimn")));
ok("English", p("The ")?.word === undefined || p("The ")?.word === "meeting", JSON.stringify(p("The ")));
ok("English after a word", p("So the ")?.word === "meeting", JSON.stringify(p("So the ")));
ok("nothing at sentence start", p("") === null && p("Hola. ") === null);
ok("one letter is too little", p("Voy al g") === null);
ok("nothing after a number", p("Son 3") === null);
ok("nothing right after a comma", p("voy al,") === null);
ok("a pair seen once is not offered", p("con ") === null, JSON.stringify(p("con ")));
ok("unknown context", p("zzz ") === null);
const counts = ngramsOf("Voy al gimnasio");
ok("counts", counts.size === 6, String(counts.size));
const rows = ngramRows(counts);
ok("rows", rows.some((r) => r.c === "voy al" && r.w === "gimnasio") && rows.some((r) => r.c === "" && r.w === "voy"));
const m2 = buildModel(rows.map((r) => [r.c, r.w, r.n * 2] as [string, string, number]));
ok("model from rows", predict(m2, "Voy al ")?.word === "gimnasio" && predict(m2, "Voy al gim")?.insert === "nasio", JSON.stringify(predict(m2, "Voy al gim")));
// ---- Settings, insight, AI fixes
ok("monday", mondayOf("2026-10-30") === "2026-10-26" && mondayOf("2026-10-26") === "2026-10-26" && mondayOf("2026-11-01") === "2026-10-26");
ok("areas on by default", spellOn({}, "finance") && predictOn({}, "tasks") && aiOn({}, "notes"));
ok("area off", !spellOn({ areas: { finance: false } }, "finance") && !aiOn({ spell: false }, "notes") && !predictOn({ predict: false }, "notes"));
ok("clean patch", JSON.stringify(cleanPatch({ spell: false, aiCount: 99, areas: { tasks: false, nope: true } })) === JSON.stringify({ spell: false, areas: { tasks: false } }));
ok("mistakes line", mistakesLine([{ wrong: "gimansio", fixed: "gimnasio", n: 3 }, { wrong: "gimansio", fixed: "gimnasio", n: 1 }, { wrong: "teh", fixed: "the", n: 1 }]) === "✍️ Writing: your most repeated mistakes last week were “gimansio” → “gimnasio” ×4, “teh” → “the”.");
ok("no mistakes", mistakesLine([]) === null);
const para = "I am agree with you and I want to make a meeting.";
const fixes = parseFixes({ fixes: [{ find: "am agree", replace: "agree", why: "“Agree” is a verb." }, { find: "not there", replace: "x", why: "" }, { find: "make a meeting", replace: "have a meeting", why: "Natural phrase" }, { find: "x", replace: "x" }] }, para);
ok("fixes that exist", fixes.length === 2, JSON.stringify(fixes));
const issues = fixesToIssues(fixes, para);
ok("fix offsets", para.slice(issues[0].from, issues[0].to) === "am agree" && issues[1].suggestions[0] === "have a meeting" && issues[0].kind === "ai");
ok("bad json", parseFixes(null, para).length === 0 && parseFixes({ fixes: "no" }, para).length === 0);

console.log(`${fail ? "❌" : "✅"} predict: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
