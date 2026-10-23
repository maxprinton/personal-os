import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getHabitSummaries, getMetrics } from "@/lib/habits";
import { addDays, describeDays, formatMinutes, localNow, timeToMinutes } from "@/lib/time";
import { addStarterMetrics, deleteMetric } from "@/app/habit-actions";
import Nav from "@/components/Nav";
import HabitControls from "@/components/HabitControls";
import MetricWidget from "@/components/MetricWidget";
import MetricForm from "@/components/MetricForm";

export const dynamic = "force-dynamic";

const CELL: Record<string, string> = {
  completed: "bg-green-600",
  skipped: "bg-amber-400",
  failed: "bg-red-500",
};

export default async function HabitsPage() {
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const [habits, { metrics, values }] = await Promise.all([
    getHabitSummaries(supabase, today),
    getMetrics(supabase, today, 7),
  ]);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  return (
    <>
      <Nav active="/habits" />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <section className="space-y-3">
          <div>
            <h1 className="text-2xl font-semibold">Habits</h1>
            <p className="text-sm text-neutral-500">
              Time blocks marked &quot;Track as habit&quot;. A miss breaks the streak; a skip with a reason does not.
            </p>
          </div>
          {habits.length === 0 && (
            <p className="text-sm text-neutral-500">
              No habits yet. Create a <Link href="/blocks" className="underline">time block</Link> and tick
              &quot;Track as habit&quot;.
            </p>
          )}
          <ul className="space-y-3">
            {habits.map((h) => (
              <li key={h.block.id} className="space-y-3 rounded-lg border border-neutral-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{h.block.title}</p>
                    <p className="text-sm text-neutral-500">
                      {formatMinutes(timeToMinutes(h.block.start_time))} · {describeDays(h.block.rrule)}
                    </p>
                  </div>
                  <div className="flex gap-4 text-right">
                    <div>
                      <p className="text-2xl font-semibold">{h.current}</p>
                      <p className="text-xs text-neutral-500">streak</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-neutral-400">{h.best}</p>
                      <p className="text-xs text-neutral-500">best</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-neutral-400">{h.rate === null ? "—" : `${h.rate}%`}</p>
                      <p className="text-xs text-neutral-500">30 days</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1" aria-label="Last 14 days">
                  {h.last14.map((d) => (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.due ? d.status ?? (d.date === today ? "pending" : "no log") : "not scheduled"}`}
                      className={`h-5 flex-1 rounded-sm ${
                        !d.due ? "bg-neutral-50" : d.status ? CELL[d.status] : d.date === today ? "border border-neutral-300" : "bg-neutral-200"
                      }`}
                    />
                  ))}
                </div>
                {h.dueToday ? (
                  <HabitControls blockId={h.block.id} status={h.todayStatus} reason={h.todayReason} />
                ) : (
                  <p className="text-sm text-neutral-400">Not scheduled today.</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold">Daily metrics</h2>
              <p className="text-sm text-neutral-500">Ambient numbers you log once a day.</p>
            </div>
            {metrics.length === 0 && (
              <form action={addStarterMetrics}>
                <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm">Add Water + Mood</button>
              </form>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.map((m) => (
              <MetricWidget key={m.id} metric={m} value={values.get(m.id)?.get(today)} />
            ))}
          </div>
          {metrics.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="py-1 pr-2 font-normal">Last 7 days</th>
                    {week.map((d) => (
                      <th key={d} className="px-1 py-1 text-right font-normal">{d.slice(5)}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.id} className="border-t border-neutral-100">
                      <td className="py-1 pr-2">{m.name} <span className="text-neutral-400">({m.unit})</span></td>
                      {week.map((d) => (
                        <td key={d} className="px-1 py-1 text-right">{values.get(m.id)?.get(d) ?? "·"}</td>
                      ))}
                      <td className="pl-2 text-right">
                        <form action={deleteMetric}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="text-xs text-neutral-400 hover:text-red-600">Remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <MetricForm />
        </section>
      </main>
    </>
  );
}
