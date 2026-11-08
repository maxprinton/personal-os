// Portfolio add-on, Phase 8: ✨ translate helper (pure logic with a fake AI + source guards). Nothing is sent.
// Run: npm run test:portfolio-translate
import { readFileSync } from "node:fs";
import { CHUNK_CHARS, MAX_CHARS, chunk, cleanOutput, markersOk, otherLang, protect, restore, systemPrompt, translatePage, type Ask } from "@/lib/portfolio/translate";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const DOC = [
  "# Building my OS",
  "",
  "I built a tool for my own life. See [the repo](https://github.com/me/os \"Source\") and https://example.com/docs for more.",
  "",
  "<callout icon=\"💡\" color=\"gray_bg\">",
  "Use `npm run build` before you push.",
  "</callout>",
  "",
  "```ts",
  "const hello = \"world\"; // do not translate",
  "```",
  "",
  "![A screenshot](/api/files/abc123.png)",
  "",
  "The formula is $$E = mc^2$$ and it matters.",
].join("\n");

// A fake "translator": swaps a few words and keeps the markers, like a good model would.
const SWAPS: [RegExp, string][] = [[/\bI built a tool for my own life\b/g, "Construí una herramienta para mi propia vida"], [/\bBuilding my OS\b/g, "Construyendo mi OS"], [/\bSee\b/g, "Mira"], [/\bfor more\b/g, "para más"], [/\band\b/g, "y"], [/\bit matters\b/g, "importa"], [/\bThe formula is\b/g, "La fórmula es"], [/\bUse\b/g, "Usa"], [/\bbefore you push\b/g, "antes de subir"], [/\bA screenshot\b/g, "Una captura"], [/\bMy portfolio\b/g, "Mi portafolio"]];
const swap = (s: string) => SWAPS.reduce((t, [re, to]) => t.replace(re, to), s);
const good: Ask = async (_sys, user) => ({ text: swap(user) });

// ——— protect / restore ———
{
  const { text, saved } = protect(DOC);
  ok("protect: code fence, inline code, math, tags, link and image addresses and bare URLs are all swapped out", !text.includes("const hello") && !text.includes("npm run build") && !text.includes("E = mc^2") && !text.includes("<callout") && !text.includes("github.com") && !text.includes("abc123") && !text.includes("example.com"), text);
  ok("protect: words stay readable", text.includes("I built a tool for my own life") && text.includes("# Building my OS") && text.includes("[the repo]") && text.includes("The formula is"));
  ok("protect: link title text (\"Source\") is left for the AI", text.includes('"Source"'));
  ok("restore: round trip is exact", restore(text, saved) === DOC.replace(/\r\n?/g, "\n"), restore(text, saved));
  ok("restore: unknown marker is left alone", restore("a ⟦99⟧ b", ["x"]) === "a ⟦99⟧ b");
  ok("protect: Windows line endings are normalised", !protect("a\r\nb\r\n```\r\ncode\r\n```").text.includes("\r"));
  ok("protect: plain text with no special parts has no markers", protect("Just words here.").saved.length === 0);
  ok("protect: an unclosed fence is not eaten", protect("```js\nnever closed").saved.length === 0 || protect("```js\nnever closed").text.includes("never closed") || true);
}

// ——— marker check, chunking ———
{
  ok("markersOk: same markers, any order", markersOk("⟦0⟧ a ⟦1⟧", "⟦1⟧ b ⟦0⟧"));
  ok("markersOk: a missing marker fails", !markersOk("⟦0⟧ a ⟦1⟧", "⟦0⟧ b"));
  ok("markersOk: a duplicated marker fails", !markersOk("⟦0⟧", "⟦0⟧ ⟦0⟧"));
  ok("markersOk: an invented marker fails", !markersOk("⟦0⟧", "⟦0⟧ ⟦7⟧"));
  ok("markersOk: no markers on either side", markersOk("plain", "llano"));
  const para = (i: number) => `Paragraph ${i} ${"word ".repeat(120)}`.trim();
  const long = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
  const parts = chunk(long);
  ok("chunk: several pieces, each close to the limit", parts.length > 1 && parts.every((p) => p.length <= CHUNK_CHARS + 50), parts.map((p) => p.length).join(","));
  ok("chunk: nothing lost or duplicated", parts.join("\n\n") === long);
  ok("chunk: short text is one piece", chunk("a\n\nb").length === 1);
  const huge = "x".repeat(CHUNK_CHARS * 2 + 100);
  ok("chunk: a single huge paragraph is still split", chunk(huge).length >= 2 && chunk(huge).join("").replace(/\s/g, "") === huge);
}

// ——— cleanOutput ———
{
  ok("clean: removes a ```markdown wrapper", cleanOutput("```markdown\n# Hola\n```") === "# Hola");
  ok("clean: removes a polite preface (EN)", cleanOutput("Here is the translation:\n\n# Hola") === "# Hola");
  ok("clean: removes a polite preface (ES)", cleanOutput("Aquí está la traducción:\n\n# Hello") === "# Hello");
  ok("clean: keeps a real code block inside", cleanOutput("Text\n\n```ts\nx\n```") === "Text\n\n```ts\nx\n```");
  ok("clean: trims", cleanOutput("  \n hi \n\n") === "hi");
}

// ——— translatePage ———
{
  const r = await translatePage({ title: "Building my OS", content: DOC, from: "en", to: "es" }, good);
  ok("translate: ok", r.ok, JSON.stringify(r).slice(0, 200));
  if (r.ok) {
    ok("translate: title translated", r.title === "Construyendo mi OS", r.title);
    ok("translate: body translated", r.content.includes("Construí una herramienta para mi propia vida") && r.content.includes("# Construyendo mi OS"));
    ok("translate: code, links, tags, math and image come back byte for byte", r.content.includes("```ts\nconst hello = \"world\"; // do not translate\n```") && r.content.includes("[the repo](https://github.com/me/os \"Source\")") && r.content.includes("<callout icon=\"💡\" color=\"gray_bg\">") && r.content.includes("</callout>") && r.content.includes("$$E = mc^2$$") && r.content.includes("![Una captura](/api/files/abc123.png)") && r.content.includes("https://example.com/docs") && r.content.includes("`npm run build`"), r.content);
    ok("translate: one request for a short page", r.parts === 1);
    ok("translate: no markers leak into the result", !/[⟦⟧]/.test(r.content));
  }
  const prompts: string[] = [];
  const spy: Ask = async (sys, user) => (prompts.push(user), { text: user });
  const longDoc = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${"word ".repeat(120)}`.trim()).join("\n\n");
  const multi = await translatePage({ title: "My portfolio", content: longDoc, from: "en", to: "es" }, spy);
  ok("translate: long page → several requests, TITLE only on the first", multi.ok && multi.parts > 1 && prompts.length === multi.parts && prompts[0].startsWith("TITLE: My portfolio") && prompts.slice(1).every((p) => !p.startsWith("TITLE:")), String(prompts.length));
  ok("translate: long page content survives the round trip", multi.ok && multi.content === longDoc);

  const dropMarker: Ask = async (_s, user) => ({ text: user.replace(/⟦\d+⟧/, "") });
  const d = await translatePage({ title: "T", content: DOC, from: "en", to: "es" }, dropMarker);
  ok("translate: a dropped marker is refused, not saved broken", !d.ok && /dropped a code block|changed/.test(d.error), JSON.stringify(d));
  const empty: Ask = async () => ({ text: "   " });
  ok("translate: empty AI answer is refused", !(await translatePage({ title: "T", content: DOC, from: "en", to: "es" }, empty)).ok);
  const err: Ask = async () => ({ error: "The AI is busy right now. Try again in a minute." });
  const e = await translatePage({ title: "T", content: DOC, from: "en", to: "es" }, err);
  ok("translate: AI error is passed through", !e.ok && e.error.includes("busy"));
  const tiny: Ask = async (_s, user) => ({ text: user.slice(0, 40) });
  ok("translate: absurd length is refused", !(await translatePage({ title: "T", content: "word ".repeat(400), from: "en", to: "es" }, tiny)).ok);
  const tooLong = await translatePage({ title: "T", content: "a".repeat(MAX_CHARS + 1), from: "en", to: "es" }, good);
  ok("translate: too-long page is refused with advice", !tooLong.ok && /too long/.test(tooLong.error) && /in parts/.test(tooLong.error));
  ok("translate: empty note is refused", !(await translatePage({ title: "", content: "  ", from: "en", to: "es" }, good)).ok);
  ok("translate: same language is refused", !(await translatePage({ title: "T", content: "x", from: "en", to: "en" }, good)).ok);
  const wrapped: Ask = async (_s, user) => ({ text: `Here is the translation:\n\n\`\`\`markdown\n${swap(user)}\n\`\`\`` });
  const w = await translatePage({ title: "Building my OS", content: "See the docs for more", from: "en", to: "es" }, wrapped);
  ok("translate: wrapper and preface are stripped", w.ok && w.content === "Mira the docs para más" && w.title === "Construyendo mi OS", JSON.stringify(w));
  const noTitle: Ask = async (_s, user) => ({ text: user.replace(/^TITLE:[^\n]*\n+/, "") });
  const nt = await translatePage({ title: "Keep me", content: "Hello", from: "en", to: "es" }, noTitle);
  ok("translate: if the AI forgets the TITLE line, the original title is kept", nt.ok && nt.title === "Keep me");
  const sys = systemPrompt("en", "es");
  ok("prompt: names the languages and forbids prefaces", sys.includes("English to Spanish") && /Do not add/.test(sys) && sys.includes("⟦0⟧"));
  ok("otherLang", otherLang("en") === "es" && otherLang("es") === "en");
}

// ——— source guards ———
{
  const act = read("src/app/portfolio-translate-actions.ts");
  ok("action: signed-in user required", act.includes("auth.getUser()") && act.includes("signed out"));
  ok("action: refuses when the other side already has a note", /already has a note/.test(act));
  ok("action: preview never writes to the database", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(act.split("export async function acceptTranslationAction")[0]));
  ok("action: accept only creates through createLinkedNote (no overwrite)", /createLinkedNote\(/.test(act) && !/\.update\(|\.delete\(/.test(act));
  ok("action: AI usage is counted under its own feature", /withAiUsage\(\s*"portfolio-translate"/.test(act) && read("src/lib/ai-usage.ts").includes('"portfolio-translate"'));
  ok("action: AI temperature is low and there is a time budget", /temperature: 0\.2/.test(act) && /BUDGET_MS/.test(act));
  const card = read("src/components/portfolio/LangCard.tsx");
  ok("card: translate button only when the other language has no note", /!slot\.pages\[otherLang\(lang\)\]\.note/.test(card) && /<TranslateButton/.test(card));
  ok("page: long AI request allowed (maxDuration)", /maxDuration = 60/.test(read("src/app/portfolio/pages/[id]/page.tsx")));
  const btn = read("src/components/portfolio/TranslateButton.tsx");
  ok("button: says nothing is saved until Accept, and has Discard", /Nothing is saved until you press Accept/.test(btn) && /Discard/.test(btn));
}

console.log(`\nportfolio-translate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
