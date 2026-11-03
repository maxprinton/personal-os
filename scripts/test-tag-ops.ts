// Tests of the tag rules (src/lib/notes-db/tag-ops.ts).
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-tag-ops.ts
import assert from "node:assert/strict";
import { applyTagChange, applyTagChangeToAll, cleanTagName, isColor, nextColor } from "@/lib/notes-db/tag-ops";

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
const t = (name: string, color: string | null = null) => ({ name, color });

test("rename and recolor, ignoring case in the match", () => {
  const out = applyTagChange([t("Work", "blue"), t("home")], { kind: "update", name: "work", to: "Job", color: "red" });
  assert.deepEqual(out, [t("Job", "red"), t("home")]);
});
test("recolor only keeps the name; rename only keeps the color", () => {
  assert.deepEqual(applyTagChange([t("a", "blue")], { kind: "update", name: "a", color: "pink" }), [t("a", "pink")]);
  assert.deepEqual(applyTagChange([t("a", "blue")], { kind: "update", name: "a", to: "b" }), [t("b", "blue")]);
});
test("delete removes the tag", () => {
  assert.deepEqual(applyTagChange([t("a"), t("b")], { kind: "delete", name: "A" }), [t("b")]);
});
test("merge: a note with both ends with one (the target's); a note with only the old one gets the target", () => {
  const both = applyTagChange([t("old", "red"), t("new", "green")], { kind: "merge", name: "old", into: "new" });
  assert.deepEqual(both, [t("new", "green")]);
  const only = applyTagChange([t("old", "red"), t("x")], { kind: "merge", name: "old", into: "new" });
  assert.deepEqual(only.map((x) => x.name), ["new", "x"]);
});
test("applyTagChangeToAll leaves notes without the tag untouched (same object)", () => {
  const a = { id: "1", tags: [t("work")] };
  const b = { id: "2", tags: [t("home")] };
  const out = applyTagChangeToAll([a, b], { kind: "update", name: "work", to: "job" });
  assert.equal(out[1], b);
  assert.equal(out[0].tags[0].name, "job");
});
test("helpers: names, colors, cycling", () => {
  assert.equal(cleanTagName("  #Work  "), "Work");
  assert.equal(cleanTagName(5), "");
  assert.equal(isColor("red"), true);
  assert.equal(isColor("magenta"), false);
  assert.equal(nextColor(0), "gray");
  assert.equal(nextColor(9), "gray");
  assert.equal(nextColor(-1), "red");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
