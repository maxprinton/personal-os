// Tests of fill-down + bulk edit rules (src/lib/notes-db/fill.ts).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-bulk-edit.ts
import assert from "node:assert/strict";
import { CONFIRM_ABOVE, canBulkEdit, canFill, currentValue, isMulti, mergeMulti, needsConfirm, normalize, planChanges, sameValue, withValue } from "@/lib/notes-db/fill";
import type { DbNote, NoteProperty, PropType } from "@/lib/notes-db/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e instanceof Error ? e.message.split("\n").join("\n  ") : e}`);
  }
}

let pos = 0;
const P = (id: string, key: string, type: PropType, config: NoteProperty["config"] = {}, builtin = true): NoteProperty => ({ id, key, name: key, type, config, position: pos++, hidden: false, builtin });
const pStatus = P("pStatus", "status", "status", { options: [{ id: "inbox", name: "Inbox", color: "gray", group: "todo" }, { id: "lista", name: "Lista", color: "green", group: "done" }], defaultOptionId: "inbox" });
const pType = P("pType", "type", "select", { options: [{ id: "idea", name: "Idea", color: "yellow" }, { id: "plan", name: "Plan", color: "purple" }] });
const pMulti = P("pMulti", "p_multi", "multi_select", { options: [{ id: "a", name: "A", color: "gray" }, { id: "b", name: "B", color: "gray" }, { id: "c", name: "C", color: "gray" }] }, false);
const pTags = P("pTags", "tags", "tags");
const pFav = P("pFav", "favorite", "checkbox");
const pReview = P("pReview", "review_on", "date");
const pText = P("pText", "p_text", "text", {}, false);
const pNum = P("pNum", "p_num", "number", {}, false);
const pTasks = P("pTasks", "tasks", "relation", { target: "tasks" });
const pRel = P("pRel", "p_rel", "relation", { target: "notes" }, false);
const pWords = P("pWords", "word_count", "word_count");
const pRoll = P("pRoll", "p_roll", "rollup", { calc: "count" }, false);
const pFiles = P("pFiles", "p_files", "files", {}, false);

const note = (id: string, over: Partial<DbNote> = {}): DbNote => ({
  id,
  title: id,
  icon: null,
  cover: null,
  parentId: null,
  blockName: null,
  kind: "page",
  seq: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  templateId: null,
  values: {},
  tags: [],
  relations: {},
  wordCount: 0,
  openTodos: 0,
  backlinks: 0,
  text: "",
  content: "",
  ...over,
});

test("which properties can fill / bulk edit", () => {
  for (const p of [pStatus, pType, pMulti, pTags, pFav, pReview, pText, pNum, pTasks, pRel, pFiles]) assert.equal(canFill(p), true, p.key);
  for (const p of [pWords, pRoll]) assert.equal(canFill(p), false, p.key);
  assert.equal(canBulkEdit(pFiles), false);
  assert.equal(canBulkEdit(pText), true);
  assert.equal(isMulti(pTags) && isMulti(pMulti) && isMulti(pTasks) && !isMulti(pType), true);
});

test("confirm: more than 10 notes, or any relation", () => {
  assert.equal(needsConfirm(pText, CONFIRM_ABOVE), false);
  assert.equal(needsConfirm(pText, CONFIRM_ABOVE + 1), true);
  assert.equal(needsConfirm(pRel, 1), true);
  assert.equal(needsConfirm(pTasks, 1), true);
});

test("current values in server form", () => {
  const n = note("a", {
    values: { pText: "hi", pMulti: ["a"] },
    tags: [{ name: "x", color: "red" }],
    relations: { pTasks: [{ type: "task", id: "t1", title: "Task 1", done: false }] },
  });
  assert.equal(currentValue(n, pText), "hi");
  assert.deepEqual(currentValue(n, pMulti), ["a"]);
  assert.deepEqual(currentValue(n, pTags), ["x"]);
  assert.deepEqual(currentValue(n, pTasks), [{ type: "task", id: "t1" }]);
  assert.equal(currentValue(note("b"), pType), null);
  assert.deepEqual(currentValue(note("b"), pMulti), []);
});

test("normalize: empty, status default, checkbox, duplicates, dates", () => {
  assert.equal(normalize(pText, ""), null);
  assert.equal(normalize(pStatus, null), "inbox");
  assert.equal(normalize(pFav, null), false);
  assert.equal(normalize(pFav, true), true);
  assert.deepEqual(normalize(pMulti, ["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(normalize(pTags, ["X", "x", "y"]), ["X", "y"]);
  assert.deepEqual(normalize(pReview, { start: "2026-11-03" }), { start: "2026-11-03", end: null, time: null });
  assert.equal(normalize(pReview, { start: "" }), null);
});

test("sameValue: lists as sets, empty = empty, null checkbox = false", () => {
  assert.equal(sameValue(pMulti, ["a", "b"], ["b", "a"]), true);
  assert.equal(sameValue(pMulti, [], null), true);
  assert.equal(sameValue(pTags, ["Foo"], ["foo"]), true);
  assert.equal(sameValue(pFav, null, false), true);
  assert.equal(sameValue(pFav, null, true), false);
  assert.equal(sameValue(pType, "idea", "plan"), false);
  assert.equal(sameValue(pRel, [{ type: "note", id: "1" }], [{ type: "note", id: "1" }]), true);
});

test("mergeMulti: replace / add / remove", () => {
  assert.deepEqual(mergeMulti(pMulti, ["a", "b"], ["c"], "replace"), ["c"]);
  assert.deepEqual(mergeMulti(pMulti, ["a", "b"], ["b", "c"], "add"), ["a", "b", "c"]);
  assert.deepEqual(mergeMulti(pMulti, ["a", "b"], ["b", "c"], "remove"), ["a"]);
  assert.deepEqual(mergeMulti(pMulti, ["a"], [], "replace"), []);
  assert.deepEqual(mergeMulti(pTags, ["Foo"], ["foo", "bar"], "add"), ["Foo", "bar"]);
  assert.deepEqual(mergeMulti(pRel, [{ type: "note", id: "1" }], [{ type: "note", id: "1" }, { type: "note", id: "2" }], "add"), [{ type: "note", id: "1" }, { type: "note", id: "2" }]);
});

test("fill: copies the source value, skips notes that already match, keeps undo values", () => {
  const src = note("src", { values: { pType: "idea" } });
  const a = note("a", { values: { pType: "plan" } });
  const b = note("b");
  const c = note("c", { values: { pType: "idea" } });
  const { changes, before } = planChanges(pType, [a, b, c], currentValue(src, pType));
  assert.deepEqual(changes, [{ noteId: "a", value: "idea" }, { noteId: "b", value: "idea" }]);
  assert.deepEqual(before, [{ noteId: "a", value: "plan" }, { noteId: "b", value: null }]);
});

test("fill an empty source clears the targets (status falls back to its default)", () => {
  const a = note("a", { values: { pText: "x", pStatus: "lista" } });
  assert.deepEqual(planChanges(pText, [a], null).changes, [{ noteId: "a", value: null }]);
  assert.deepEqual(planChanges(pStatus, [a], null).changes, [{ noteId: "a", value: "inbox" }]);
});

test("fill multi-values replaces by default (Notion), bulk can add / remove", () => {
  const a = note("a", { values: { pMulti: ["a", "b"] } });
  assert.deepEqual(planChanges(pMulti, [a], ["c"]).changes, [{ noteId: "a", value: ["c"] }]);
  assert.deepEqual(planChanges(pMulti, [a], ["c"], "add").changes, [{ noteId: "a", value: ["a", "b", "c"] }]);
  assert.deepEqual(planChanges(pMulti, [a], ["a"], "remove").changes, [{ noteId: "a", value: ["b"] }]);
  assert.equal(planChanges(pMulti, [a], ["a"], "add").changes.length, 0);
  assert.equal(planChanges(pMulti, [a], ["c"], "remove").changes.length, 0);
});

test("tags: adding keeps each note's own tags", () => {
  const a = note("a", { tags: [{ name: "one", color: null }] });
  const b = note("b");
  const { changes } = planChanges(pTags, [a, b], ["two"], "add");
  assert.deepEqual(changes, [{ noteId: "a", value: ["one", "two"] }, { noteId: "b", value: ["two"] }]);
});

test("checkbox: false → true, and unchecked notes already false are skipped", () => {
  const a = note("a", { values: { pFav: false } });
  const b = note("b");
  assert.equal(planChanges(pFav, [a, b], false).changes.length, 0);
  assert.deepEqual(planChanges(pFav, [a, b], true).changes, [{ noteId: "a", value: true }, { noteId: "b", value: true }]);
});

test("withValue: single values, clearing, status default", () => {
  const a = note("a", { values: { pText: "x", pStatus: "lista" } });
  assert.equal(withValue(a, pText, "y").values.pText, "y");
  assert.equal("pText" in withValue(a, pText, null).values, false);
  assert.equal(withValue(a, pStatus, null).values.pStatus, "inbox");
  assert.equal(a.values.pText, "x"); // the original is not touched
});

test("withValue: tags keep known colors", () => {
  const a = note("a", { tags: [{ name: "one", color: "red" }] });
  const out = withValue(a, pTags, ["one", "two"], { items: [], tags: [{ name: "two", color: "blue" }] });
  assert.deepEqual(out.tags, [{ name: "one", color: "red" }, { name: "two", color: "blue" }]);
});

test("withValue: relations show the titles we already know", () => {
  const item = { type: "note" as const, id: "n1", title: "Gym plan" };
  const a = note("a");
  const out = withValue(a, pRel, [{ type: "note", id: "n1" }], { items: [item], tags: [] });
  assert.deepEqual(out.relations.pRel, [item]);
  assert.deepEqual(out.values.pRel, [{ type: "note", id: "n1" }]);
  const t = withValue(a, pTasks, [{ type: "task", id: "t9" }]);
  assert.deepEqual(t.relations.pTasks, [{ type: "task", id: "t9", title: "" }]);
  assert.equal("pTasks" in t.values, false); // built-in relations live in entity_relations, not in props
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
