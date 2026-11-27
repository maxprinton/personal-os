// BL-122: numbers of the Finance → Charts page.
import {
  categorySeries, compareSameDay, cumulativeLine, daysInMonth, defaultRange, matchesMovements, monthlyBuckets, monthsInRange,
  movementsHref, neededSpan, parseChartQuery, parseMovementsQuery, seriesValue, type ChartCat, type ChartTxn,
} from "@/lib/finance-charts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : (fail++, console.error("FAIL", name)); };
const eq = (name: string, a: unknown, b: unknown) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

const cats: ChartCat[] = [
  { id: "food", name: "Food" }, { id: "tr", name: "Transport" }, { id: "fun", name: "Fun" }, { id: "bills", name: "Bills & subs" },
  { id: "home", name: "Home" }, { id: "health", name: "Health" }, { id: "other", name: "Other" },
  { id: "adjE", name: "Adjustment" }, { id: "adjI", name: "adjustment" }, { id: "gigs", name: "Gigs" },
];
const x = (date: string, amount: number, category_id: string | null, type: "income" | "expense" = "expense"): ChartTxn => ({ type, amount, category_id, localDate: date });

// ── ranges and queries
eq("default range", defaultRange("2026-11-26"), { from: "2026-06-01", to: "2026-11-26" });
eq("months in range", monthsInRange("2026-10-23", "2026-11-26"), ["2026-10", "2026-11"]);
eq("days in Feb 2028", daysInMonth("2028-02"), 29);
const q0 = parseChartQuery({}, "2026-11-26");
eq("empty query = defaults", [q0.from, q0.to, q0.a, q0.b, q0.capped], ["2026-06-01", "2026-11-26", "2026-11", "2026-10", false]);
const q1 = parseChartQuery({ from: "2026-11-20", to: "2026-10-01", a: "2026-09", b: "garbage" }, "2026-11-26");
eq("reversed range is swapped, bad B = month before A", [q1.from, q1.to, q1.a, q1.b], ["2026-10-01", "2026-11-20", "2026-09", "2026-08"]);
const q2 = parseChartQuery({ from: "2020-01-01", to: "2026-11-26", a: "2027-01" }, "2026-11-26");
eq("more than 24 months keeps the latest 24", [q2.from, q2.capped, q2.a], ["2024-12-01", true, "2026-11"]);
eq("not a real date is ignored", parseChartQuery({ from: "2026-02-31" }, "2026-11-26").from, "2026-06-01");
eq("span covers the range and both months", neededSpan({ from: "2026-10-23", to: "2026-11-26", a: "2026-11", b: "2026-05" }), { start: "2026-05-01", end: "2026-11-30" });

// ── November as it is today (expenses 142.06 with 28.44 of adjustments)
const nov: ChartTxn[] = [
  x("2026-11-02", 4.99, "bills"), x("2026-11-11", 8.99, "bills"), x("2026-11-13", 24, "bills"), x("2026-11-25", 9, "bills"), // 46.98
  x("2026-11-12", 14, "adjE"), x("2026-11-12", 2.22, "adjE"), x("2026-11-16", 0.17, "adjE"), x("2026-11-16", 1.35, "adjE"), x("2026-11-16", 7.3, "adjE"), x("2026-11-12", 3.4, "adjE"), // 28.44
  x("2026-11-12", 1.5, "fun"), x("2026-11-14", 6, "fun"), x("2026-11-24", 6, "fun"), x("2026-11-01", 7, "fun"), // 20.50
  x("2026-11-24", 19, "home"),
  x("2026-11-26", 4, "tr"), x("2026-11-26", 2.6, "tr"),
  x("2026-11-26", 0.41, "other"),
  x("2026-11-12", 30.56, "adjI", "income"), x("2026-11-24", 100, "gigs", "income"),
];
const oct: ChartTxn[] = [x("2026-10-25", 3.5, "tr"), x("2026-10-26", 15, "fun"), x("2026-10-28", 3.7, "adjE"), x("2026-10-28", 7.5, null), x("2026-10-30", 5, "gone")];
const all = [...oct, ...nov];

const b = monthlyBuckets(all, cats, "2026-10-23", "2026-11-26", "2026-11-26");
eq("two months", b.map((m) => m.month), ["2026-10", "2026-11"]);
const bn = b[1];
eq("Nov real expense = total - adjustments", bn.expense, round(46.98 + 20.5 + 19 + 6.6 + 0.41));
eq("Nov adjustment expense", bn.adjExpense, 28.44);
eq("Nov adjustment income apart from real income", [bn.income, bn.adjIncome], [100, 30.56]);
ok("Nov is partial (open month)", bn.partial === true && bn.to === "2026-11-26" && bn.from === "2026-11-01");
ok("Oct is partial (range starts on the 23rd)", b[0].partial === true && b[0].from === "2026-10-23" && b[0].to === "2026-10-31");
eq("no category and removed category are their own series", [b[0].byCat.none, b[0].byCat.removed], [7.5, 5]);
ok("adjustment never inside a category", bn.byCat.adjE === undefined && b[0].byCat.adjE === undefined);
const wholeMonths = monthlyBuckets(all, cats, "2026-10-01", "2026-10-31", "2026-11-26");
ok("a whole closed month is not partial", wholeMonths.length === 1 && wholeMonths[0].partial === false);
eq("dates in the future are not drawn", monthlyBuckets(all, cats, "2026-11-01", "2026-12-31", "2026-11-26").map((m) => m.month), ["2026-11"]);
eq("empty data gives empty buckets, no crash", monthlyBuckets([], cats, "2026-10-01", "2026-11-26", "2026-11-26").map((m) => m.expense), [0, 0]);

// ── category series
const cs = categorySeries(b, cats);
ok("at most 6 + else", cs.series.length <= 7);
eq("biggest first", cs.series[0].key, "bills");
const cs3 = categorySeries(b, cats, 3);
eq("rest is 'Everything else' (never 'Other')", cs3.series[cs3.series.length - 1].name, "Everything else");
eq("else adds up the grouped ones", seriesValue(bn, cs3.series[cs3.series.length - 1]), round(bn.expense - cs3.series.slice(0, -1).reduce((s, v) => s + seriesValue(bn, v), 0)));
eq("series totals add up to all real expenses", round(categorySeries(b, cats, 3).series.reduce((s, v) => s + v.total, 0)), round(b.reduce((s, m) => s + m.expense, 0)));
eq("names", categorySeries(b, cats).series.find((s) => s.key === "none")?.name, "No category");

// ── cumulative line
const a = cumulativeLine(all, cats, "2026-11", "2026-11-26");
ok("open month stops today", a.days.length === 30 && a.days[25] !== null && a.days[26] === null && a.throughDay === 26);
eq("total = real spending (adjustments left out)", a.total, bn.expense);
eq("adjustments left out are reported", a.adjLeftOut, 28.44);
ok("line never goes down", a.days.every((v, i) => v === null || i === 0 || (a.days[i - 1] as number) <= v));
const o = cumulativeLine(all, cats, "2026-10", "2026-11-26");
eq("a closed month is drawn whole", [o.days.length, o.throughDay, o.days[30]], [31, 31, o.total]);
const cmp = compareSameDay(a, o);
eq("compare on the same day (26)", [cmp.day, cmp.a, cmp.b], [26, a.total, o.days[25]]);
const feb = cumulativeLine([x("2026-02-10", 10, "food")], cats, "2026-02", "2026-11-26");
eq("a 28-day month is compared with a 30-day one without crashing", compareSameDay(a, feb).b, 10);

// ── movements links and filters
eq("href", movementsHref({ from: "2026-11-01", to: "2026-11-26", type: "expense", cats: ["fun"], adj: "exclude" }), "/finance/movements?from=2026-11-01&to=2026-11-26&type=expense&cats=fun&adj=exclude");
const mq = parseMovementsQuery({ from: "2026-11-01", to: "2026-11-26", type: "expense", cats: "fun", adj: "exclude" }, "2026-11-26");
eq("Fun list in Nov has the same total as the bar", round(nov.filter((t) => matchesMovements(t, mq, cats)).reduce((s, t) => s + t.amount, 0)), 20.5);
const adjOnly = parseMovementsQuery({ from: "2026-11-01", to: "2026-11-30", type: "expense", adj: "only" }, "2026-11-26");
eq("adjustments-only list = gray segment", round(nov.filter((t) => matchesMovements(t, adjOnly, cats)).reduce((s, t) => s + t.amount, 0)), 28.44);
const noCat = parseMovementsQuery({ from: "2026-10-01", to: "2026-10-31", type: "expense", cats: "none" }, "2026-11-26");
eq("'none' finds transactions without category", oct.filter((t) => matchesMovements(t, noCat, cats)).map((t) => t.amount), [7.5]);
const removed = parseMovementsQuery({ from: "2026-10-01", to: "2026-10-31", cats: "removed" }, "2026-11-26");
eq("'removed' finds deleted categories", oct.filter((t) => matchesMovements(t, removed, cats)).map((t) => t.amount), [5]);
const elseQ = parseMovementsQuery({ from: "2026-11-01", to: "2026-11-30", type: "expense", adj: "exclude", cats: cs3.elseIds.join(",") }, "2026-11-26");
eq("'Everything else' list = its bar", round(nov.filter((t) => matchesMovements(t, elseQ, cats)).reduce((s, t) => s + t.amount, 0)), seriesValue(bn, cs3.series[cs3.series.length - 1]));
eq("bad movements query falls back", [parseMovementsQuery({ from: "x", type: "zzz", adj: "q" }, "2026-11-26").from, parseMovementsQuery({ type: "zzz" }, "2026-11-26").type], ["2026-11-01", null]);

function round(n: number) { return Math.round(n * 100) / 100; }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
