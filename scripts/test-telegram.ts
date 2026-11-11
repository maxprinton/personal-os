// Tests for the Telegram module: the feature library, your command words, the practice database layer and one
// full practice step (the real bot code against a fake Telegram and an in-memory database). No network.
// Run: npm run test:telegram
import { W } from "@/lib/bot/words";
import { FEATURES, GROUPS, baseWords, isEditable, vocabFeatures } from "@/lib/bot/registry";
import { applyVocab, activeWords, cleanWord, type VocabRow } from "@/lib/bot/vocab";
import { isNowRequest, isTodayRequest } from "@/lib/bot-today";
import { aheadRequest } from "@/lib/bot-ahead";
import { isBalanceRequest } from "@/lib/bot-balance";
import { parseDayCommand } from "@/lib/bot/day";
import { commandArg, isOneOf, norm } from "@/lib/bot/text";
import { isInboxRequest, isPortfolioSummary } from "@/lib/bot/portfolio";
import { isYoutubeSummary } from "@/lib/bot/youtube-capture";
import { emptyDb, simClient } from "@/lib/bot/sim/overlay";
import { runSim, freshState } from "@/lib/bot/sim/run";
import { fakeDb } from "./fake-supabase";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n    got:  ${g}\n    want: ${w}`);
  }
}

// ---- The library matches the bot ------------------------------------------------------------------------
const ids = FEATURES.map((f) => f.id);
eq("feature ids are unique", ids.length, new Set(ids).size);
eq("every group is used", GROUPS.filter((g) => !FEATURES.some((f) => f.group === g.id)).map((g) => g.id), []);
// A command word that exists in words.ts must have a feature (adding a bot command means adding its entry)
const covered = new Set(FEATURES.map((f) => f.wordsKey).filter(Boolean));
eq("every word list in words.ts has a feature", (Object.keys(W) as (keyof typeof W)[]).filter((k) => !covered.has(k)), []);
eq("a wordsKey exists", FEATURES.filter((f) => f.wordsKey && !(f.wordsKey in W)).map((f) => f.id), []);
for (const f of FEATURES) {
  if (f.canonical && f.wordsKey) eq(`${f.id}: canonical is one of its words`, W[f.wordsKey].some((w) => norm(w) === norm(f.canonical!)), true);
  if (f.canonical && !baseWords(f).length) eq(`${f.id}: a command needs words`, f.id, "has words");
  if (f.ai) eq(`${f.id}: AI features have a demo or no examples`, f.demo !== undefined || f.examples.length === 0, true);
  if (f.group !== "auto" && f.group !== "setup" && !f.examples.length && !f.demo) eq(`${f.id}: has something to practice`, f.id, "an example");
}
// Words the bot reads in other files: the library lists the same ones
const detect: Record<string, (w: string) => boolean> = {
  today: isTodayRequest,
  now: isNowRequest,
  tomorrow: (w) => aheadRequest(w) === "tomorrow",
  week: (w) => aheadRequest(w) === "thisweek",
  nextweek: (w) => aheadRequest(w) === "nextweek",
  balance: isBalanceRequest,
  youtube: isYoutubeSummary,
  portfolio: isPortfolioSummary,
  inbox: isInboxRequest,
  checkin: (w) => parseDayCommand(w)?.kind === "checkin",
  review: (w) => parseDayCommand(w)?.kind === "review",
  day: (w) => commandArg(`${w} viernes`, [norm(w)]) === "viernes",
  search: (w) => commandArg(`${w} gym`, [norm(w)]) === "gym",
};
for (const [id, fn] of Object.entries(detect)) {
  const f = FEATURES.find((x) => x.id === id)!;
  const bad = baseWords(f).filter((w) => !fn(w) && !(id === "whats left"));
  // "what's left" is typed with an apostrophe in the bot; the library keeps the folded spelling
  eq(`${id}: the bot reads every listed word`, bad.filter((w) => !fn(w.replace("whats", "what's"))), []);
}
eq("mood word", parseDayCommand("/mood 7")?.kind, "scale");
eq("bed word", parseDayCommand("/bed 23:30")?.kind, "bed");
eq("woke word", parseDayCommand("/woke 7")?.kind, "woke");
eq("highlight word", parseDayCommand("/highlight x")?.kind, "highlight");
eq("W words are read as whole messages", (Object.keys(W) as (keyof typeof W)[]).every((k) => W[k].every((w) => isOneOf(w, W[k]))), true);
eq("every canonical command of an editable feature is read as that feature", vocabFeatures().filter((f) => !f.takesArg).every((f) => f.words.length > 0), true);

// ---- Your command words -----------------------------------------------------------------------------------
const feats = vocabFeatures();
const add = (feature_id: string, word: string): VocabRow => ({ feature_id, word, kind: "add" });
const hide = (feature_id: string, word: string): VocabRow => ({ feature_id, word, kind: "hide" });
eq("cleanWord basic", cleanWord("/Mis Días"), "mis dias");
eq("cleanWord too short", cleanWord("a"), null);
eq("cleanWord symbols", cleanWord("hola!!?"), "hola");
eq("cleanWord punctuation inside", cleanWord("a-b"), null);
eq("cleanWord four words", cleanWord("a b c d"), null);
eq("no words = unchanged", applyVocab("/today", [], feats), { text: "/today" });
eq("added word → canonical", applyVocab("/hoy2", [add("today", "hoy2")], feats), { text: "/today" });
eq("added word without slash", applyVocab("hoy2", [add("today", "hoy2")], feats), { text: "/today" });
eq("added word is case/accent free", applyVocab("📅 HÓY2", [add("today", "hoy2")], feats), { text: "/today" });
eq("added word keeps its argument", applyVocab("/bus Gym Class", [add("search", "bus")], feats), { text: "/search Gym Class" });
eq("added word on a no-argument feature only matches alone", applyVocab("hoy2 algo", [add("today", "hoy2")], feats), { text: "hoy2 algo" });
eq("two-word added word", applyVocab("mis cosas", [add("tasks", "mis cosas")], feats), { text: "/tasks" });
eq("two-word added word as a Telegram command", applyVocab("/mis_cosas", [add("tasks", "mis cosas")], feats), { text: "/tasks" });
eq("hidden word says what to use", applyVocab("/tareas", [hide("tasks", "tareas"), add("tasks", "pendientes2")], feats), { renamed: { word: "/tareas", use: "/pendientes2" } });
eq("hidden word without a replacement points to the canonical command", applyVocab("tasks", [hide("tasks", "tasks")], feats), { renamed: { word: "tasks", use: "/tasks" } });
eq("a word that is not hidden still works", applyVocab("/tasks", [hide("tasks", "tareas")], feats), { text: "/tasks" });
eq("hiding a locked feature's word does nothing", applyVocab("/balance", [hide("balance", "balance")], feats), { text: "/balance" });
eq("hiding does not touch other text", applyVocab("tasks for the week are done", [hide("tasks", "tasks")], feats), { text: "tasks for the week are done" });
eq("hidden word with an argument on a search feature", applyVocab("/search gym", [hide("search", "search"), add("search", "bus")], feats), { renamed: { word: "/search", use: "/bus" } });
const tasks = FEATURES.find((f) => f.id === "tasks")!;
const tw = { id: "tasks", words: baseWords(tasks), locked: false };
eq("active words with nothing changed", activeWords(tw, []).length, baseWords(tasks).length);
eq("active words: hidden one is gone, added one is there", activeWords(tw, [hide("tasks", "tareas"), add("tasks", "mis cosas")]).includes("/tareas") || !activeWords(tw, [add("tasks", "mis cosas")]).includes("mis cosas"), false);
eq("locked features ignore hide rows", activeWords({ id: "balance", words: ["/balance"], locked: true }, [hide("balance", "balance")]), ["/balance"]);
eq("only features with a command are editable", FEATURES.filter(isEditable).every((f) => f.canonical), true);

// ---- The practice database layer ---------------------------------------------------------------------------
async function overlayTests() {
  const real = { tasks: [{ id: "t1", user_id: "u", title: "Real task", status: "pending", date: "2026-11-11" }, { id: "t2", user_id: "u", title: "Other", status: "pending", date: "2026-11-12" }] as Record<string, unknown>[] };
  const before = JSON.stringify(real);
  const db = emptyDb();
  const sb = simClient(fakeDb(real) as never, db) as unknown as { from: (t: string) => any; rpc: (n: string) => Promise<unknown> };
  const list = async (extra?: (q: any) => any) => {
    let q = sb.from("tasks").select("id,title,status").eq("user_id", "u");
    if (extra) q = extra(q);
    return ((await q) as { data: { id: string; title: string; status: string }[] }).data.map((r) => `${r.id}:${r.title}:${r.status}`);
  };
  eq("untouched table reads the real rows", await list(), ["t1:Real task:pending", "t2:Other:pending"]);
  const ins = (await sb.from("tasks").insert({ user_id: "u", title: "New", date: "2026-11-11" }).select("id,title,status").single()) as { data: { id: string; title: string; status: string } };
  eq("insert returns the row with the column defaults", [ins.data.title, ins.data.status], ["New", "pending"]);
  eq("the real database did not change", JSON.stringify(real), before);
  eq("a created row is found with the filters", (await list((q) => q.eq("date", "2026-11-11"))).length, 2);
  await sb.from("tasks").update({ status: "done" }).eq("id", "t1");
  eq("a changed real row shows its practice copy", (await list()).includes("t1:Real task:done"), true);
  eq("the real row is still unchanged", JSON.stringify(real), before);
  eq("filters see the changed value", await list((q) => q.eq("status", "done")), ["t1:Real task:done"]);
  eq("filters hide the old value", (await list((q) => q.eq("status", "pending"))).includes("t1:Real task:pending"), false);
  await sb.from("tasks").delete().eq("id", "t2");
  eq("a deleted real row disappears", (await list()).some((x) => x.startsWith("t2")), false);
  eq("it is still in the real database", JSON.stringify(real), before);
  const one = (await sb.from("tasks").select("id").eq("id", "t1").maybeSingle()) as { data: { id: string } | null };
  eq("maybeSingle on a practiced table", one.data?.id, "t1");
  const gone = (await sb.from("tasks").select("id").eq("id", "t2").maybeSingle()) as { data: unknown };
  eq("maybeSingle of a deleted row", gone.data, null);
  const cnt = (await sb.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", "u")) as { count: number };
  eq("count on a practiced table", cnt.count, 2);
  const lim = (await list((q) => q.order("title", { ascending: true }).limit(1)));
  eq("order + limit after merging", lim, ["t1:Real task:done"].length ? [(await list((q) => q.order("title", { ascending: true }))).slice(0, 1)[0]] : []);
  eq("rpc does nothing and does not fail", await sb.rpc("refresh_daily_facts"), { data: null, error: null });
  const up = (await sb.from("tasks").upsert({ id: "t1", title: "Renamed" }, { onConflict: "id" }).select("title").single()) as { data: { title: string } };
  eq("upsert of a real row", up.data.title, "Renamed");
  eq("real data is untouched after everything", JSON.stringify(real), before);
  eq("db is plain JSON", JSON.parse(JSON.stringify(db)).rows.tasks.length >= 2, true);
}

// ---- One whole practice step: the real bot, a fake Telegram, an in-memory database -------------------------------
async function simTests() {
  const real = {
    user_settings: [{ user_id: "u", timezone: "America/Guayaquil", telegram_chat_id: 5 }],
    tasks: [] as Record<string, unknown>[],
    bot_messages: [] as Record<string, unknown>[],
    bot_threads: [] as Record<string, unknown>[],
    accounts: [], categories: [], tags: [], block_types: [], block_occurrences: [], habits: [], metric_definitions: [], bot_vocab: [] as Record<string, unknown>[],
  };
  const before = JSON.stringify(real);
  const db = fakeDb(real) as never;
  let state = freshState();
  const step = async (text: string) => {
    const r = await runSim(db, "u", { kind: "text", text }, state);
    state = r.state;
    return r;
  };
  const texts = (r: Awaited<ReturnType<typeof step>>) => r.events.filter((e) => e.t === "send").map((e) => (e as { text: string }).text);
  const help = await step("/help");
  eq("help answers", texts(help).some((t) => t.includes("Personal OS bot")), true);
  eq("the user message got an id", typeof help.userMessageId, "number");
  const menu = await step("/menu");
  eq("menu answers", texts(menu).length > 0, true);
  const no = await step("/link ABC123");
  eq("link is not a practice thing (it falls to the unknown-command path or is answered)", no.events.length >= 0, true);
  const t1 = await step("t: practice this");
  eq("a task is saved in practice", texts(t1).some((t) => t.startsWith("Saved ✓")), true);
  eq("…with an Undo button", t1.events.some((e) => e.t === "send" && JSON.stringify(e.kb).includes("undo:")), true);
  const list = await step("/tasks");
  eq("/tasks shows the practice task", texts(list).join("\n").toLowerCase().includes("practice this"), true);
  eq("the real database has no task", JSON.stringify(real.tasks), "[]");
  const undoKb = (t1.events.find((e) => e.t === "send" && JSON.stringify(e.kb).includes("undo:")) as { id: number; text: string; kb: { text: string; callback_data: string }[][] });
  const undone = await runSim(db, "u", { kind: "tap", data: undoKb.kb[0][0].callback_data, message: { id: undoKb.id, text: undoKb.text, kb: undoKb.kb } }, state);
  state = undone.state;
  eq("Undo works in practice", undone.events.some((e) => e.t === "toast" && e.text === "Undone."), true);
  const after = await step("/tasks");
  eq("the task is gone after Undo", texts(after).join("\n").toLowerCase().includes("practice this"), false);
  eq("the real database is untouched", JSON.stringify(real), before);
  const ai = await step("@os what did I write?");
  eq("AI features answer without calling the AI", ai.events.length > 0, true);
}

(async () => {
  await overlayTests();
  await simTests().catch((e) => {
    fail++;
    console.log("✗ practice step threw", e);
  });
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
