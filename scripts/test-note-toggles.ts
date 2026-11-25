// BL-104: per-note switches for AI correction (off by default) and spellcheck (on by default).
import { readFileSync } from "node:fs";
import { aiAllowed, noteAiOn, noteSpellOn, spellAllowed } from "@/lib/writing/note-toggles";
import { cleanPatch } from "@/lib/writing/settings";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : (fail++, console.error("FAIL", name)); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

ok("default: AI correction off", noteAiOn({}) === false && noteAiOn(null) === false && noteAiOn({ aiCorrect: null }) === false);
ok("default: spellcheck on", noteSpellOn({}) === true && noteSpellOn(null) === true && noteSpellOn({ spellcheck: null }) === true);
ok("AI off in the note: not allowed (global on)", aiAllowed({}, "notes", {}) === false);
ok("AI on in the note: allowed", aiAllowed({}, "notes", { aiCorrect: true }) === true);
ok("global AI off wins", aiAllowed({ ai: false }, "notes", { aiCorrect: true }) === false);
ok("global spell off wins", spellAllowed({ spell: false }, "notes", {}) === false);
ok("notes area off wins", spellAllowed({ areas: { notes: false } }, "notes", {}) === false);
ok("spellcheck off in the note", spellAllowed({}, "notes", { spellcheck: false }) === false);
ok("AI needs spellcheck on", aiAllowed({}, "notes", { aiCorrect: true, spellcheck: false }) === false);
ok("two notes are independent", aiAllowed({}, "notes", { aiCorrect: true }) && !aiAllowed({}, "notes", {}));
ok("cleanPatch ignores note keys", Object.keys(cleanPatch({ aiCorrect: true, spellcheck: false })).length === 0);
ok("savePageSettings keeps both keys", /"aiCorrect", "spellcheck"\]/.test(src("app/note-actions.ts")));
const plugin = src("lib/editor/writing.ts");
ok("automatic AI checks need aiEnabled", /!cached\.length && storage\.aiEnabled && aiOn/.test(plugin));
ok("queued AI jobs need aiEnabled", /!storage\.aiEnabled \|\| !aiOn/.test(plugin));
ok("manual AI check refuses when off", /if \(!storage\.aiEnabled\) return \{ issues: \[\], error/.test(plugin));
const ne = src("components/NoteEditor.tsx");
ok("the note editor passes both switches", /aiCorrect=\{noteAiOn\(page\)\}/.test(ne) && /spellcheck=\{noteSpellOn\(page\)\}/.test(ne));
ok("other editors keep AI on by default", /aiCorrect = true/.test(src("components/editor/RichEditor.tsx")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
