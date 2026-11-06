// Saved views of the notes database: what needs "Save", names, order, delete.
import { defaultView, newRule } from "@/lib/notes-db/query";
import { MAX_VIEW_NAME, afterDelete, autoPartChanged, autoSavedState, cleanExtras, cleanViewName, copyName, draftPart, isDirty, moveItem, nextViewName, reorderedViews, resetDraft, withDraft, type SavedView } from "@/lib/notes-db/views";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}

const base = defaultView([]);
const saved = { ...base, layout: "table" as const };

// Dirty = only filters, sorts and board grouping
eq("same view is not dirty", isDirty(saved, saved), false);
eq("search alone is not dirty", isDirty({ ...saved, search: "hello" }, saved), false);
eq("layout alone is not dirty", isDirty({ ...saved, layout: "board" }, saved), false);
eq("widths alone are not dirty", isDirty({ ...saved, widths: { title: 300 } }, saved), false);
eq("a sort makes it dirty", isDirty({ ...saved, sorts: [{ prop: "title", dir: "asc" }] }, saved), true);
eq("a chip makes it dirty", isDirty({ ...saved, quick: [newRule("title")] }, saved), true);
eq("board grouping makes it dirty", isDirty({ ...saved, groupBy: "x" }, saved), true);

// Reset keeps layout/columns, drops filters, sorts and search
const working = { ...saved, layout: "gallery" as const, search: "abc", sorts: [{ prop: "title", dir: "desc" as const }], quick: [newRule("title")] };
const reset = resetDraft(working, saved);
eq("reset layout kept", reset.layout, "gallery");
eq("reset sorts", reset.sorts, []);
eq("reset quick", reset.quick, []);
eq("reset search", reset.search, "");
eq("reset is clean", isDirty(reset, saved), false);

// Save stores the draft; auto-save stores everything else
const stored = withDraft(saved, working);
eq("save keeps sorts", stored.sorts, working.sorts);
eq("save drops search", stored.search, "");
const auto = autoSavedState(working, saved);
eq("auto keeps new layout", auto.layout, "gallery");
eq("auto does not save sorts", auto.sorts, []);
eq("auto change detected", autoPartChanged(working, saved), true);
eq("no auto change for filters only", autoPartChanged({ ...saved, sorts: [{ prop: "title", dir: "asc" }], search: "x" }, saved), false);
eq("draftPart keys", Object.keys(draftPart(saved)).sort(), ["advanced", "groupBy", "quick", "sorts"]);

// Names
eq("first name", nextViewName([], "Table"), "Table");
eq("second name", nextViewName(["Table"], "Table"), "Table 2");
eq("third name, case-insensitive", nextViewName(["table", "TABLE 2"], "Table"), "Table 3");
eq("copy name", copyName(["Plan"], "Plan"), "Plan copy");
eq("copy of copy", copyName(["Plan", "Plan copy"], "Plan"), "Plan copy 2");
eq("clean name trims", cleanViewName("  a   b  "), "a b");
eq("clean name empty → fallback", cleanViewName("   "), "View");
eq("clean name not string", cleanViewName(42), "View");
eq("clean name max length", cleanViewName("x".repeat(200)).length, MAX_VIEW_NAME);
eq("extras defaults", cleanExtras(null), { cardSize: "medium", hideEmpty: false });
eq("extras valid", cleanExtras({ cardSize: "large", hideEmpty: true }), { cardSize: "large", hideEmpty: true });
eq("extras invalid size", cleanExtras({ cardSize: "huge" }).cardSize, "medium");

// Order
const mk = (id: string, position: number): SavedView => ({ id, name: id, position, state: saved, extras: cleanExtras(null) });
const views = [mk("a", 0), mk("b", 1), mk("c", 2)];
eq("move right", moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
eq("move left", moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
eq("move out of range", moveItem(["a", "b"], 0, 5), ["a", "b"]);
eq("reorder ids", reorderedViews(views, ["c", "a", "b"]).map((v) => [v.id, v.position]), [["c", 0], ["a", 1], ["b", 2]]);
eq("reorder with a missing id keeps it at the end", reorderedViews(views, ["b"]).map((v) => v.id), ["b", "a", "c"]);
eq("reorder ignores unknown ids", reorderedViews(views, ["z", "a"]).map((v) => v.id), ["a", "b", "c"]);

// Delete: show the view on the left, else the first
eq("delete middle → left", afterDelete(views, "b"), "a");
eq("delete first → next", afterDelete(views, "a"), "b");
eq("delete last → left", afterDelete(views, "c"), "b");
eq("delete the only one", afterDelete([mk("a", 0)], "a"), null);

console.log(`\nnote-views: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
