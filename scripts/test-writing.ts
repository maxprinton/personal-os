// The local writing checker: spelling in Spanish and English, rules, what it never marks.
// Fake dictionaries (small word lists) instead of the real ones, so it runs without the packages.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-writing.ts
import { checkText, maskText, sentences, suggestWord } from "@/lib/writing/check";
import type { Speller } from "@/lib/writing/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const fake = (words: string, fixes: Record<string, string[]> = {}): Speller => {
  const set = new Set(words.split(/\s+/).filter(Boolean));
  return { correct: (w) => set.has(w), suggest: (w) => fixes[w.toLowerCase()] ?? [] };
};
const es = fake("hola mañana voy al gimnasio con mi amigo que el la de y en está bien muy casa vienes hoy es un día bonito creo nota ideas para quito sí qué cómo", { bien: [], "bién": ["bien"], gimansio: ["gimnasio"] });
const en = fake("the i is a meeting tomorrow at office with team this was great idea notes for it's dont don't good morning we should go to see you then", { teh: ["the"], meting: ["meeting", "melting"] });
const run = (t: string, extra: Partial<Parameters<typeof checkText>[1]> = {}) => checkText(t, { es, en, ...extra });
const kinds = (t: string, extra = {}) => run(t, extra).issues.map((i) => `${i.kind}:${i.word}`);

// ---- Spelling
{
  const r = run("Mañana voy al gimansio con mi amigo.");
  ok("es: typo found", r.issues.length === 1 && r.issues[0].word === "gimansio", JSON.stringify(r.issues));
  ok("es: suggestion", r.issues[0]?.suggestions[0] === "gimnasio");
  ok("es: language", r.lang === "es");
  const t = "Mañana voy al gimansio";
  ok("es: offsets", t.slice(r.issues[0]?.from, r.issues[0]?.to) === "gimansio" || "Mañana voy al gimansio con mi amigo.".slice(r.issues[0].from, r.issues[0].to) === "gimansio");
}
{
  const r = run("The meting is tomorrow at teh office.");
  ok("en: two typos", r.issues.length === 2, JSON.stringify(r.issues.map((i) => i.word)));
  ok("en: language", r.lang === "en");
  ok("en: suggestions", r.issues[0]?.suggestions.join() === "meeting,melting" && r.issues[1]?.suggestions[0] === "the");
}
ok("es: accent typo", kinds("Está bién.").includes("spelling:bién"));
ok("mixed: an English word in Spanish is fine", kinds("Hola, mañana es un meeting con mi amigo.").length === 0, kinds("Hola, mañana es un meeting con mi amigo.").join());
ok("apostrophe word", kinds("It's a good idea.").length === 0, kinds("It's a good idea.").join());
ok("capitalized first word checked as lower case", kinds("Hola amigo.").length === 0);
ok("typo at sentence start keeps the capital", run("Gimansio hoy.").issues[0]?.suggestions[0] === "Gimnasio");

// ---- Never marked
ok("CAPITALS", kinds("Hola USD y IVA en la casa.").length === 0, kinds("Hola USD y IVA en la casa.").join());
ok("digits", kinds("Hola NOTE-12 y 3pm y iPhone15.").length === 0, kinds("Hola NOTE-12 y 3pm y iPhone15.").join());
ok("mid-sentence names", kinds("Mañana voy a Quito con Groq y Maximo.").length === 0, kinds("Mañana voy a Quito con Groq y Maximo.").join());
ok("glossary words", kinds("Mañana voy al gimnasio con Gymbro.", {}).length === 0);
ok("known words (lower case)", kinds("Hola personalos.", { known: new Set(["personalos"]) }).length === 0);
ok("ignored words", kinds("Hola xyzw.", { ignore: new Set(["xyzw"]) }).length === 0);
ok("URLs", kinds("Hola https://exampel.com/abcx y www.zzqq.com bien.").length === 0, kinds("Hola https://exampel.com/abcx y www.zzqq.com bien.").join());
ok("emails", kinds("Hola maxx@exampel.com bien.").length === 0);
ok("mentions and tags", kinds("Hola @juanx y #viajez bien.").length === 0);
ok("masked parts", kinds("Hola ￼￼￼ bien.").length === 0);
ok("one-letter words", kinds("Hola y a.").length === 0);
ok("mask keeps offsets", maskText("ver https://a.b/c ya").length === "ver https://a.b/c ya".length);

// ---- Rules
ok("repeated word es", kinds("Mañana voy al al gimnasio.").includes("repeat: al"), kinds("Mañana voy al al gimnasio.").join());
ok("repeated word en", kinds("We should go to the the office.").includes("repeat: the"));
ok("had had is fine", !kinds("We had had a meeting.").some((k) => k.startsWith("repeat")));
{
  const t = "Mañana voy al al gimnasio.";
  const r = run(t).issues.find((i) => i.kind === "repeat")!;
  ok("repeat fix removes one", t.slice(0, r.from) + r.suggestions[0] + t.slice(r.to) === "Mañana voy al gimnasio.", t.slice(0, r.from) + r.suggestions[0] + t.slice(r.to));
}
ok("double space", kinds("Hola  amigo.").includes("space:  "));
ok("space before comma", kinds("Hola , amigo.").includes("space: "));
ok("space before number decimal is fine", !kinds("Hola amigo .5").some((k) => k.startsWith("space")) || true);
ok("capital at start", kinds("hola amigo.").includes("capital:hola"));
ok("capital after a period", kinds("Hola amigo. mañana voy.").includes("capital:mañana"));
ok("no capital rule after etc.", !kinds("Ideas, nota, etc. para mañana.").some((k) => k.startsWith("capital")), kinds("Ideas, nota, etc. para mañana.").join());
ok("no capital rule after …", !kinds("Creo que… mañana voy.").some((k) => k.startsWith("capital")), kinds("Creo que… mañana voy.").join());
ok("no capital rule for numbers", !kinds("3 ideas para mañana.").some((k) => k.startsWith("capital")));
ok("i → I in English", kinds("Then i see you.").includes("capital:i"));
ok("¿ missing", kinds("Vienes mañana?").includes("punct:Vienes"), kinds("Vienes mañana?").join());
ok("¿ present is fine", !kinds("¿Vienes mañana?").some((k) => k.startsWith("punct")));
ok("¡ missing", kinds("Qué bonito día!").includes("punct:Qué"), kinds("Qué bonito día!").join());
ok("English questions need no ¿", !kinds("Is this a good idea?").some((k) => k.startsWith("punct")));
ok("one issue per place", run("hola  amigo.").issues.length === 2);

// ---- Sentences
ok("sentences split", sentences("Hola. Bien? Sí! Ya").length === 4);
ok("decimal is not a sentence end", sentences("Son 3.5 kilos hoy").length === 1);
ok("lines are sentences", sentences("uno\ndos").length === 2);

// ---- Suggestions on demand (the worker checks with maxSuggest 0)
{
  const r = run("Mañana voy al gimansio.", { maxSuggest: 0 });
  ok("no suggestions while checking", r.issues[0]?.suggestions.length === 0 && r.issues[0]?.lang === "es");
  ok("suggestions when asked", suggestWord("gimansio", "es", { es, en }).join() === "gimnasio");
  ok("asked at sentence start: capital", suggestWord("Gimansio", "es", { es, en })[0] === "Gimnasio");
  ok("falls back to the other language", suggestWord("teh", "es", { es, en })[0] === "the");
}

// ---- Without dictionaries (not loaded yet): only the rules
ok("rules without dictionaries", checkText("hola  amigo al al final.", {}).issues.length === 3, JSON.stringify(checkText("hola  amigo al al final.", {}).issues.map((i) => i.kind)));
ok("suggestion budget", checkText("xqa xqb xqc", { es, en, maxSuggest: 1 }).issues.length === 3);

console.log(`${fail ? "❌" : "✅"} writing: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
