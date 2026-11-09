import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, ISO_DAY_SHORT, isoWeekday } from "@/lib/time";

/** Today's small "your week" box: the last 7 daily scores as bars, today's score so far, and the logging streak. */
export default async function TodayTile({ supabase, today }: { supabase: SupabaseClient; today: string }) {
  await supabase.rpc("refresh_my_daily_facts", { p_from: today, p_to: today });
  const { data } = await supabase
    .from("daily_scores")
    .select("date,score,unlogged")
    .gte("date", addDays(today, -60))
    .lte("date", today);
  const byDate = new Map(((data ?? []) as { date: string; score: number | null; unlogged: boolean }[]).map((r) => [r.date, r]));
  const logged = (d: string) => {
    const r = byDate.get(d);
    return Boolean(r && !r.unlogged && r.score !== null);
  };

  // Streak: days in a row with something marked. Today doesn't break it while the day is still going.
  let streak = 0;
  for (let d = logged(today) ? today : addDays(today, -1); logged(d); d = addDays(d, -1)) streak++;

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const todayScore = byDate.get(today);
  const score = todayScore && !todayScore.unlogged && todayScore.score !== null ? Math.round(Number(todayScore.score)) : null;

  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card" aria-label="Your week">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Your week</p>
          <p className="font-display text-3xl font-bold leading-none tabular-nums">
            {score ?? "—"}
            <span className="ml-2 text-sm font-medium text-muted">{score === null ? "nothing marked yet today" : "today so far"}</span>
          </p>
        </div>
        <p className="text-sm text-muted">
          {streak > 0 ? (
            <>
              <span className="font-semibold text-fg tabular-nums">{streak}</span> day{streak === 1 ? "" : "s"} in a row
            </>
          ) : (
            "No streak yet: mark a block, habit or task"
          )}
        </p>
      </div>
      <div className="mt-3 flex h-14 items-end gap-1.5" role="img" aria-label="Score of the last 7 days">
        {days.map((d) => {
          const r = byDate.get(d);
          const ok = logged(d);
          return (
            <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={ok ? `${d} · ${Math.round(Number(r?.score))}` : d}>
              <div
                className={`w-full rounded-sm ${ok ? "bg-accent" : "bg-subtle-2"}`}
                style={{ height: ok ? `${Math.max(10, Math.round(Number(r?.score)))}%` : "8%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[11px] text-faint">
        {days.map((d) => (
          <span key={d} className="flex-1">{ISO_DAY_SHORT[isoWeekday(d) - 1]}</span>
        ))}
      </div>
      <div className="mt-2 text-right">
        <Link href="/insights" className="text-sm font-medium text-muted transition-colors hover:text-accent">
          Open Insights
        </Link>
      </div>
    </section>
  );
}
