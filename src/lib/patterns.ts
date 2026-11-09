// Patterns between your days (sleep vs mood, late nights vs energy...). Pure math plus one loader.
// Rules: a fixed list of hypotheses, each compared against your own days, at least 8 days in each group,
// a difference big enough to matter, "tends to" wording, and nothing at all until 28 logged days.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isoWeekday, utcToLocal } from "@/lib/time";
import { oneDecimal } from "@/lib/daily-facts";

export const UNLOCK_DAYS = 28;
export const MIN_GROUP = 8;

export type DayRow = {
  date: string;
  score: number | null;
  unlogged: boolean;
  free: boolean;
  mood: number | null;
  energy: number | null;
  /** Minutes slept that night (bedtime to wake-up). */
  sleepMin: number | null;
  /** Bedtime as minutes after 18:00 (23:30 -> 330, 01:00 -> 420). */
  bedAfter18: number | null;
  spent: number;
  /** Average focus of the blocks marked that day (1 to 3). */
  focus: number | null;
};

export type Pattern = { id: string; text: string; days: number };

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

type Cmp = { a: number[]; b: number[] };

/** Splits the days in two groups by `pick` (true / false / null = leave out) and collects `value`. */
function split(rows: DayRow[], pick: (r: DayRow) => boolean | null, value: (r: DayRow) => number | null): Cmp {
  const a: number[] = [];
  const b: number[] = [];
  for (const r of rows) {
    const g = pick(r);
    const v = value(r);
    if (g === null || v === null) continue;
    (g ? a : b).push(v);
  }
  return { a, b };
}

export function findPatterns(rows: DayRow[]): { unlocked: boolean; loggedDays: number; patterns: Pattern[] } {
  const logged = rows.filter((r) => !r.unlogged && r.score !== null);
  const loggedDays = logged.length;
  if (loggedDays < UNLOCK_DAYS) return { unlocked: false, loggedDays, patterns: [] };

  const out: Pattern[] = [];
  const enough = (c: Cmp) => c.a.length >= MIN_GROUP && c.b.length >= MIN_GROUP;
  const sleepGood = (r: DayRow) => (r.sleepMin === null ? null : r.sleepMin >= 7 * 60);

  const add = (id: string, c: Cmp, minDiff: number, words: (diff: number, hi: number, lo: number) => string) => {
    if (!enough(c)) return;
    const hi = mean(c.a);
    const lo = mean(c.b);
    if (Math.abs(hi - lo) < minDiff) return;
    out.push({ id, text: words(hi - lo, hi, lo), days: c.a.length + c.b.length });
  };
  const gap = (n: number) => oneDecimal(Math.abs(n));

  add("sleep-score", split(logged, sleepGood, (r) => r.score), 8, (d) =>
    `After 7 hours of sleep or more, your score tends to be ${gap(d)} points ${d > 0 ? "higher" : "lower"} than after less.`);
  add("sleep-mood", split(rows, sleepGood, (r) => r.mood), 1, (d) =>
    `After 7 hours of sleep or more, your mood tends to be ${gap(d)} points ${d > 0 ? "higher" : "lower"}.`);
  add("sleep-focus", split(rows, sleepGood, (r) => r.focus), 0.4, (d) =>
    `After 7 hours of sleep or more, your blocks tend to be ${d > 0 ? "more" : "less"} focused.`);
  add("late-energy", split(rows, (r) => (r.bedAfter18 === null ? null : r.bedAfter18 > 390), (r) => r.energy), 1, (d) =>
    `On days after going to bed past 00:30, your energy tends to be ${gap(d)} points ${d > 0 ? "higher" : "lower"}.`);
  add("weekend-score", split(logged.filter((r) => !r.free), (r) => isoWeekday(r.date) >= 6, (r) => r.score), 10, (d) =>
    `Your weekends tend to score ${gap(d)} points ${d > 0 ? "higher" : "lower"} than your weekdays.`);
  add("mood-spend", split(rows, (r) => (r.mood === null ? null : r.mood <= 5), (r) => (r.spent > 0 ? r.spent : 0)), 3, (d, hi, lo) =>
    `On low-mood days (5 or less) you tend to spend $${gap(d)} ${d > 0 ? "more" : "less"} ($${oneDecimal(hi)} vs $${oneDecimal(lo)}).`);

  return { unlocked: true, loggedDays, patterns: out };
}

// ---- Loading ----------------------------------------------------------------------------------

type Facts = { date: string; is_free_day: boolean; mood: number | null; energy: number | null; bedtime: string | null; wake_at: string | null; spent: number };

export function buildRows(
  facts: Facts[],
  scores: { date: string; score: number | null; unlogged: boolean }[],
  focus: { date: string; focus: number }[],
  tz: string
): DayRow[] {
  const sc = new Map(scores.map((s) => [s.date, s]));
  const fo = new Map<string, number[]>();
  for (const f of focus) fo.set(f.date, [...(fo.get(f.date) ?? []), f.focus]);
  return facts.map((f) => {
    const s = sc.get(f.date);
    const sleep = f.bedtime && f.wake_at ? Math.round((Date.parse(f.wake_at) - Date.parse(f.bedtime)) / 60000) : null;
    let bed: number | null = null;
    if (f.bedtime) {
      const m = utcToLocal(f.bedtime, tz).minutes;
      bed = m >= 18 * 60 ? m - 18 * 60 : m + 6 * 60;
    }
    const fx = fo.get(f.date);
    return {
      date: f.date,
      score: s?.score === null || s?.score === undefined ? null : Number(s.score),
      unlogged: s?.unlogged ?? true,
      free: f.is_free_day,
      mood: f.mood,
      energy: f.energy,
      sleepMin: sleep !== null && sleep > 0 && sleep < 18 * 60 ? sleep : null,
      bedAfter18: bed,
      spent: Number(f.spent ?? 0),
      focus: fx?.length ? mean(fx) : null,
    };
  });
}

/** Reads the last `days` days. Pass `userId` with the admin client (it skips RLS), leave it out for the signed-in client. */
export async function loadPatternRows(sb: SupabaseClient, from: string, to: string, tz: string, userId?: string): Promise<DayRow[]> {
  let f = sb.from("daily_facts").select("date,is_free_day,mood,energy,bedtime,wake_at,spent").gte("date", from).lte("date", to).order("date");
  let s = sb.from("daily_scores").select("date,score,unlogged").gte("date", from).lte("date", to);
  let o = sb.from("block_occurrences").select("date,focus").gte("date", from).lte("date", to).not("focus", "is", null);
  if (userId) {
    f = f.eq("user_id", userId);
    s = s.eq("user_id", userId);
    o = o.eq("user_id", userId);
  }
  const [facts, scores, focus] = await Promise.all([f, s, o]);
  return buildRows((facts.data ?? []) as Facts[], (scores.data ?? []) as never[], (focus.data ?? []) as never[], tz);
}
