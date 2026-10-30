// The editor side of the writing check: which text of a paragraph is checked and where each character is.
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { blockText, hereKey } from "@/lib/editor/writing-text";
import { checkText } from "@/lib/writing/check";
import type { Speller } from "@/lib/writing/types";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x = "") => (c ? pass++ : (fail++, console.log(`❌ ${n}${x ? `  [${x}]` : ""}`)));
const schema = getSchema([StarterKit]);
const b = schema.marks.bold.create();
const code = schema.marks.code.create();
const link = schema.marks.link.create({ href: "https://x.com" });
const para = schema.node("paragraph", null, [
  schema.text("Hola "),
  schema.text("gimansio", [b]),
  schema.text(" ver "),
  schema.text("enlaze", [link]),
  schema.text(" y "),
  schema.text("cosa_rara", [code]),
  schema.node("hardBreak"),
  schema.text("fin"),
]);
const doc = schema.node("doc", null, [para]);
const { text, pos } = blockText(para, 1);
ok("text keeps plain and bold", text.startsWith("Hola gimansio ver "), JSON.stringify(text));
ok("links and code are masked", !text.includes("enlaze") && !text.includes("cosa_rara") && text.includes("￼"), JSON.stringify(text));
ok("hard break is a line", text.includes("\nfin"));
ok("one position per character", pos.length === text.length);
const i = text.indexOf("gimansio");
ok("positions map back", doc.textBetween(pos[i], pos[i + 8 - 1] + 1) === "gimansio", doc.textBetween(pos[i], pos[i + 7] + 1));
const sp: Speller = { correct: (w) => ["hola", "ver", "y", "fin"].includes(w.toLowerCase()), suggest: () => ["gimnasio"] };
const r = checkText(text, { es: sp });
const g = r.issues.find((x) => x.word === "gimansio");
ok("only the real typo is marked", r.issues.filter((x) => x.kind === "spelling").length === 1, JSON.stringify(r.issues));
ok("mark lands on the word", !!g && doc.textBetween(pos[g.from], pos[g.to - 1] + 1) === "gimansio");
ok("ignore key", hereKey("Gimansio", "a b") === "gimansio|a b");
console.log(`${fail ? "❌" : "✅"} writing editor: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
