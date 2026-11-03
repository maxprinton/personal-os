// Tests of the notes trash helpers (src/lib/notes-trash.ts): what is listed, batches (a page + its sub-pages), days left.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-trash.ts
import assert from "node:assert/strict";
import { TRASH_DAYS, batchOf, daysLeft, groupTrash, previewOf, type TrashRow } from "@/lib/notes-trash";

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

const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T09:00:00.000Z";
const row = (id: string, over: Partial<TrashRow> = {}): TrashRow => ({ id, title: id, content: "", page: null, parent_id: null, deleted_at: T1, ...over });
const NOW = Date.parse("2026-11-03T10:00:00.000Z");

test("days left counts down from 30 and stops at 0", () => {
  assert.equal(TRASH_DAYS, 30);
  assert.equal(daysLeft(T1, Date.parse(T1)), 30);
  assert.equal(daysLeft(T1, NOW), 28);
  assert.equal(daysLeft(T1, Date.parse("2026-12-05T00:00:00Z")), 0);
});

test("a page and its sub-pages (same instant) are one batch, at any depth", () => {
  const rows = [row("page"), row("kid", { parent_id: "page" }), row("grandkid", { parent_id: "kid" }), row("other")];
  assert.deepEqual(batchOf(rows, "page").map((r) => r.id).sort(), ["grandkid", "kid", "page"]);
  assert.deepEqual(batchOf(rows, "other").map((r) => r.id), ["other"]);
  assert.deepEqual(batchOf(rows, "missing"), []);
});

test("a sub-page trashed at another moment is NOT part of its page's batch", () => {
  const rows = [row("page", { deleted_at: T2 }), row("kid", { parent_id: "page", deleted_at: T1 })];
  assert.deepEqual(batchOf(rows, "page").map((r) => r.id), ["page"]);
});

test("the list shows pages and lone notes; sub-pages trashed with their page are only counted", () => {
  const rows = [row("page", { title: "Gym plan" }), row("kid", { parent_id: "page" }), row("solo", { deleted_at: T2, title: "" })];
  const list = groupTrash(rows, NOW);
  assert.deepEqual(list.map((i) => i.id), ["solo", "page"]); // newest first
  assert.equal(list[1].subPages, 1);
  assert.equal(list[0].title, "Untitled");
  assert.equal(list[0].daysLeft, 29);
});

test("a sub-page trashed on its own (its page is alive or trashed later) is listed by itself", () => {
  const rows = [row("page", { deleted_at: T2 }), row("kid", { parent_id: "page", deleted_at: T1 }), row("kid2", { parent_id: "alive" })];
  assert.deepEqual(groupTrash(rows, NOW).map((i) => i.id).sort(), ["kid", "kid2", "page"]);
});

test("preview is plain text", () => {
  assert.equal(previewOf("# Title\n\n**bold** and [a link](http://x.com)\n\n```js\ncode\n```"), "Title bold and a link");
  assert.equal(previewOf(""), "");
  assert.equal(previewOf("a".repeat(300)).length, 141);
});

test("icon comes from the page settings", () => {
  const list = groupTrash([row("a", { page: { icon: "🏋️" } })], NOW);
  assert.equal(list[0].icon, "🏋️");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
