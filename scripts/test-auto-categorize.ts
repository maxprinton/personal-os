// Auto-categorize: merchant keys, learning from the user's habits, grouping, reading the AI's answer,
// proposals for new categories, and a whole round against an in-memory database.
import {
  buildHistory, buildPrompt, cleanProposalName, decide, groupTransactions, historyPick, merchantKeys, parseAnswer, proposalKey,
  type Cat, type HistoryRow, type Tx,
} from "@/lib/auto-categorize-core";
import { runRound, type Ask, type Db, type ProposalRow } from "@/lib/auto-categorize";
import type { Kind } from "@/lib/auto-categorize-core";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));

const cats: Cat[] = [
  { id: "food", name: "Food", kind: "expense" },
  { id: "transport", name: "Transport", kind: "expense" },
  { id: "health", name: "Health", kind: "expense" },
  { id: "other", name: "Other", kind: "expense" },
  { id: "salary", name: "Salary", kind: "income" },
  { id: "fun", name: "Fun", kind: "expense" },
];

// ---- merchant keys
ok("keys: bank noise and numbers removed", merchantKeys("COMPRA POS SUPERMAXI QUITO 0012345 15/10").join("|") === "supermaxi", merchantKeys("COMPRA POS SUPERMAXI QUITO 0012345 15/10").join("|"));
ok("keys: most specific first, then shorter", merchantKeys("Uber Eats Quito 4455").join("|") === "uber eats|uber", merchantKeys("Uber Eats Quito 4455").join("|"));
ok("keys: accents folded", merchantKeys("Café Juan Valdéz")[0] === "cafe juan valdez");
ok("keys: nothing left → empty", merchantKeys("POS 123 / 456").length === 0 && merchantKeys(null).length === 0);

// ---- history
const hist = (rows: [Kind, string, string, boolean?][]): HistoryRow[] => rows.map(([type, description, category_id, manual]) => ({ type, description, category_id, manual: manual ?? true }));
const h = buildHistory(
  hist([
    ["expense", "Uber Eats Quito", "food"], ["expense", "UBER EATS", "food"], ["expense", "Uber trip", "transport"], ["expense", "Uber trip 22", "transport"],
    ["expense", "Netflix", "fun"], ["expense", "Pharmacy Fybeca", "health", false], // AI guess: never teaches
  ]),
  cats,
);
ok("history: 'uber eats' (2 words) → Food", historyPick(h, "expense", "Compra Uber Eats 123") === "food");
ok("history: 'uber trip' → Transport", historyPick(h, "expense", "UBER TRIP 998") === "transport");
ok("history: bare 'uber' is ambiguous (food vs transport) → no habit", historyPick(h, "expense", "Uber") === null);
ok("history: one example is not enough for a one-word merchant", historyPick(h, "expense", "Netflix") === null);
ok("history: AI guesses don't count as habits", historyPick(h, "expense", "Fybeca Pharmacy") === null);
ok("history: kind must match", historyPick(h, "income", "Uber trip") === null);

// ---- grouping
const txs: Tx[] = [
  { id: "1", type: "expense", amount: 4, description: "TIA QUITO 001" },
  { id: "2", type: "expense", amount: 9.5, description: "TIA QUITO 002" },
  { id: "3", type: "expense", amount: 30, description: "Gasolinera Primax" },
  { id: "4", type: "expense", amount: 5, description: "" },
  { id: "5", type: "income", amount: 700, description: "Nomina Empresa SA" },
];
const g = groupTransactions(txs);
ok("group: same merchant once", g.groups.length === 3 && g.groups[0].ids.length === 2 && g.groups[0].min === 4 && g.groups[0].max === 9.5);
ok("group: no text → blank", g.blank.length === 1 && g.blank[0].id === "4");
ok("group: numbered from 1 in order", g.groups.map((x) => x.n).join() === "1,2,3");
const prompt = buildPrompt(cats, g.groups, ["uber eats (expense) → Food"], ["Pets (expense)"], ["expense subscriptions"]);
ok("prompt: lists categories, examples, pending, declined", /EXPENSE categories: Food/.test(prompt) && /INCOME categories: Salary/.test(prompt) && /uber eats/.test(prompt) && /PENDING PROPOSALS.*Pets/.test(prompt) && /DECLINED.*subscriptions/.test(prompt));
ok("prompt: transactions numbered with count and range", /1\. expense \| "TIA QUITO 001" \| 2× \| \$4\.00–\$9\.50/.test(prompt));

// ---- reading the answer
const a1 = parseAnswer('{"results":[{"n":1,"category":"Food","confidence":"high"},{"n":2,"category":null,"new_category":"Pets","confidence":"medium"},{"n":3,"category":null,"confidence":"low"}]}');
ok("answer: three entries", a1.size === 3 && a1.get(1)?.category === "Food" && a1.get(2)?.newCategory === "Pets" && a1.get(3)?.confidence === "low");
const a2 = parseAnswer('Here you go:\n```json\n[{"i":1,"category":"Food","sure":"High"}]\n```');
ok("answer: array in a code fence, alternative keys", a2.get(1)?.category === "Food" && a2.get(1)?.confidence === "high");
ok("answer: garbage → empty, no crash", parseAnswer("sorry, I can't").size === 0 && parseAnswer('{"results":"nope"}').size === 0 && parseAnswer("{broken").size === 0);
ok("answer: 'null' / 'uncategorized' text is no category", parseAnswer('{"results":[{"n":1,"category":"null"},{"n":2,"category":"Uncategorized"}]}').get(2)?.category === null);

// ---- deciding
const G = (category: string | null, confidence: "high" | "medium" | "low", newCategory: string | null = null) => ({ category, newCategory, confidence });
ok("decide: high → category", decide(G("Food", "high"), "expense", cats).kind === "category");
ok("decide: medium (educated guess) → category", decide(G("health", "medium"), "expense", cats).kind === "category");
ok("decide: low → none", decide(G("Food", "low"), "expense", cats).kind === "none");
ok("decide: wrong kind (income category for an expense) → not applied", decide(G("Salary", "high"), "expense", cats).kind !== "category");
ok("decide: catch-all with medium confidence is a shrug", decide(G("Other", "medium"), "expense", cats).kind === "none" && decide(G("Other", "high"), "expense", cats).kind === "category");
ok("decide: unknown name + new_category → proposal", JSON.stringify(decide(G(null, "high", "pets"), "expense", cats)) === '{"kind":"proposal","name":"Pets"}');
ok("decide: model puts the new name in 'category' → still a proposal", decide(G("Subscriptions", "medium"), "expense", cats).kind === "proposal");
ok("decide: proposing an existing category's name uses it", (decide(G(null, "high", "food"), "expense", cats) as { cat?: Cat }).cat?.id === "food");
ok("decide: declined names are never proposed again", decide(G(null, "high", "Pets"), "expense", cats, new Set([proposalKey("expense", "pets")])).kind === "none");
ok("decide: low confidence never proposes", decide(G(null, "low", "Pets"), "expense", cats).kind === "none");
ok("decide: catch-all names aren't proposed", decide(G(null, "high", "Misc"), "expense", cats).kind === "none");
ok("name: cleaned", cleanProposalName(' "dog food" (expense) ') === "Dog Food" && cleanProposalName("PETS") === "Pets" && cleanProposalName("x") === null && cleanProposalName("Car 2024") === null && cleanProposalName("a b c d") === null);

// ---- a whole round, in-memory database
function fakeDb(init: { txs: Tx[]; history?: HistoryRow[]; pending?: ProposalRow[] | null; declined?: string[]; categories?: Cat[] }) {
  const state = { cats: [...(init.categories ?? cats)], txs: init.txs.map((t) => ({ ...t })), applied: new Map<string, { cat: string; by: string }>(), proposals: [...(init.pending ?? [])] as ProposalRow[] };
  const db: Db = {
    categories: async () => state.cats,
    uncategorized: async () => state.txs.filter((t) => !state.applied.has(t.id)),
    history: async () => ({ rows: init.history ?? [], markers: true }),
    pendingProposals: async () => (init.pending === null ? null : state.proposals),
    declined: async () => init.declined ?? [],
    saveProposal: async (kind, name, ids) => {
      const f = state.proposals.find((p) => p.kind === kind && proposalKey(kind, p.name) === proposalKey(kind, name));
      if (f) f.tx_ids = [...new Set([...f.tx_ids, ...ids])];
      else state.proposals.push({ id: `p${state.proposals.length + 1}`, name, kind, tx_ids: ids });
      return true;
    },
    apply: async (categoryId, ids, by) => {
      const done = ids.filter((id) => !state.applied.has(id));
      done.forEach((id) => state.applied.set(id, { cat: categoryId, by }));
      return done;
    },
  };
  return { db, state };
}
const sent: string[] = [];
const ask = (answer: unknown): Ask => async (_s, p) => (sent.push(p), typeof answer === "string" ? { text: answer } : { text: JSON.stringify(answer) });

const rows: Tx[] = [
  { id: "a1", type: "expense", amount: 12, description: "SUPERMAXI QUITO 77" },   // habit → Food (free)
  { id: "a2", type: "expense", amount: 8, description: "SUPERMAXI QUITO 91" },
  { id: "a3", type: "expense", amount: 30, description: "GASOLINERA PRIMAX" },    // AI → Transport
  { id: "a4", type: "expense", amount: 45, description: "VETERINARIA PATITAS" },  // AI → new category Pets
  { id: "a5", type: "expense", amount: 60, description: "VETERINARIA PATITAS 2" },// AI → same new category
  { id: "a6", type: "expense", amount: 25, description: "TRANSF A JUAN PEREZ" },  // AI: low → left for the user
  { id: "a7", type: "expense", amount: 3, description: null },                    // no text → left
  { id: "a8", type: "expense", amount: 9, description: "Balance adjustment" },    // never touched
];
const habit = hist([["expense", "Supermaxi Quito", "food"], ["expense", "supermaxi quito", "food"]]);
// Groups are numbered biggest first: 1 = the vet (2 transactions), 2 = the gas station ($30), 3 = Juan Perez ($25)
const answers = { results: [
  { n: 1, category: null, new_category: "Pets", confidence: "high" },
  { n: 2, category: "Transport", confidence: "high" },
  { n: 3, category: null, confidence: "low" },
] };
{
  const { db, state } = fakeDb({ txs: rows, history: habit });
  const r = await runRound(db, { ask: ask(answers) });
  ok("round: habit applied without the AI", state.applied.get("a1")?.cat === "food" && state.applied.get("a1")?.by === "history" && state.applied.get("a2")?.by === "history" && r.byHistory === 2);
  ok("round: the AI never saw the habit merchants", !/SUPERMAXI/.test(sent[0] ?? ""), sent[0]);
  ok("round: AI category applied and marked ai", state.applied.get("a3")?.cat === "transport" && state.applied.get("a3")?.by === "ai" && r.byAi === 1);
  ok("round: new category only PROPOSED, transactions untouched", !state.applied.has("a4") && !state.applied.has("a5") && state.proposals.length === 1 && state.proposals[0].name === "Pets" && state.proposals[0].tx_ids.length === 2);
  ok("round: proposal reported", r.proposed.length === 1 && r.proposed[0].name === "Pets" && r.proposed[0].count === 2);
  ok("round: unclear + no text left uncategorized (and reported)", r.unsure.includes("a6") && r.unsure.includes("a7") && !state.applied.has("a6") && !state.applied.has("a7"));
  ok("round: adjustments never touched", !state.applied.has("a8") && !r.unsure.includes("a8"));
  ok("round: counts", r.categorized === 3 && r.left === 0 && r.applied.length === 3);
  // second round: the proposal is waiting → its transactions are not asked again; skip holds the unclear ones
  const before = sent.length;
  const r2 = await runRound(db, { skip: r.unsure, ask: ask(answers) });
  ok("round 2: nothing left to ask (pending + skipped are excluded)", sent.length === before && r2.checked === 0 && r2.left === 0);
}
{
  const { db } = fakeDb({ txs: rows, history: habit, declined: [proposalKey("expense", "Pets")] });
  const r = await runRound(db, { ask: ask(answers) });
  ok("declined proposal: not proposed again, stays for the user", r.proposed.length === 0 && r.unsure.includes("a4") && r.unsure.includes("a5"));
  ok("declined proposal: the AI is told", /DECLINED.*pets/i.test(sent[sent.length - 1]));
}
{
  const { db } = fakeDb({ txs: rows, history: habit, pending: null });
  const r = await runRound(db, { ask: ask(answers) });
  ok("no proposals table yet: nothing breaks, flagged, ids stay unclear", r.proposalsOff === true && r.proposed.length === 0 && r.unsure.includes("a4"));
}
{
  const { db, state } = fakeDb({ txs: rows, history: habit });
  const r = await runRound(db, { ask: async () => ({ error: "The free AI limit is used up for now." }) });
  ok("AI error: habit part kept, error reported, the rest still queued", r.error?.includes("limit") === true && state.applied.size === 2 && r.left >= 3 && r.unsure.length === 1 /* only the no-text one */, JSON.stringify({ left: r.left, unsure: r.unsure }));
}
{
  const { db, state } = fakeDb({ txs: rows, history: habit });
  const r = await runRound(db, { ask: null });
  ok("AI off: only habits used, flagged", r.aiOff === true && state.applied.size === 2 && r.left === 0);
}
{
  const many: Tx[] = Array.from({ length: 45 }, (_, i) => ({ id: `m${i}`, type: "expense" as const, amount: 5, description: `Shop${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} store` }));
  const { db } = fakeDb({ txs: many });
  const all = { results: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, category: "Food", confidence: "medium" })) };
  const r = await runRound(db, { ask: ask(all), maxGroups: 30 });
  ok("big backlog: one round handles 30 merchants, reports how many are left", r.byAi === 30 && r.left === 15, `${r.byAi}/${r.left}`);
}
{
  const { db, state } = fakeDb({ txs: [{ id: "z1", type: "expense", amount: 5, description: "Zoo tickets" }], categories: [] });
  const r = await runRound(db, { ask: ask({ results: [{ n: 1, category: null, new_category: "Fun", confidence: "high" }] }) });
  ok("no categories at all: the AI can still propose the first ones", r.proposed.length === 1 && state.proposals[0].name === "Fun");
}
{
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, type: "expense" as const, amount: 5, description: `Thing${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)} shop` }));
  const { db, state } = fakeDb({ txs: many });
  const r = await runRound(db, { ask: ask({ results: many.map((_, i) => ({ n: i + 1, category: null, new_category: `Cat${String.fromCharCode(97 + i)}x`, confidence: "high" })) }) });
  ok("at most 5 new categories per round", state.proposals.length === 5 && r.proposed.length === 5 && r.unsure.length === 3);
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `✅ auto-categorize: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
