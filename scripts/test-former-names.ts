// Former notes and their names (Nov 2026): when a note stops being the note of a block / a portfolio page the user chooses
// "Former · <name> · <date>" or its previous name; the previous name is saved and "Restore" brings everything back.
// Fake database: nothing is sent.
// Run: npm run test:former-names
import { fakeDb, type Row } from "./fake-supabase";
import { formerName, memoryOnBlockLink, ownName, parseMemory, previousName, releaseNaming, titleOnPortfolioLink, type NameMemory } from "@/lib/note-name-memory";
import { releaseBlockNote, findBlockNote } from "@/lib/block-notes";
import { createSlot, linkNote } from "@/lib/portfolio/link";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ——— pure rules ———
ok("former name", formerName("  Deep   work ", "2026-11-08") === "Former · Deep work · Nov 8");
ok("former name with language", formerName("About me", "2026-11-07", "es") === "Former · About me · es · Nov 7");
ok("parseMemory rejects junk", parseMemory(null) === null && parseMemory("x") === null && parseMemory({ scope: "other" }) === null);
ok("parseMemory reads", parseMemory({ scope: "block", original: "Plan", former: null, block: "Gym", at: "2026-11-08", extra: 1 })?.original === "Plan");

const D = "2026-11-08";
// block: linking remembers the name it had
const m1 = memoryOnBlockLink({ title: "My gym plan", block_name: null }, null, "Gym", D);
ok("linking to a block remembers the old name", m1?.original === "My gym plan" && m1.scope === "block" && m1.block === "Gym");
ok("a note already named like the block remembers nothing", memoryOnBlockLink({ title: "gym", block_name: null }, null, "Gym", D) === null);
const m2 = memoryOnBlockLink({ title: "Gym", block_name: "Gym" }, m1, "Run", D);
ok("moving to another block keeps the first old name", m2?.original === "My gym plan" && m2.block === "Run");
ok("a block note born as a block note has no old name", memoryOnBlockLink({ title: "Gym", block_name: "Gym" }, null, "Run", D) === null);

// block: release
const rPrev = releaseNaming({ title: "Gym", mem: m1, choice: "previous", scope: "block", ymd: D, block: "Gym" });
ok("block, previous name: it is called what it was before, and the memory is cleared", rPrev.title === "My gym plan" && rPrev.memory === null && rPrev.usedChoice === "previous");
const rFor = releaseNaming({ title: "Gym", mem: m1, choice: "former", scope: "block", ymd: D, block: "Gym" });
ok("block, Former: titled Former and the old name is kept", rFor.title === "Former · Gym · Nov 8" && rFor.memory?.original === "My gym plan" && rFor.memory.former === rFor.title);
const rNone = releaseNaming({ title: "Gym", mem: null, choice: "previous", scope: "block", ymd: D, block: "Gym" });
ok("block with no saved name falls back to Former", rNone.title === "Former · Gym · Nov 8" && rNone.usedChoice === "former" && rNone.memory?.original === null);
ok("previous name shown for blocks / portfolio", previousName("block", "Gym", m1) === "My gym plan" && previousName("block", "Gym", null) === null && previousName("portfolio", "About me", null) === "About me");

// the Former note goes back to its block: it gets its own name back as the thing to remember
const back = memoryOnBlockLink({ title: rFor.title, block_name: null }, rFor.memory, "Gym", D);
ok("restoring to the block remembers the original name again", back?.original === "My gym plan" && back.former === null);
ok("a Former note without an original name restores with nothing to remember", memoryOnBlockLink({ title: "Former · Gym · Nov 8", block_name: null }, { original: null, former: "Former · Gym · Nov 8", scope: "block", block: "Gym", at: D }, "Gym", D) === null);
ok("ownName only undoes our own rename", ownName("Former · Gym · Nov 8", rFor.memory) === "My gym plan" && ownName("Renamed by hand", rFor.memory) === "Renamed by hand");

// portfolio
const rP = releaseNaming({ title: "About me EN", mem: null, choice: "former", scope: "portfolio", ymd: D, slotId: "s1", lang: "en" });
ok("portfolio, Former: uses the page's title", rP.title === "Former · About me EN · en · Nov 8" && rP.memory?.original === "About me EN" && rP.memory.slotId === "s1" && rP.memory.lang === "en");
const rK = releaseNaming({ title: "About me EN", mem: null, choice: "previous", scope: "portfolio", ymd: D });
ok("portfolio, previous name: nothing is renamed", rK.title === "About me EN" && rK.memory === null);
ok("portfolio: linking a Former note brings its title back", titleOnPortfolioLink(rP.title, rP.memory) === "About me EN" && titleOnPortfolioLink("Hand-made title", rP.memory) === "Hand-made title" && titleOnPortfolioLink("X", null) === "X");

// ——— against the fake database ———
const U = "u1";
{
  const tables: Record<string, Row[]> = { portfolio_slots: [], notes: [], portfolio_pages: [], portfolio_page_versions: [] };
  const sb = fakeDb(tables);
  const about = await createSlot(sb, U, { kind: "about" });
  const slotId = (about as { id: string }).id;
  const base = { user_id: U, block_name: null, is_template: false, deleted_at: null, portfolio_slot_id: null, portfolio_lang: null, name_memory: null };
  tables.notes.push({ id: "a", title: "About me EN", ...base }, { id: "b", title: "About me v2", ...base }, { id: "c", title: "About me v3", ...base });
  const note = (id: string) => tables.notes.find((n) => n.id === id)!;

  ok("first link", (await linkNote(sb, U, { slotId, lang: "en", noteId: "a" })).ok);
  const r1 = await linkNote(sb, U, { slotId, lang: "en", noteId: "b", replace: true, nameChoice: "former" });
  ok("replace with Former", r1.ok && /^Former · About me EN · en · /.test(String(note("a").title)) && (note("a").name_memory as NameMemory).original === "About me EN" && note("a").portfolio_slot_id === null, String(note("a").title));
  const r2 = await linkNote(sb, U, { slotId, lang: "en", noteId: "c", replace: true, nameChoice: "previous" });
  ok("replace keeping its name", r2.ok && note("b").title === "About me v2" && note("b").name_memory === null && note("b").portfolio_slot_id === null);

  // Restore = link the Former note again: it comes back with its original name, the current page note is released with the chosen name
  const r3 = await linkNote(sb, U, { slotId, lang: "en", noteId: "a", replace: true, nameChoice: "previous" });
  ok("restore: back as the page with its original name", r3.ok && note("a").title === "About me EN" && note("a").portfolio_slot_id === slotId && note("a").name_memory === null, String(note("a").title));
  ok("restore reports the name", (r3 as { restoredTitle?: string }).restoredTitle === "About me EN");
  ok("restore: the page note that was there is released as asked", note("c").portfolio_slot_id === null && note("c").title === "About me v3");
  const r4 = await linkNote(sb, U, { slotId, lang: "en", noteId: "b", replace: true });
  ok("default choice is Former", r4.ok && /^Former · About me EN · en · /.test(String(note("a").title)));
}

{
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const mk = (): Row[] => [{ id: "g", user_id: "u", title: "Gym", block_name: "Gym", content: "squats", updated_at: "", deleted_at: null, name_memory: { scope: "block", original: "My gym plan", former: null, block: "Gym", at: "2026-11-01" } }];
  {
    const notes = mk();
    const sb = fakeDb({ notes, user_settings: [{ timezone: "America/Guayaquil" }] });
    await releaseBlockNote(sb, "u", "Gym", "previous");
    ok("detach with its previous name", notes[0].block_name === null && notes[0].title === "My gym plan" && notes[0].name_memory === null, String(notes[0].title));
  }
  {
    const notes = mk();
    const sb = fakeDb({ notes, user_settings: [{ timezone: "America/Guayaquil" }] });
    await releaseBlockNote(sb, "u", "Gym");
    const mem = notes[0].name_memory as NameMemory;
    const title = String(notes[0].title);
    ok("detach as Former (default) keeps the old name", title.startsWith("Former · Gym · ") && title.endsWith(String(Number(today.slice(8)))) && mem.original === "My gym plan" && mem.former === notes[0].title, String(notes[0].title));
    ok("the block has no note after detaching", (await findBlockNote(sb, "u", "Gym")) === null);
  }
}

console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
