// Tests of the notes database view engine (src/lib/notes-db/query.ts): filters for every type,
// AND / OR groups, search without accents, sorts (empties last), relative date ranges, board groups,
// cleaning a saved view. Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-notes-db.ts
import assert from "node:assert/strict";
import {
  addMonths,
  applyView,
  cardHasValue,
  countActiveRules,
  defaultView,
  groupNotes,
  isFiltering,
  localDay,
  matchesSearch,
  newRule,
  operatorsFor,
  resolveDay,
  sanitizeView,
  sortNotes,
  valuesFromView,
  withinRange,
} from "@/lib/notes-db/query";
import type { DbNote, FilterGroup, FilterOp, FilterRule, NoteProperty, PropType, ViewState } from "@/lib/notes-db/types";

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

// ---- Fixture ----------------------------------------------------------------------------------------
let pos = 0;
const P = (id: string, key: string, name: string, type: PropType, config: NoteProperty["config"] = {}, builtin = true): NoteProperty => ({ id, key, name, type, config, position: pos++, hidden: false, builtin });
const props: NoteProperty[] = [
  P("pType", "type", "Type", "select", { options: [{ id: "idea", name: "Idea", color: "yellow" }, { id: "plan", name: "Plan", color: "purple" }, { id: "reunion", name: "Reunión", color: "orange" }] }),
  P("pStatus", "status", "Status", "status", {
    options: [
      { id: "inbox", name: "Inbox", color: "gray", group: "todo" },
      { id: "dev", name: "Desarrollando", color: "blue", group: "in_progress" },
      { id: "lista", name: "Lista", color: "green", group: "done" },
      { id: "arch", name: "Archivada", color: "brown", group: "done" },
    ],
  }),
  P("pTags", "tags", "Tags", "tags"),
  P("pFav", "favorite", "Favorite", "checkbox"),
  P("pReview", "review_on", "Review on", "date"),
  P("pSource", "source", "Source", "url"),
  P("pId", "id", "ID", "unique_id", { prefix: "NOTE" }),
  P("pTasks", "tasks", "Tasks", "relation", { target: "tasks" }),
  P("pPending", "pending_tasks", "Pending tasks", "rollup", { relationPropId: "@tasks", calc: "count_pending" }),
  P("pWords", "word_count", "Words", "word_count"),
  P("pKind", "kind", "Kind", "kind"),
  P("pCreated", "created", "Created", "created_time"),
  P("pEdited", "edited", "Last edited", "last_edited_time"),
  P("pScore", "p_score", "Score", "number", {}, false),
  P("pMulti", "p_multi", "Topics", "multi_select", { options: [{ id: "a", name: "Alpha", color: "red" }, { id: "b", name: "Beta", color: "blue" }, { id: "c", name: "Gamma", color: "green" }] }, false),
  P("pText", "p_text", "Notes", "text", {}, false),
  P("pSummary", "ai_summary", "AI summary", "ai_summary"),
];

const TODAY = "2026-10-29"; // a Thursday
const TZ = "America/Bogota";

function N(id: string, over: Partial<DbNote> = {}): DbNote {
  return {
    id,
    title: id,
    icon: null,
    cover: null,
    parentId: null,
    blockName: null,
    kind: "page",
    seq: null,
    createdAt: "2026-10-01T15:00:00Z",
    updatedAt: "2026-10-01T15:00:00Z",
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
  };
}

const notes: DbNote[] = [
  N("n1", { title: "Reunión con Ana", seq: 1, values: { pType: "reunion", pStatus: "inbox", pFav: true, pReview: { start: "2026-10-29" }, pScore: 5, pMulti: ["a", "b"], pText: "Hello World", pSummary: { text: "Talked about budget", at: "x" } }, tags: [{ name: "Trabajo", color: null }], updatedAt: "2026-10-28T10:00:00Z", text: "Hablamos del presupuesto y la acción", wordCount: 120, relations: { pTasks: [{ type: "task", id: "t1", title: "Send", done: false }, { type: "task", id: "t2", title: "Call", done: true }] } }),
  N("n2", { title: "idea: app", seq: 2, values: { pType: "idea", pStatus: "dev", pReview: { start: "2026-10-20", end: "2026-11-02" }, pScore: 10, pMulti: ["b"], pSource: "https://example.com/x" }, tags: [{ name: "personal", color: null }, { name: "trabajo", color: null }], updatedAt: "2026-10-29T04:00:00Z", createdAt: "2026-10-29T04:00:00Z", wordCount: 30 }),
  N("n3", { title: "Plan semanal", seq: 3, values: { pType: "plan", pStatus: "lista", pScore: -1, pMulti: ["c", "zzz-deleted"] }, updatedAt: "2026-10-27T10:00:00Z", kind: "subpage", parentId: "n1" }),
  N("n4", { title: "Deep work", blockName: "Deep work", kind: "block", seq: 4, values: { pType: "deleted-option", pStatus: "arch" }, updatedAt: "2026-10-26T10:00:00Z", text: "focus block notes" }),
  N("n5", { title: "", seq: 5, values: {}, updatedAt: "2026-10-25T10:00:00Z" }),
];

const view = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultView(props), ...over });
const R = (prop: string, op: FilterOp, value?: unknown): FilterRule => ({ kind: "rule", id: `${prop}-${op}-${JSON.stringify(value)}`, prop, op, value });
const G = (join: "and" | "or", ...items: (FilterRule | FilterGroup)[]): FilterGroup => ({ kind: "group", id: `g${Math.random()}`, join, items });
const ids = (v: Partial<ViewState>) => applyView(notes, props, view(v), TODAY, TZ).map((n) => n.id);
const quick = (...rules: FilterRule[]) => ids({ quick: rules }).sort();

// ---- Default view and sorts ----------------------------------------------------------------------------
test("default sort: last edited first", () => assert.deepEqual(ids({}), ["n2", "n1", "n3", "n4", "n5"]));
test("default view shows the main built-ins and own properties, groups by Status", () => {
  const v = defaultView(props);
  assert.equal(v.groupBy, "pStatus");
  assert.deepEqual(v.visible, ["pType", "pStatus", "pTags", "pFav", "pReview", "pEdited", "pScore", "pMulti", "pText"]);
  assert.equal(v.layout, "table");
});
test("sort number asc, empties last", () => assert.deepEqual(ids({ sorts: [{ prop: "pScore", dir: "asc" }] }), ["n3", "n1", "n2", "n4", "n5"]));
test("sort number desc, empties still last", () => assert.deepEqual(ids({ sorts: [{ prop: "pScore", dir: "desc" }] }), ["n2", "n1", "n3", "n4", "n5"]));
test("sort title asc (accent-insensitive, empty title last)", () => assert.deepEqual(ids({ sorts: [{ prop: "title", dir: "asc" }] }), ["n4", "n2", "n3", "n1", "n5"]));
test("sort select by option order", () => assert.deepEqual(ids({ sorts: [{ prop: "pType", dir: "asc" }] }), ["n2", "n3", "n1", "n4", "n5"]));
test("sort status desc", () => assert.deepEqual(ids({ sorts: [{ prop: "pStatus", dir: "desc" }] }), ["n4", "n3", "n2", "n1", "n5"]));
test("multi sorts: favorite desc then title", () => assert.deepEqual(ids({ sorts: [{ prop: "pFav", dir: "desc" }, { prop: "title", dir: "asc" }] }), ["n1", "n4", "n2", "n3", "n5"]));
test("sort by date asc, empties last", () => assert.deepEqual(ids({ sorts: [{ prop: "pReview", dir: "asc" }] }), ["n2", "n1", "n3", "n4", "n5"]));
test("sort by a deleted property is ignored", () => assert.deepEqual(sortNotes(notes, [{ prop: "gone", dir: "asc" }], props).map((n) => n.id), ["n2", "n1", "n3", "n4", "n5"]));
test("sort by created", () => assert.equal(ids({ sorts: [{ prop: "pCreated", dir: "desc" }] })[0], "n2"));

// ---- Search ------------------------------------------------------------------------------------------
test("search ignores accents and case", () => {
  assert.deepEqual(ids({ search: "REUNION" }), ["n1"]);
  assert.deepEqual(ids({ search: "accion" }), ["n1"]);
  assert.deepEqual(ids({ search: "acción presupuesto" }), ["n1"]);
});
test("search matches block name, tags and text", () => {
  assert.deepEqual(ids({ search: "focus" }), ["n4"]);
  assert.deepEqual(ids({ search: "#personal" }), ["n2"]);
  assert.deepEqual(ids({ search: "  " }).length, 5);
  assert.equal(matchesSearch(notes[0], "nothing-here"), false);
});

// ---- Text --------------------------------------------------------------------------------------------
test("title contains / not_contains / starts / ends / is", () => {
  assert.deepEqual(quick(R("title", "contains", "plan")), ["n3"]);
  assert.deepEqual(quick(R("title", "not_contains", "a")), ["n4", "n5"]);
  assert.deepEqual(quick(R("title", "starts_with", "reunion")), ["n1"]);
  assert.deepEqual(quick(R("title", "ends_with", "WORK")), ["n4"]);
  assert.deepEqual(quick(R("title", "is", "plan semanal")), ["n3"]);
  assert.deepEqual(quick(R("title", "is_not", "plan semanal")), ["n1", "n2", "n4", "n5"]);
  assert.deepEqual(quick(R("title", "is_empty")), ["n5"]);
});
test("text property, url, ai summary", () => {
  assert.deepEqual(quick(R("pText", "contains", "world")), ["n1"]);
  assert.deepEqual(quick(R("pText", "is_empty")), ["n2", "n3", "n4", "n5"]);
  assert.deepEqual(quick(R("pSource", "contains", "example")), ["n2"]);
  assert.deepEqual(quick(R("pSource", "is_not_empty")), ["n2"]);
  assert.deepEqual(quick(R("pSummary", "contains", "budget")), ["n1"]);
});
test("a rule without a value doesn't filter", () => {
  assert.equal(quick(R("title", "contains", "")).length, 5);
  assert.equal(quick(R("pScore", "gt")).length, 5);
  assert.equal(quick(R("pType", "any_of", [])).length, 5);
  assert.equal(quick(R("pReview", "within", "nonsense")).length, 5);
  assert.equal(quick(R("deleted-prop", "is", "x")).length, 5);
});

// ---- Numbers ---------------------------------------------------------------------------------------------
test("number operators", () => {
  assert.deepEqual(quick(R("pScore", "eq", 5)), ["n1"]);
  assert.deepEqual(quick(R("pScore", "eq", "5")), ["n1"]);
  assert.deepEqual(quick(R("pScore", "neq", 5)), ["n2", "n3", "n4", "n5"]);
  assert.deepEqual(quick(R("pScore", "gt", 5)), ["n2"]);
  assert.deepEqual(quick(R("pScore", "gte", 5)), ["n1", "n2"]);
  assert.deepEqual(quick(R("pScore", "lt", 0)), ["n3"]);
  assert.deepEqual(quick(R("pScore", "lte", "5,0")), ["n1", "n3"]);
  assert.deepEqual(quick(R("pScore", "is_empty")), ["n4", "n5"]);
  assert.deepEqual(quick(R("pScore", "is_not_empty")), ["n1", "n2", "n3"]);
});
test("counts, ID and rollups filter as numbers", () => {
  assert.deepEqual(quick(R("pWords", "gt", 50)), ["n1"]);
  assert.deepEqual(quick(R("pId", "gte", 4)), ["n4", "n5"]);
  assert.deepEqual(quick(R("pPending", "eq", 1)), ["n1"]);
  assert.deepEqual(operatorsFor("rollup"), operatorsFor("number"));
});

// ---- Select / status -----------------------------------------------------------------------------------
test("select is / is_not / any_of / none_of / empty (deleted option = empty)", () => {
  assert.deepEqual(quick(R("pType", "is", "idea")), ["n2"]);
  assert.deepEqual(quick(R("pType", "is_not", "idea")), ["n1", "n3", "n4", "n5"]);
  assert.deepEqual(quick(R("pType", "any_of", ["idea", "plan"])), ["n2", "n3"]);
  assert.deepEqual(quick(R("pType", "none_of", ["idea", "plan"])), ["n1", "n4", "n5"]);
  assert.deepEqual(quick(R("pType", "is_empty")), ["n4", "n5"]);
  assert.deepEqual(quick(R("pType", "is_not_empty")), ["n1", "n2", "n3"]);
});
test("status groups", () => {
  assert.deepEqual(quick(R("pStatus", "is", "group:done")), ["n3", "n4"]);
  assert.deepEqual(quick(R("pStatus", "any_of", ["group:todo", "dev"])), ["n1", "n2"]);
  assert.deepEqual(quick(R("pStatus", "none_of", ["group:done"])), ["n1", "n2", "n5"]);
});

// ---- Multi / tags / relation -------------------------------------------------------------------------------
test("multi-select contains / not / all_of / empty", () => {
  assert.deepEqual(quick(R("pMulti", "contains", ["b"])), ["n1", "n2"]);
  assert.deepEqual(quick(R("pMulti", "any_of", ["a", "c"])), ["n1", "n3"]);
  assert.deepEqual(quick(R("pMulti", "not_contains", ["b"])), ["n3", "n4", "n5"]);
  assert.deepEqual(quick(R("pMulti", "all_of", ["a", "b"])), ["n1"]);
  assert.deepEqual(quick(R("pMulti", "is_empty")), ["n4", "n5"]);
  assert.deepEqual(quick(R("pMulti", "contains", ["zzz-deleted"])), []);
});
test("tags (case and # ignored)", () => {
  assert.deepEqual(quick(R("pTags", "contains", ["#TRABAJO"])), ["n1", "n2"]);
  assert.deepEqual(quick(R("pTags", "all_of", ["trabajo", "personal"])), ["n2"]);
  assert.deepEqual(quick(R("pTags", "none_of", ["trabajo"])), ["n3", "n4", "n5"]);
  assert.deepEqual(quick(R("pTags", "is_not_empty")), ["n1", "n2"]);
});
test("relation by item id", () => {
  assert.deepEqual(quick(R("pTasks", "contains", ["t2"])), ["n1"]);
  assert.deepEqual(quick(R("pTasks", "is_empty")), ["n2", "n3", "n4", "n5"]);
});

// ---- Dates -------------------------------------------------------------------------------------------------
test("relative ranges (weeks start Monday)", () => {
  assert.deepEqual(withinRange("today", TODAY), ["2026-10-29", "2026-10-29"]);
  assert.deepEqual(withinRange("tomorrow", TODAY), ["2026-10-30", "2026-10-30"]);
  assert.deepEqual(withinRange("yesterday", TODAY), ["2026-10-28", "2026-10-28"]);
  assert.deepEqual(withinRange("this_week", TODAY), ["2026-10-26", "2026-11-01"]);
  assert.deepEqual(withinRange("this_week", "2026-11-01"), ["2026-10-26", "2026-11-01"]); // Sunday
  assert.deepEqual(withinRange("this_week", "2026-10-26"), ["2026-10-26", "2026-11-01"]); // Monday
  assert.deepEqual(withinRange("past_week", TODAY), ["2026-10-22", "2026-10-29"]);
  assert.deepEqual(withinRange("next_week", TODAY), ["2026-10-29", "2026-11-05"]);
  assert.deepEqual(withinRange("this_month", TODAY), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(withinRange("this_month", "2028-02-10"), ["2028-02-01", "2028-02-29"]);
  assert.deepEqual(withinRange("past_month", TODAY), ["2026-09-29", "2026-10-29"]);
  assert.deepEqual(withinRange("next_month", "2026-01-31"), ["2026-01-31", "2026-02-28"]);
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(withinRange("bogus", TODAY), null);
});
test("resolveDay and localDay", () => {
  assert.equal(resolveDay("today", TODAY), TODAY);
  assert.equal(resolveDay("yesterday", TODAY), "2026-10-28");
  assert.equal(resolveDay("2026-01-02", TODAY), "2026-01-02");
  assert.equal(resolveDay("nope", TODAY), null);
  assert.equal(localDay("2026-10-29T04:00:00Z", "America/Bogota"), "2026-10-28");
  assert.equal(localDay("2026-10-29T04:00:00Z", "UTC"), "2026-10-29");
  assert.equal(localDay("2026-10-29T04:00:00Z", "Not/AZone"), "2026-10-29");
  assert.equal(localDay("garbage", "UTC"), null);
});
test("date is / before / after / on_or_* (ranges overlap)", () => {
  assert.deepEqual(quick(R("pReview", "is", "2026-10-29")), ["n1", "n2"]);
  assert.deepEqual(quick(R("pReview", "is", "today")), ["n1", "n2"]);
  assert.deepEqual(quick(R("pReview", "before", "2026-10-29")), ["n2"]);
  assert.deepEqual(quick(R("pReview", "after", "2026-10-29")), ["n2"]);
  assert.deepEqual(quick(R("pReview", "after", "2026-11-02")), []);
  assert.deepEqual(quick(R("pReview", "on_or_after", "2026-11-02")), ["n2"]);
  assert.deepEqual(quick(R("pReview", "on_or_before", "2026-10-20")), ["n2"]);
  assert.deepEqual(quick(R("pReview", "is_empty")), ["n3", "n4", "n5"]);
});
test("date within", () => {
  assert.deepEqual(quick(R("pReview", "within", "today")), ["n1", "n2"]);
  assert.deepEqual(quick(R("pReview", "within", "next_month")), ["n1", "n2"]);
  assert.deepEqual(quick(R("pReview", "within", "tomorrow")), ["n2"]);
  assert.deepEqual(quick(R("pReview", "within", "yesterday")), ["n2"]);
});
test("created / edited use the user's timezone", () => {
  // n2 was edited 2026-10-29T04:00Z = Oct 28 in Bogotá
  assert.deepEqual(quick(R("pEdited", "is", "2026-10-28")), ["n1", "n2"]);
  assert.deepEqual(quick(R("pEdited", "within", "this_week")), ["n1", "n2", "n3", "n4"]);
  assert.deepEqual(quick(R("pCreated", "on_or_after", "2026-10-28")), ["n2"]);
});

// ---- Checkbox / kind --------------------------------------------------------------------------------------
test("checkbox", () => {
  assert.deepEqual(quick(R("pFav", "checked")), ["n1"]);
  assert.deepEqual(quick(R("pFav", "unchecked")), ["n2", "n3", "n4", "n5"]);
});
test("kind (hide block notes)", () => {
  assert.deepEqual(quick(R("pKind", "is_not", "block")), ["n1", "n2", "n3", "n5"]);
  assert.deepEqual(quick(R("pKind", "is", "subpage")), ["n3"]);
  assert.deepEqual(quick(R("pKind", "is", ["subpage", "block"])), ["n3", "n4"]);
});

// ---- AND / OR groups ------------------------------------------------------------------------------------------
test("quick chips are AND", () => assert.deepEqual(quick(R("pMulti", "contains", ["b"]), R("pFav", "unchecked")), ["n2"]));
test("advanced OR", () => assert.deepEqual(ids({ advanced: G("or", R("pType", "is", "idea"), R("pFav", "checked")) }).sort(), ["n1", "n2"]));
test("advanced AND with nested OR", () => {
  const adv = G("and", R("pScore", "is_not_empty"), G("or", R("pStatus", "is", "group:done"), R("title", "contains", "idea")));
  assert.deepEqual(ids({ advanced: adv }).sort(), ["n2", "n3"]);
});
test("advanced OR with nested AND", () => {
  const adv = G("or", G("and", R("pType", "is", "reunion"), R("pFav", "checked")), R("pKind", "is", "block"));
  assert.deepEqual(ids({ advanced: adv }).sort(), ["n1", "n4"]);
});
test("inactive rules in OR are ignored (not 'true')", () => {
  assert.deepEqual(ids({ advanced: G("or", R("pType", "is", "idea"), R("title", "contains", "")) }), ["n2"]);
  assert.equal(ids({ advanced: G("or", R("title", "contains", "")) }).length, 5);
  assert.equal(ids({ advanced: G("and", G("or")) }).length, 5);
});
test("quick + advanced + search together", () => {
  assert.deepEqual(ids({ search: "a", quick: [R("pKind", "is_not", "block")], advanced: G("or", R("pScore", "gt", 0), R("pStatus", "is", "lista")), sorts: [{ prop: "pScore", dir: "asc" }] }), ["n3", "n1", "n2"]);
});
test("countActiveRules / isFiltering", () => {
  const adv = G("and", R("pScore", "gt", 1), G("or", R("title", "contains", ""), R("pFav", "checked")));
  assert.equal(countActiveRules(adv, props), 2);
  assert.equal(isFiltering(view({}), props), false);
  assert.equal(isFiltering(view({ quick: [R("pType", "any_of", [])] }), props), false);
  assert.equal(isFiltering(view({ search: "x" }), props), true);
  assert.equal(isFiltering(view({ advanced: adv }), props), true);
});

// ---- Board groups ----------------------------------------------------------------------------------------------
test("groupNotes: No <prop> first, unknown options there too", () => {
  const typeProp = props.find((p) => p.id === "pType")!;
  const g = groupNotes(notes, typeProp, props);
  assert.deepEqual(g.map((x) => x.id), [null, "idea", "plan", "reunion"]);
  assert.equal(g[0].name, "No Type");
  assert.deepEqual(g[0].notes.map((n) => n.id), ["n4", "n5"]);
  assert.deepEqual(g[3].notes.map((n) => n.id), ["n1"]);
  const st = groupNotes(notes, props.find((p) => p.id === "pStatus")!, props);
  assert.deepEqual(st.map((x) => x.id), [null, "inbox", "dev", "lista", "arch"]);
  assert.equal(st.reduce((n, x) => n + x.notes.length, 0), notes.length);
});

// ---- Saved views -------------------------------------------------------------------------------------------------
test("sanitizeView: garbage → default", () => {
  assert.deepEqual(sanitizeView(null, props), defaultView(props));
  assert.deepEqual(sanitizeView("x", props), defaultView(props));
  assert.deepEqual(sanitizeView({ layout: "weird" }, props).layout, "table");
});
test("sanitizeView: deleted properties and bad ops are dropped", () => {
  const raw = {
    layout: "board",
    search: "hi",
    quick: [R("gone", "is", "x"), R("pType", "gt", 3), R("pType", "is", "idea"), { nope: true }],
    advanced: G("or", R("gone", "is", "x"), R("pFav", "checked"), G("and", R("pScore", "gt", 2), R("gone2", "is", 1))),
    sorts: [{ prop: "gone", dir: "asc" }, { prop: "pScore", dir: "desc" }, { prop: "pScore", dir: "asc" }, { prop: "title", dir: "sideways" }],
    groupBy: "pText",
    visible: ["pText", "gone", "pText", "pFav"],
    widths: { pText: 5000, gone: 100, title: 30, pFav: "wide" },
  };
  const v = sanitizeView(raw, props);
  assert.equal(v.layout, "board");
  assert.equal(v.search, "hi");
  assert.deepEqual(v.quick.map((r) => `${r.prop}:${r.op}`), ["pType:is"]);
  assert.equal(v.advanced?.items.length, 2);
  assert.equal((v.advanced?.items[1] as FilterGroup).items.length, 1);
  assert.deepEqual(v.sorts, [{ prop: "pScore", dir: "desc" }, { prop: "title", dir: "asc" }]);
  assert.equal(v.groupBy, "pStatus"); // a text property can't group a board
  assert.deepEqual(v.visible, ["pText", "pFav"]);
  assert.deepEqual(v.widths, { pText: 1000, title: 60 });
});
test("sanitizeView survives 0 properties", () => {
  const v = sanitizeView({ visible: ["x"], quick: [R("title", "contains", "a")] }, []);
  assert.deepEqual(v.visible, []);
  assert.equal(v.groupBy, null);
  assert.equal(v.quick.length, 1);
  assert.deepEqual(applyView([], [], v, TODAY, TZ), []);
});

// ---- Helpers ------------------------------------------------------------------------------------------------------
test("newRule picks a sensible operator", () => {
  assert.equal(newRule(props[0]).op, "any_of");
  assert.equal(newRule("title").op, "contains");
  assert.equal(newRule(props.find((p) => p.id === "pFav")!).op, "checked");
  assert.equal(newRule(props.find((p) => p.id === "pReview")!).op, "within");
});
test("valuesFromView: simple 'is' filters become the new note's values", () => {
  const v = view({ quick: [R("pStatus", "any_of", ["inbox"]), R("pType", "any_of", ["idea", "plan"]), R("pFav", "checked"), R("pTags", "contains", ["trabajo"]), R("pReview", "is", "today"), R("pStatus", "is", "group:done")] });
  assert.deepEqual(valuesFromView(v, props, TODAY), { pStatus: "inbox", pFav: true, pTags: ["trabajo"], pReview: { start: TODAY } });
});
test("cardHasValue hides empty things", () => {
  const p = (id: string) => props.find((x) => x.id === id)!;
  assert.equal(cardHasValue(notes[0], p("pFav"), props), true);
  assert.equal(cardHasValue(notes[1], p("pFav"), props), false);
  assert.equal(cardHasValue(notes[3], p("pType"), props), false); // deleted option
  assert.equal(cardHasValue(notes[4], p("pWords"), props), false);
  assert.equal(cardHasValue(notes[0], p("pPending"), props), true);
  assert.equal(cardHasValue(notes[1], p("pPending"), props), false);
});
test("1000 notes stay fast", () => {
  const many = Array.from({ length: 1000 }, (_, i) => N(`m${i}`, { title: `Note ${i} acción`, values: { pScore: i % 37, pType: ["idea", "plan", "reunion"][i % 3] }, updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), text: "lorem ipsum ".repeat(30) }));
  const t = performance.now();
  for (let k = 0; k < 20; k++) applyView(many, props, view({ search: "accion", quick: [R("pType", "any_of", ["idea", "plan"])], sorts: [{ prop: "pScore", dir: "desc" }, { prop: "title", dir: "asc" }] }), TODAY, TZ);
  const ms = (performance.now() - t) / 20;
  assert.ok(ms < 60, `took ${ms.toFixed(1)} ms per run`);
});

console.log(`${failed ? "✗" : "✓"} notes-db: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
