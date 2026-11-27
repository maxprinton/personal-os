// BL-122: numbers for the Finance → Charts page (pure, no database).
// Rules (user decisions, 26 Nov 2026): transfers and deleted rows never get here; expenses without an account count;
// no category = "No category"; a deleted category = "Removed category"; "Adjustment" (balance differences) is always
// kept apart from real spending/income (its own gray segment); numbers match the monthly summary.
import { addDays } from "@/lib/time";
import { firstDay, monthOf, nextMonth, prevMonth } from "@/lib/finance-summary";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ChartTxn = { type: "income" | "expense"; amount: number; category_id: string | null; localDate: string };
export type ChartCat = { id: string; name: string };

export const MAX_MONTHS = 24;
export const TOP_CATEGORIES = 6;
const ADJUSTMENT = "adjustment";

export const isDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // 2026-02-31 is not a date
};
export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function daysInMonth(month: string) {
  return Number(addDays(firstDay(nextMonth(month)), -1).slice(8, 10));
}
export const lastDay = (month: string) => addDays(firstDay(nextMonth(month)), -1);

function monthsBack(month: string, n: number) {
  let m = month;
  for (let i = 0; i < n; i++) m = prevMonth(m);
  return m;
}

/** Months from the month of `from` to the month of `to`, both included. */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to) && out.length < 120; m = nextMonth(m)) out.push(m);
  return out;
}

/** Default: first day of the month 5 months ago → today. */
export const defaultRange = (today: string) => ({ from: firstDay(monthsBack(monthOf(today), 5)), to: today });

/** Reads the page's query. Bad or missing values fall back to the defaults; a reversed range is swapped; more than 24 months keeps the latest 24. */
export function parseChartQuery(q: { from?: string; to?: string; a?: string; b?: string }, today: string) {
  const d = defaultRange(today);
  let from = isDate(q.from) ? q.from : d.from;
  let to = isDate(q.to) ? q.to : d.to;
  if (from > to) [from, to] = [to, from];
  let capped = false;
  if (monthsInRange(from, to).length > MAX_MONTHS) {
    from = firstDay(monthsBack(monthOf(to), MAX_MONTHS - 1));
    capped = true;
  }
  const thisMonth = monthOf(today);
  const a = isMonth(q.a) && q.a <= thisMonth ? q.a : thisMonth;
  const b = isMonth(q.b) && q.b <= thisMonth ? q.b : prevMonth(a);
  return { from, to, a, b, capped };
}

/** Widest dates the page needs to read: the range plus both months of the line. */
export function neededSpan(p: { from: string; to: string; a: string; b: string }) {
  const starts = [p.from, firstDay(p.a), firstDay(p.b)].sort();
  const ends = [p.to, lastDay(p.a), lastDay(p.b)].sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

type Resolver = { adjIds: Set<string>; known: Set<string>; name: Map<string, string> };
function resolver(cats: ChartCat[]): Resolver {
  const adjIds = new Set(cats.filter((c) => c.name.trim().toLowerCase() === ADJUSTMENT).map((c) => c.id));
  return { adjIds, known: new Set(cats.map((c) => c.id)), name: new Map(cats.map((c) => [c.id, c.name])) };
}
/** Series key of a transaction's category: the id, "none" (no category) or "removed" (category was deleted). */
function keyOf(r: Resolver, id: string | null) {
  return id === null ? "none" : r.known.has(id) ? id : "removed";
}
const keyName = (r: Resolver, key: string) => (key === "none" ? "No category" : key === "removed" ? "Removed category" : r.name.get(key) ?? "Category");

// ───────────── Monthly buckets (charts B, C, D)

export type MonthBucket = {
  month: string;
  /** First and last day that count (the range can cut the month; the open month stops today). */
  from: string;
  to: string;
  partial: boolean;
  income: number; // real, without adjustments
  expense: number;
  adjIncome: number; // adjustments that added money
  adjExpense: number; // adjustments that removed money
  byCat: Record<string, number>; // real expenses by series key
};

export function monthlyBuckets(txns: ChartTxn[], cats: ChartCat[], from: string, to: string, today: string): MonthBucket[] {
  const r = resolver(cats);
  const end = to > today ? today : to;
  return monthsInRange(from, end < from ? from : end).map((month) => {
    const mFrom = from > firstDay(month) ? from : firstDay(month);
    const mTo = end < lastDay(month) ? end : lastDay(month);
    const b: MonthBucket = { month, from: mFrom, to: mTo, partial: mFrom > firstDay(month) || mTo < lastDay(month), income: 0, expense: 0, adjIncome: 0, adjExpense: 0, byCat: {} };
    for (const t of txns) {
      if (t.localDate < mFrom || t.localDate > mTo) continue;
      const adj = t.category_id !== null && r.adjIds.has(t.category_id);
      if (t.type === "income") {
        if (adj) b.adjIncome += t.amount;
        else b.income += t.amount;
      } else if (adj) b.adjExpense += t.amount;
      else {
        b.expense += t.amount;
        const k = keyOf(r, t.category_id);
        b.byCat[k] = (b.byCat[k] ?? 0) + t.amount;
      }
    }
    b.income = round2(b.income);
    b.expense = round2(b.expense);
    b.adjIncome = round2(b.adjIncome);
    b.adjExpense = round2(b.adjExpense);
    for (const k of Object.keys(b.byCat)) b.byCat[k] = round2(b.byCat[k]);
    return b;
  });
}

export type CategorySeries = { key: string; name: string; total: number; /** category ids behind it ("none" = no category); "else" lists all the rest */ ids: string[] };

/** The 6 biggest categories of the whole range keep their own series; everything else goes together as "Everything else". */
export function categorySeries(buckets: MonthBucket[], cats: ChartCat[], top = TOP_CATEGORIES): { series: CategorySeries[]; elseIds: string[] } {
  const r = resolver(cats);
  const totals = new Map<string, number>();
  for (const b of buckets) for (const [k, v] of Object.entries(b.byCat)) totals.set(k, (totals.get(k) ?? 0) + v);
  const sorted = [...totals.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  const series: CategorySeries[] = sorted.slice(0, top).map(([key, total]) => ({ key, name: keyName(r, key), total: round2(total), ids: [key] }));
  const rest = sorted.slice(top);
  const elseIds = rest.map(([k]) => k);
  if (rest.length) series.push({ key: "else", name: "Everything else", total: round2(rest.reduce((s, [, v]) => s + v, 0)), ids: elseIds });
  return { series, elseIds };
}

/** Value of one series in one month ("else" adds up the categories that were grouped). */
export function seriesValue(b: MonthBucket, s: CategorySeries) {
  return round2(s.ids.reduce((sum, k) => sum + (b.byCat[k] ?? 0), 0));
}

// ───────────── Cumulative spending of one month (chart A)

export type CumulativeLine = {
  month: string;
  /** Index 0 = day 1. null = a day that has not happened yet. */
  days: (number | null)[];
  /** Real spending so far (adjustments left out). */
  total: number;
  /** Last day counted (today for the open month, the last day otherwise). */
  throughDay: number;
  /** Adjustment expenses left out of the line, same days. */
  adjLeftOut: number;
};

export function cumulativeLine(txns: ChartTxn[], cats: ChartCat[], month: string, today: string): CumulativeLine {
  const r = resolver(cats);
  const n = daysInMonth(month);
  const open = monthOf(today) === month;
  const throughDay = open ? Number(today.slice(8, 10)) : n;
  const perDay = new Array<number>(n).fill(0);
  let adjLeftOut = 0;
  for (const t of txns) {
    if (t.type !== "expense" || monthOf(t.localDate) !== month) continue;
    const day = Number(t.localDate.slice(8, 10));
    if (day > throughDay) continue;
    if (t.category_id !== null && r.adjIds.has(t.category_id)) adjLeftOut += t.amount;
    else perDay[day - 1] += t.amount;
  }
  let run = 0;
  const days = perDay.map((v, i) => {
    run += v;
    return i + 1 <= throughDay ? round2(run) : null;
  });
  return { month, days, total: round2(run), throughDay, adjLeftOut: round2(adjLeftOut) };
}

/** "Month A $X vs Month B $Y on the same day": the day is the last one counted in A (B is clamped to its own length). */
export function compareSameDay(a: CumulativeLine, b: CumulativeLine) {
  const day = a.throughDay;
  const at = (l: CumulativeLine) => {
    for (let i = Math.min(day, l.days.length) - 1; i >= 0; i--) if (l.days[i] !== null) return l.days[i] as number;
    return 0;
  };
  const av = at(a);
  const bv = at(b);
  return { day, a: av, b: bv, diff: round2(av - bv) };
}

// ───────────── Links to the movements list

export type MovementsQuery = { from: string; to: string; type?: "income" | "expense"; cats?: string[]; adj?: "only" | "exclude" };

export function movementsHref(q: MovementsQuery) {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.type) p.set("type", q.type);
  if (q.cats && q.cats.length) p.set("cats", q.cats.join(","));
  if (q.adj) p.set("adj", q.adj);
  return `/finance/movements?${p.toString()}`;
}

/** Reads the movements page's query (bad values are ignored, never an error). */
export function parseMovementsQuery(q: { from?: string; to?: string; type?: string; cats?: string; adj?: string }, today: string) {
  const to = isDate(q.to) ? q.to : today;
  const from = isDate(q.from) ? q.from : firstDay(monthOf(to));
  const [f, t] = from > to ? [to, from] : [from, to];
  return {
    from: f,
    to: t,
    type: q.type === "income" || q.type === "expense" ? q.type : null,
    cats: q.cats ? q.cats.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : [],
    adj: q.adj === "only" || q.adj === "exclude" ? q.adj : null,
  } as { from: string; to: string; type: "income" | "expense" | null; cats: string[]; adj: "only" | "exclude" | null };
}

/** Does a transaction belong to a movements query? (the page filters with this, the tests check it) */
export function matchesMovements(t: ChartTxn, q: ReturnType<typeof parseMovementsQuery>, cats: ChartCat[]) {
  if (t.localDate < q.from || t.localDate > q.to) return false;
  if (q.type && t.type !== q.type) return false;
  const r = resolver(cats);
  const isAdj = t.category_id !== null && r.adjIds.has(t.category_id);
  if (q.adj === "only" && !isAdj) return false;
  if (q.adj === "exclude" && isAdj) return false;
  if (q.cats.length && !q.cats.includes(keyOf(r, t.category_id)) && !(t.category_id !== null && q.cats.includes(t.category_id))) return false;
  return true;
}
