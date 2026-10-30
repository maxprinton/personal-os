// Notes linked to blocks: "Former · <block> · <date>" titles, the new "Block" property, and what
// happens to a block's note when the block is renamed, deleted or a new block takes the name
// (fake database: nothing is sent).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-block-links.ts
import { formerTitleOn, releaseBlockNote, renameBlockNote, findBlockNote } from "@/lib/block-notes";
import { rawValue, displayText, sortKey } from "@/lib/notes-db/values";
import { BUILTINS } from "@/lib/notes-db/builtins";
import { READONLY_TYPES, type DbNote, type NoteProperty } from "@/lib/notes-db/types";
import { noteMetaLines } from "@/lib/notes-db/meta";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ---- A tiny fake Supabase (only what block-notes.ts uses) ----
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const q = {
      select: () => q,
      update: (p: Row) => ((patch = p), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      not: (k: string, _op: string, v: unknown) => (filters.push((r) => (r[k] ?? null) !== v), q),
      maybeSingle: async () => ({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (res: (x: { data: Row[] | null; error: null }) => void) => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of hit) Object.assign(r, patch);
        filters = [];
        res({ data: patch ? null : hit.map((r) => ({ ...r })), error: null });
      },
    };
    return q;
  };
  return { from } as never;
}

// ---- Former titles ----
ok("former title", formerTitleOn("Gym", "2026-10-29") === "Former · Gym · Oct 29", formerTitleOn("Gym", "2026-10-29"));
ok("former title Jan 1", formerTitleOn("  Deep   work ", "2027-01-01") === "Former · Deep work · Jan 1", formerTitleOn("  Deep   work ", "2027-01-01"));
ok("former title Dec", formerTitleOn("Read", "2026-12-31").endsWith("Dec 31"));

// ---- The Block property ----
const blockDef = BUILTINS.find((b) => b.key === "block");
ok("Block is a built-in", !!blockDef && blockDef.type === "block" && !blockDef.hidden);
ok("Block is not typed by hand", READONLY_TYPES.includes("block"));
const prop: NoteProperty = { id: "p1", key: "block", name: "Block", type: "block", config: {}, position: 0, hidden: false, builtin: true };
const base = { id: "n1", title: "Gym", icon: null, cover: null, parentId: null, seq: 1, createdAt: "", updatedAt: "", templateId: null, values: {}, tags: [], relations: {}, wordCount: 0, openTodos: 0, backlinks: 0, text: "", content: "" };
const blockNote: DbNote = { ...base, blockName: "Gym", kind: "block" };
const page: DbNote = { ...base, id: "n2", title: "Ideas", blockName: null, kind: "page" };
ok("Block value of a block note", rawValue(blockNote, prop, [prop]) === "Gym");
ok("Block value of a page is empty", rawValue(page, prop, [prop]) === null);
ok("Block shows its name", displayText(blockNote, prop, [prop]) === "Gym");
ok("Block sorts by name", sortKey(blockNote, prop, [prop]) === "gym" && sortKey(page, prop, [prop]) === null);

// ---- Settings: dates in the user's timezone ----
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ---- Deleting a block / a new block with an old name: its note becomes Former ----
{
  const notes: Row[] = [
    { id: "a", user_id: "u", title: "Gym", block_name: "Gym", content: "squats", updated_at: "", deleted_at: null },
    { id: "b", user_id: "u", title: "Read", block_name: "Read", content: "", updated_at: "", deleted_at: null },
  ];
  const sb = fakeDb({ notes, user_settings: [{ timezone: "America/Guayaquil" }] });
  const released = await releaseBlockNote(sb, "u", "gym");
  ok("release returns the note", released === "a", String(released));
  ok("released note is a normal page", notes[0].block_name === null);
  ok("released note is called Former", notes[0].title === formerTitleOn("Gym", today), String(notes[0].title));
  ok("released note keeps its text and id", notes[0].content === "squats" && notes[0].id === "a");
  ok("the block has no note now", (await findBlockNote(sb, "u", "Gym")) === null);
  ok("release with no note", (await releaseBlockNote(sb, "u", "Swim")) === null);
  ok("other block notes untouched", notes[1].block_name === "Read");
}

// ---- Renaming a block: the note follows; an old note with the new name becomes Former ----
{
  const notes: Row[] = [
    { id: "a", user_id: "u", title: "Gym", block_name: "Gym", content: "x", updated_at: "", deleted_at: null },
    { id: "c", user_id: "u", title: "Training", block_name: "Training", content: "old", updated_at: "", deleted_at: null },
  ];
  const sb = fakeDb({ notes, user_settings: [{ timezone: "America/Guayaquil" }] });
  const r = await renameBlockNote(sb, "u", "Gym", "Training");
  ok("rename: note follows", notes[0].block_name === "Training" && notes[0].title === "Training");
  ok("rename: old note parked as Former", notes[1].block_name === null && notes[1].title === formerTitleOn("Training", today), String(notes[1].title));
  ok("rename: reports it", r.parked === "Training");
}

// ---- Every property as text, for Telegram / @os ----
{
  const P = (id: string, key: string, name: string, type: NoteProperty["type"], position: number, config: NoteProperty["config"] = {}): NoteProperty => ({ id, key, name, type, config, position, hidden: false, builtin: true });
  const props: NoteProperty[] = [
    P("t", "type", "Type", "select", 0, { options: [{ id: "idea", name: "Idea", color: "yellow" }] }),
    P("g", "tags", "Tags", "tags", 1),
    P("f", "favorite", "Favorite", "checkbox", 2),
    P("i", "id", "ID", "unique_id", 3, { prefix: "NOTE" }),
    P("r", "tasks", "Tasks", "relation", 4, { target: "tasks" }),
    P("s", "ai_summary", "AI summary", "ai_summary", 5),
    P("k", "kind", "Kind", "kind", 6),
    P("b", "block", "Block", "block", 7),
    P("w", "word_count", "Words", "word_count", 8),
    P("x", "p_x", "Notes", "text", 9),
  ];
  const n: DbNote = {
    ...base,
    seq: 12,
    blockName: "Gym",
    kind: "block",
    values: { t: "idea", f: true, s: { text: "Leg day plan for November.", at: "2026-10-30" } },
    tags: [{ name: "fitness", color: null }],
    relations: { r: [{ type: "task", id: "t1", title: "Buy shoes" }] },
    wordCount: 0,
  };
  const lines = noteMetaLines(n, props, "UTC", "Health");
  const has = (l: string) => lines.includes(l);
  ok("meta: parent page", has("Inside page: Health"), lines.join(" | "));
  ok("meta: select", has("Type: Idea"));
  ok("meta: tags", has("Tags: #fitness"));
  ok("meta: checkbox", has("Favorite: yes"));
  ok("meta: ID", lines.some((l) => /^ID: NOTE-12$/.test(l)), lines.join(" | "));
  ok("meta: relation titles", has("Tasks: Buy shoes"));
  ok("meta: AI summary", has("AI summary: Leg day plan for November."));
  ok("meta: kind and block", has("Kind: Block note") && has("Block: Gym"));
  ok("meta: empty / zero left out", !lines.some((l) => l.startsWith("Words:") || l.startsWith("Notes:")));
  const plain = noteMetaLines({ ...n, values: {}, tags: [], relations: {}, blockName: null, kind: "page" }, props);
  ok("meta: unchecked checkbox left out", !plain.some((l) => l.startsWith("Favorite")));
}

console.log(`${fail ? "❌" : "✅"} block links: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
