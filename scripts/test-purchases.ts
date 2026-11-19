// BL-116 Needs & Wants: parser, duplicate rule, order moves, totals, adding (fake database) and the Telegram replies.
// Fake database, nothing is sent. Run: npm run test:purchases
import { fakeDb, type Row } from "./fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boughtOf,
  captureReply,
  dupKey,
  findOpenDuplicate,
  isCaptureHelp,
  isMissingTable,
  listOf,
  moveStep,
  moveTo,
  nextPosition,
  normName,
  parseCapture,
  parsePrice,
  totals,
  type PurchaseItem,
} from "@/lib/purchases/rules";
import { addPurchase, listPurchases, saveOrder } from "@/lib/purchases/data";
import { handlePurchaseCapture } from "@/lib/bot/purchases";
import type { Ctx } from "@/lib/bot/core";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- Parser --------------------------------------------------------------------------------
ok("need: sandals 25", eq(parseCapture("need: sandals 25"), { kind: "need", name: "sandals", price: 25 }));
ok("want: with $ and decimals", eq(parseCapture("want: headphones $79.99"), { kind: "want", name: "headphones", price: 79.99 }));
ok("comma decimals", eq(parseCapture("need: shoes 25,50"), { kind: "need", name: "shoes", price: 25.5 }));
ok("no price", eq(parseCapture("need: pants"), { kind: "need", name: "pants", price: null }));
ok("number inside the name stays in the name", eq(parseCapture("want: 2 notebooks for class"), { kind: "want", name: "2 notebooks for class", price: null }));
ok("number in the name + price at the end", eq(parseCapture("want: iphone 15 case 12"), { kind: "want", name: "iphone 15 case", price: 12 }));
ok("only a number: kept as the name", eq(parseCapture("need: 25"), { kind: "need", name: "25", price: null }));
ok("/need command", eq(parseCapture("/need cat food 18"), { kind: "need", name: "cat food", price: 18 }));
ok("/want@Bot command", eq(parseCapture("/want@MyOsBot a new chair 60"), { kind: "want", name: "a new chair", price: 60 }));
ok("capitals and spaces", eq(parseCapture("  NEED :   new    pants   30 "), { kind: "need", name: "new pants", price: 30 }));
ok("price 0 is not a price", eq(parseCapture("need: gift 0"), { kind: "need", name: "gift 0", price: null }));
ok("not a capture: needed", parseCapture("needed: x") === null);
ok("not a capture: plain text", parseCapture("I need sandals") === null);
ok("not a capture: empty", parseCapture("need:   ") === null);
ok("idea: is not ours", parseCapture("idea: need a list") === null);
ok("/need alone is help", isCaptureHelp("/need") && isCaptureHelp("/want@Bot") && !isCaptureHelp("/need pants"));

// ---- Prices ---------------------------------------------------------------------------------
ok("price empty -> null", parsePrice("") === null && parsePrice("  ") === null);
ok("price 1,234.50", parsePrice("1,234.50") === 1234.5);
ok("price $12", parsePrice("$12") === 12);
ok("price bad -> NaN", Number.isNaN(parsePrice("abc")) && Number.isNaN(parsePrice("-5")) && Number.isNaN(parsePrice("0")));

// ---- Names and duplicates --------------------------------------------------------------------
ok("normName collapses spaces", normName("  new   pants ") === "new pants");
ok("dupKey ignores case and spaces", dupKey(" New  Pants") === dupKey("new pants"));
let k = 0;
const it = (o: Partial<PurchaseItem>): PurchaseItem => ({
  id: `p${++k}`, name: "x", price: null, kind: "want", status: "open", position: 0, transaction_id: null, source: "web",
  bought_at: null, created_at: `2026-11-1${k % 10}T00:00:00Z`, ...o,
});
const items = [
  it({ id: "a", name: "Sandals", kind: "need", position: 1, price: 25 }),
  it({ id: "b", name: "Pants", kind: "need", position: 0 }),
  it({ id: "c", name: "Headphones", kind: "want", position: 0, price: 80 }),
  it({ id: "d", name: "Shirt", kind: "need", status: "bought", bought_at: "2026-11-10T00:00:00Z" }),
  it({ id: "e", name: "Socks", kind: "want", status: "bought", bought_at: "2026-11-12T00:00:00Z" }),
];
ok("duplicate found (case)", findOpenDuplicate(items, " sandals ")?.id === "a");
ok("bought items don't count as duplicates", findOpenDuplicate(items, "shirt") === null);
ok("an item is not its own duplicate", findOpenDuplicate(items, "Sandals", "a") === null);

// ---- Lists, order, totals ---------------------------------------------------------------------
ok("Needed in position order", eq(listOf(items, "need").map((i) => i.id), ["b", "a"]));
ok("Wanted list", eq(listOf(items, "want").map((i) => i.id), ["c"]));
ok("Bought newest first", eq(boughtOf(items).map((i) => i.id), ["e", "d"]));
ok("totals: sum and no-price count", eq(totals(listOf(items, "need")), { count: 2, sum: 25, noPrice: 1 }));
ok("next position goes to the bottom", nextPosition(items, "need") === 2 && nextPosition([], "want") === 0);
ok("move up", eq(moveStep(["x", "y", "z"], "z", "up"), ["x", "z", "y"]));
ok("move down", eq(moveStep(["x", "y", "z"], "x", "down"), ["y", "x", "z"]));
ok("move at the edge does nothing", eq(moveStep(["x", "y"], "x", "up"), ["x", "y"]) && eq(moveStep(["x", "y"], "y", "down"), ["x", "y"]));
ok("drag down onto another item", eq(moveTo(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]));
ok("drag up onto another item", eq(moveTo(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]));
ok("drag onto itself does nothing", eq(moveTo(["a", "b"], "a", "a"), ["a", "b"]));

// ---- Errors -------------------------------------------------------------------------------------
ok("missing table detected", isMissingTable({ code: "42P01" }) && isMissingTable({ code: "PGRST205" }) && !isMissingTable({ code: "23505" }));

// ---- Adding (fake database) --------------------------------------------------------------------
const U = "user-1";
const tables: Record<string, Row[]> = { purchase_items: [] };
const db = fakeDb(tables, { purchase_items: { status: "open", transaction_id: null, bought_at: null, deleted_at: null } }) as unknown as SupabaseClient;
{
  const r1 = await addPurchase(db, U, { name: " sandals ", price: 25, kind: "need", source: "web" });
  ok("add: saved", r1.ok && r1.item.name === "sandals" && r1.item.position === 0 && r1.countInList === 1, JSON.stringify(r1));
  const r2 = await addPurchase(db, U, { name: "pants", price: null, kind: "need", source: "telegram" });
  ok("add: second goes to the bottom", r2.ok && r2.item.position === 1 && r2.countInList === 2 && r2.item.source === "telegram");
  const r3 = await addPurchase(db, U, { name: "SANDALS", price: 30, kind: "want", source: "web" });
  ok("add: duplicate refused (other list, other case)", !r3.ok && /already on your Needed list/.test(r3.error), JSON.stringify(r3));
  const r4 = await addPurchase(db, U, { name: "   ", price: null, kind: "want", source: "web" });
  ok("add: empty name refused", !r4.ok);
  const r5 = await addPurchase(db, U, { name: "chair", price: -3, kind: "want", source: "web" });
  ok("add: negative price refused", !r5.ok);
  tables.purchase_items.push({ id: "other", user_id: "someone-else", name: "lamp", kind: "need", status: "open", position: 0, deleted_at: null, created_at: "2026-11-01" });
  const r6 = await addPurchase(db, U, { name: "lamp", price: null, kind: "need", source: "web" });
  ok("add: another user's item is not a duplicate", r6.ok);
  const list = await listPurchases(db, U);
  ok("list: only my items", list.items.length === 3 && list.items.every((i) => i.name !== "lamp" || i.id !== "other"));
  ok("list: prices are numbers", list.items.find((i) => i.name === "sandals")?.price === 25);
  const need = listOf(list.items, "need").map((i) => i.id);
  const err = await saveOrder(db, U, "need", [...need].reverse());
  const after = listOf((await listPurchases(db, U)).items, "need").map((i) => i.id);
  ok("saveOrder reverses the list", !err && eq(after, [...need].reverse()), `${need} -> ${after}`);
}

// ---- Telegram replies ------------------------------------------------------------------------------
{
  const t2: Record<string, Row[]> = { purchase_items: [] };
  const c = { admin: fakeDb(t2, { purchase_items: { status: "open", transaction_id: null, deleted_at: null } }), userId: U, chatId: 1, tz: "America/Guayaquil", today: "2026-11-19", nowMin: 600 } as unknown as Ctx;
  const a = await handlePurchaseCapture(c, parseCapture("need: sandals 25")!);
  ok("telegram: saved reply", /Added to Needed: sandals · \$25\.00 \(1 in Needed\)/.test(a.text), a.text);
  ok("telegram: source is telegram", t2.purchase_items[0]?.source === "telegram");
  const b = await handlePurchaseCapture(c, parseCapture("want: Sandals")!);
  ok("telegram: duplicate reply", /already on your Needed list/.test(b.text), b.text);
  const h = await handlePurchaseCapture(c, "help");
  ok("telegram: help", /need: sandals 25/.test(h.text));
  ok("reply without price", !/\$/.test(captureReply({ name: "pants", price: null, kind: "want" }, 2)));
}

console.log(`\npurchases BL-116: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
