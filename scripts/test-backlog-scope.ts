// BL-100: core / add-on tag on Backlog items.
import { readFileSync } from "node:fs";
import { SCOPES, filterItems, scopeCounts, scopeOf, type BacklogItem } from "@/lib/backlog/board";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : (fail++, console.error("FAIL", name)); };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const item = (number: number, status: string, scope?: "core" | "addon") => ({ number, status, scope, title: `t${number}`, type: "feature", size: null, area: null, notes: null }) as unknown as BacklogItem;

// 1 default is core
ok("no scope = core", scopeOf({}) === "core" && scopeOf({ scope: null }) === "core" && scopeOf({ scope: undefined }) === "core");
ok("add-on is add-on", scopeOf({ scope: "addon" }) === "addon");
ok("only two values", SCOPES.length === 2 && SCOPES[0] === "core" && SCOPES[1] === "addon");
// 4 filter
const items = [item(1, "next"), item(2, "next", "addon"), item(3, "done", "addon"), item(4, "now", "core")];
ok("filter add-on", filterItems(items, { scope: "addon" }).map((i) => i.number).join() === "2,3");
ok("filter core (missing scope counts as core)", filterItems(items, { scope: "core" }).map((i) => i.number).join() === "1,4");
ok("no filter returns all", filterItems(items, {}).length === 4 && filterItems(items, { scope: "" }).length === 4);
ok("filter combines with the others", filterItems(items, { scope: "addon", q: "t3" }).map((i) => i.number).join() === "3");
// 5 counts: waiting = inbox/later/next/now; shipped = verifying/done; parked neither
const many = [item(1, "inbox"), item(2, "later", "addon"), item(3, "next", "addon"), item(4, "now"), item(5, "verifying", "addon"), item(6, "done"), item(7, "done", "addon"), item(8, "parked", "addon")];
const c = scopeCounts(many);
ok("core waiting 2 (inbox, now)", c.core.waiting === 2);
ok("core shipped 1 (done)", c.core.shipped === 1);
ok("add-on waiting 2 (later, next)", c.addon.waiting === 2);
ok("add-on shipped 2 (verifying, done)", c.addon.shipped === 2);
ok("parked counts as neither", c.addon.waiting + c.addon.shipped + c.core.waiting + c.core.shipped === 7);
// 6 database migration: column, constraint, view, counts, probe
const mig = read("supabase/migrations/0075_backlog_scope.sql");
ok("column defaults to core", /add column if not exists scope text not null default 'core'/.test(mig));
ok("constraint allows only core and addon", /check \(scope in \('core', 'addon'\)\)/.test(mig));
ok("overview keeps its columns and adds scope last", /verify_due,\s+i\.scope\s+from public\.backlog_items i/.test(mig));
ok("scope counts view exists", /create or replace view public\.backlog_scope_counts/.test(mig));
ok("probe exists", /function public\.tprobe_backlog_scope\(p_user uuid, p_since timestamptz\)/.test(mig));
// 7 wiring: a missing migration never breaks the board; the editor, chip and filter exist
const data = read("src/lib/backlog/data.ts");
ok("scope is read on its own and errors are ignored", /attachScope/.test(data) && /if \(error\) return;/.test(data));
ok("the main item query does not select scope", !/ITEM_COLUMNS =[^;]*scope/.test(read("src/lib/backlog/board.ts")));
ok("updateItem validates scope", /Scope must be core or add-on/.test(data));
ok("editor, row chip, filter and counts are wired", /Core or add-on/.test(read("src/components/backlog/ItemEditor.tsx")) && /SCOPE_LABEL/.test(read("src/components/backlog/ItemRow.tsx")) && /aria-label="Core or add-on"/.test(read("src/components/backlog/BacklogApp.tsx")) && /scopeCounts\(items\)/.test(read("src/components/backlog/BacklogApp.tsx")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
