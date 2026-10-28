// Tests for the Telegram bot's text rules (no database, no network).
// Run: npm run test:bot   (= node --no-warnings --import ./scripts/alias-loader.mjs scripts/test-bot.ts)
import { ruleParseStrict, ruleGuess, ruleTransfer } from "@/lib/parse";
import { commandArg, findDate, findRange, findTime, isNoise, norm, onlyAmount, onlyDate, toAmount } from "@/lib/bot/text";
import { parseBlockNoteCmd, parseEventCmd, parseFreeDayCmd, parseMetricCmd, parsePaymentCmd, parseSetBalanceCmd } from "@/lib/bot/intents";
import { parseHabitCommand } from "@/lib/bot-habits";
import { pullTags } from "@/lib/capture";
import { canMarkFromBot } from "@/lib/reminders";
import { archivedRow, dateRows, menuRows, movedRow, taskRow } from "@/lib/bot/tasks";
import { markedRow } from "@/lib/bot/habits";
import { replaceRows } from "@/lib/bot/tg";

// Wednesday, 28 Oct 2026
const T = "2026-10-28";
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
const tx = (s: string) => {
  const p = ruleParseStrict(s, T, ["Food", "Transport", "Home", "Health", "Fun", "Salary", "Mascotas"]);
  return p && p.kind === "transaction" ? [p.txnType, p.amount, p.description, p.category, p.date] : p;
};

// ---- Amounts (bug 1: thousands) ----
eq("1.500", toAmount("1.500"), 1500);
eq("1,500", toAmount("1,500"), 1500);
eq("1.234,56", toAmount("1.234,56"), 1234.56);
eq("1,234.56", toAmount("1,234.56"), 1234.56);
eq("12,5", toAmount("12,5"), 12.5);
eq("12.50", toAmount("12.50"), 12.5);
eq("1.000.000", toAmount("1.000.000"), 1000000);
eq("gasté 1.500 en arriendo", tx("gasté 1.500 en arriendo"), ["expense", 1500, "Arriendo", "Home", null]);
eq("spent 1,500 rent", tx("spent 1,500 rent"), ["expense", 1500, "Rent", "Home", null]);
eq("spent 12 on lunch", tx("spent 12 on lunch"), ["expense", 12, "Lunch", "Food", null]);
eq("gasté 5,50 en uber ayer", tx("gasté 5,50 en uber ayer"), ["expense", 5.5, "Uber", "Transport", "2026-10-27"]);
eq("$45 supermercado", tx("$45 supermercado"), ["expense", 45, "Supermercado", "Food", null]);
eq("$1.200 laptop", tx("$1.200 laptop"), ["expense", 1200, "Laptop", null, null]);
eq("-15 taxi", tx("-15 taxi"), ["expense", 15, "Taxi", "Transport", null]);
eq("+200 freelance", tx("+200 freelance"), ["income", 200, "Freelance", null, null]);
eq("received 1500 salary", tx("received 1500 salary"), ["income", 1500, "Salary", "Salary", null]);
eq("-30 mascotas", tx("-30 mascotas"), ["expense", 30, "Mascotas", "Mascotas", null]);
eq("45usd almuerzo", tx("45usd almuerzo"), ["expense", 45, "Almuerzo", "Food", null]);
eq("onlyAmount 15", onlyAmount("15"), 15);
eq("onlyAmount $15.50", onlyAmount("$15.50"), 15.5);
eq("onlyAmount text", onlyAmount("15 visa"), null);

// ---- Dates (bug 2: "la mañana") ----
eq("café de la mañana", tx("spent 3 café de la mañana"), ["expense", 3, "Café de la mañana", "Food", null]);
const task = (s: string) => {
  const p = ruleParseStrict(s, T) ?? ruleGuess(s, T);
  return p.kind === "task" ? [p.title, p.date] : p;
};
eq("t: correr en la mañana", task("t: correr en la mañana"), ["Correr en la mañana", null]);
eq("t: llamar mañana", task("t: llamar a mamá mañana"), ["Llamar a mamá", "2026-10-29"]);
eq("mañana por la mañana", task("t: gym mañana por la mañana"), ["Gym por la mañana", "2026-10-29"]);
eq("pasado mañana", task("t: banco pasado mañana"), ["Banco", "2026-10-30"]);
eq("el viernes (task)", task("t: pagar luz el viernes"), ["Pagar luz", "2026-10-30"]);
eq("el viernes (money)", tx("gasté 20 cena el viernes"), ["expense", 20, "Cena", "Food", "2026-10-23"]);
eq("5 nov", task("t: dentista 5 nov"), ["Dentista", "2026-11-05"]);
eq("5 de noviembre", task("tarea: cita 5 de noviembre"), ["Cita", "2026-11-05"]);
eq("12/11", task("t: x 12/11"), ["X", "2026-11-12"]);
eq("el 3 (next month)", task("t: renovar el 3"), ["Renovar", "2026-11-03"]);
eq("en 3 días", task("t: revisar en 3 días"), ["Revisar", "2026-10-31"]);
eq("next monday", task("t: call next monday"), ["Call", "2026-11-02"]);
eq("miércoles = today", task("t: x el miércoles"), ["X", "2026-10-28"]);
eq("próximo miércoles", task("t: x el próximo miércoles"), ["X", "2026-11-04"]);
eq("onlyDate viernes", onlyDate("viernes", T), "2026-10-30");
eq("onlyDate el 5", onlyDate("el 5", T), "2026-11-05");
eq("onlyDate text", onlyDate("call mom", T), null);
eq("findDate none", findDate("comprar pan", T), null);
eq("range del 2 al 5 de nov", findRange("del 2 al 5 de nov", T), { from: "2026-11-02", to: "2026-11-05", rest: "" });
eq("range 2-5 nov", findRange("2-5 nov viaje", T), { from: "2026-11-02", to: "2026-11-05", rest: "viaje" });
eq("range lunes a viernes (next week)", [findRange("de lunes a viernes", T)?.from, findRange("de lunes a viernes", T)?.to], ["2026-11-02", "2026-11-06"]);

// ---- Times ----
eq("15:00", findTime("dentista 15:00")?.start, "15:00");
eq("3pm", findTime("call 3pm")?.start, "15:00");
eq("3:30 pm", findTime("call 3:30 pm")?.start, "15:30");
eq("a las 3", findTime("a las 3")?.start, "15:00");
eq("a las 9", findTime("a las 9")?.start, "09:00");
eq("a las 8 de la noche", findTime("a las 8 de la noche")?.start, "20:00");
eq("10:00-11:30", findTime("reunión 10:00-11:30"), { start: "10:00", end: "11:30", rest: "reunión" });
eq("de 3 a 5 pm", findTime("de 3 a 5 pm"), { start: "15:00", end: "17:00", rest: "" });
eq("bare number is not a time", findTime("cena 15 personas"), null);
eq("15h", findTime("vuelo 15h")?.start, "15:00");

// ---- Prefixes (bug 9) ----
eq("t-shirt is not a task prefix", ruleParseStrict("t-shirt nueva", T), null);
eq("t: still works", task("t: algo"), ["Algo", null]);
eq("n: note", ruleParseStrict("n: idea\nmás texto", T), { kind: "note", title: "idea", content: "más texto" });
eq("task - works", task("task - llamar"), ["Llamar", null]);

// ---- Transfers ----
eq("transfer", ruleTransfer("transfer 50 from cash to Pichincha", T)?.parsed, { kind: "transfer", amount: 50, from: "cash", to: "Pichincha", date: null });
eq("transferí 1.500", ruleTransfer("transferí 1.500 de efectivo a visa", T)?.parsed.amount, 1500);

// ---- Noise (bug 7) ----
for (const n of ["ok", "gracias!", "Hola", "👍", "jajaja", "ok 👍", "si", "Thanks"]) eq(`noise: ${n}`, isNoise(n), true);
for (const n of ["comprar pan", "llamar a mamá", "gym", "pagar luz"]) eq(`not noise: ${n}`, isNoise(n), false);

// ---- Commands ----
eq("norm emoji", norm("📅 Today"), "today");
eq("norm bot", norm("/hoy@maxpersonalos_bot"), "/hoy");
eq("norm accents", norm("¿Qué tengo mañana?"), "que tengo manana");
eq("commandArg", commandArg("/buscar dentista", ["/buscar", "buscar"]), "dentista");
eq("commandArg two words", commandArg("qué tengo el jueves", ["que tengo"]), "el jueves");
eq("commandArg none", commandArg("comprar pan", ["/buscar"]), null);

// ---- Habit / done (bug 4) ----
eq("listo el informe", parseHabitCommand("listo el informe"), { kind: "mark", state: "done", query: "el informe" });
eq("skip stretch", parseHabitCommand("skip stretch"), { kind: "mark", state: "skipped", query: "stretch" });
eq("habit in block", parseHabitCommand("hábito: Leer en la cama en Noche"), { kind: "create", name: "Leer en la cama", block: "Noche" });

// ---- Intents ----
eq("event friday 3pm", parseEventCmd("evento: dentista viernes 3pm", T), { title: "Dentista", date: "2026-10-30", endDate: "2026-10-30", start: "15:00", end: "16:00" });
eq("event range", parseEventCmd("event: trip 2-5 nov", T), { title: "Trip", date: "2026-11-02", endDate: "2026-11-05", start: null, end: null });
eq("event today time range", parseEventCmd("cita: médico 10:00-11:30", T), { title: "Médico", date: T, endDate: T, start: "10:00", end: "11:30" });
eq("event overnight", parseEventCmd("ev: fiesta sábado 22:00-02:00", T), { title: "Fiesta", date: "2026-10-31", endDate: "2026-11-01", start: "22:00", end: "02:00" });
eq("event no title", parseEventCmd("evento: mañana 3pm", T), { error: "Give the event a name, e.g. “event: dentist friday 3pm”." });
const pay = parsePaymentCmd("pago: luz 25 cada mes el 5", T);
eq("payment monthly", pay && !("error" in pay) ? [pay.name, pay.amount, pay.unit, pay.every, pay.start, pay.type] : pay, ["Luz", 25, "months", 1, "2026-11-05", "expense"]);
const pay2 = parsePaymentCmd("payment: internet 32.50 monthly on the 10th with visa", T);
eq("payment english", pay2 && !("error" in pay2) ? [pay2.amount, pay2.unit, pay2.start] : pay2, [32.5, "months", "2026-11-10"]);
const pay3 = parsePaymentCmd("cobro: sueldo 1.500 cada 15 días", T);
eq("income every 15 days", pay3 && !("error" in pay3) ? [pay3.name, pay3.amount, pay3.unit, pay3.every, pay3.type] : pay3, ["Sueldo", 1500, "days", 15, "income"]);
const pay4 = parsePaymentCmd("pago: seguro 300 el 5 de cada mes", T);
eq("de cada mes", pay4 && !("error" in pay4) ? [pay4.name, pay4.unit, pay4.start] : pay4, ["Seguro", "months", "2026-11-05"]);
eq("free day tomorrow", parseFreeDayCmd("libre mañana", T), { from: "2026-10-29", to: "2026-10-29", note: null });
eq("free day range note", parseFreeDayCmd("día libre del 2 al 5 de nov viaje a Quito", T), { from: "2026-11-02", to: "2026-11-05", note: "viaje a Quito" });
eq("free day alone", parseFreeDayCmd("libre", T), { from: T, to: T, note: null });
eq("libre de gluten is not a free day", parseFreeDayCmd("libre de gluten comprar pan", T), null);
eq("nb", parseBlockNoteCmd("nb: [] repasar"), { block: null, body: "- [ ] repasar" });
eq("nb block", parseBlockNoteCmd("nb Deep work: idea"), { block: "Deep work", body: "idea" });
eq("set balance", parseSetBalanceCmd("saldo pichincha 1.234,50"), { account: "pichincha", amount: 1234.5 });
eq("set balance negative", parseSetBalanceCmd("balance visa -300"), { account: "visa", amount: -300 });
eq("balance alone is not set", parseSetBalanceCmd("saldo"), null);
eq("metric", parseMetricCmd("sueño 7,5", ["Sueño", "Agua"]), { name: "Sueño", value: 7.5, add: false });
eq("metric add", parseMetricCmd("agua +1", ["Sueño", "Agua"]), { name: "Agua", value: 1, add: true });
eq("metric unknown", parseMetricCmd("leer 20 páginas", ["Sueño"]), null);

// ---- Tags ----
eq("tags", pullTags("llamar a juan #trabajo #urgente"), { text: "llamar a juan", tags: ["trabajo", "urgente"] });
eq("C# is not a tag", pullTags("aprender C#").tags, []);

// ---- Habits after midnight (bug 6) ----
eq("yesterday overnight at 00:30", canMarkFromBot({ date: "2026-10-27", start_time: "23:00", end_time: "01:00" }, T, 30), true);
eq("yesterday evening at 02:00", canMarkFromBot({ date: "2026-10-27", start_time: "18:00", end_time: "19:00" }, T, 120), true);
eq("yesterday at 09:00", canMarkFromBot({ date: "2026-10-27", start_time: "18:00", end_time: "19:00" }, T, 540), false);
eq("two days ago", canMarkFromBot({ date: "2026-10-26", start_time: "18:00", end_time: "19:00" }, T, 30), false);

// ---- Buttons fit Telegram's 64 bytes ----
const U = "123e4567-e89b-42d3-a456-426614174000";
const all = [
  ...taskRow({ id: U, title: "x" }),
  ...menuRows({ id: U, title: "x" }).flat(),
  ...dateRows({ id: U, title: "x" }, T).flat(),
  ...movedRow({ id: U, title: "x" }, "Gym", T, U).flat(),
  ...archivedRow({ id: U, title: "x" }, T, U).flat(),
  ...markedRow(U, U, "x", "done").flat(),
];
eq("callback data ≤ 64 bytes", all.filter((b) => Buffer.byteLength(b.callback_data) > 64).map((b) => b.callback_data), []);
const kb = [taskRow({ id: U, title: "a" }), [{ text: "other", callback_data: "td:zzzz" }]];
eq("replaceRows swaps only that task", replaceRows(kb, taskRow({ id: U, title: "a" })[0].callback_data.slice(3), [[{ text: "ok", callback_data: "x" }]])?.length, 2);

console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
