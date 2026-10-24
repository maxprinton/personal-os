import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUserId, getBlockTypes } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { runMaintenance } from "@/lib/calendar/maintenance";
import { getHabitSummaries, type HabitSummary } from "@/lib/calendar/habits";
import { SKIP_LIMIT } from "@/lib/calendar/streaks";
import { getMetrics } from "@/lib/habits";
import { addDays, formatMinutes, localNow, timeToMinutes } from "@/lib/time";
import { addStarterMetrics, deleteMetric } from "@/app/habit-actions";
import Nav from "@/components/Nav";
import HabitControls from "@/components/HabitControls";
import { HabitEditRow, NewHabitForm } from "@/components/HabitEditors";
import MetricWidget from "@/components/MetricWidget";
import MetricForm from "@/components/MetricForm";

export const dynamic = "force-dynamic";

const CELL: Record<string, string> = {
  done: "bg-green-600",
  skipped: "bg-amber-400",
  missed: "bg-red-500",
};

function HabitCard({ h, blocks, today }: { h: HabitSummary; blocks: { id: string; name: string }[]; today: string }) {
  return (
    <li className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{h.habit.name}</p>
          <p className="text-xs text-neutral-500">
            Skips left in a row: {h.skipsLeft} of {SKIP_LIMIT}
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
            <p className="text-xs text-neutral-500">last 30</p>
          </div>
        </div>
      </div>
      {h.recent.length > 0 && (
        <div className="flex gap-1" aria-label="Last 14 times">
          {h.recent.map((d, i) => (
            <div
              key={`${d.date}-${i}`}
              title={`${d.date}: ${d.state ?? (d.date === today ? "pending" : "missed")}`}
              className={`h-5 flex-1 rounded-sm ${d.state ? CELL[d.state] : d.date === today ? "border border-neutral-300" : "bg-neutral-200"}`}
            />
          ))}
        </div>
      )}
      {h.today.length > 0 ? (
        <ul className="space-y-1">
          {h.today.map((t) => (
            <li key={t.occurrenceId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-500">Today {formatMinutes(timeToMinutes(t.start))}</span>
              <HabitControls habitId={h.habit.id} occurrenceId={t.occurrenceId} state={t.state} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-400">{h.blockName ? `${h.blockName} is not on the calendar today.` : "Not in a block yet."}</p>
      )}
      <HabitEditRow id={h.habit.id} name={h.habit.name} blockTypeId={h.habit.block_type_id} blocks={blocks} />
    </li>
  );
}

export default async function HabitsPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const timezone = await userTimezone(supabase, userId);
  await runMaintenance(supabase, userId, timezone);
  const today = localNow(timezone).date;
  const [habits, types, { metrics, values }] = await Promise.all([
    getHabitSummaries(supabase, userId, today),
    getBlockTypes(supabase, userId),
    getMetrics(supabase, today, 7),
  ]);
  const blocks = types.map((t) => ({ id: t.id, name: t.name }));
  const groups = [
    ...types.map((t) => ({ key: t.id, title: t.name, color: t.color, items: habits.filter((h) => h.habit.block_type_id === t.id) })),
    { key: "none", title: "Unscheduled", color: null as string | null, items: habits.filter((h) => !h.habit.block_type_id) },
  ].filter((g) => g.items.length > 0);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  return (
    <>
      <Nav active="/habits" />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <section className="space-y-3">
          <div>
            <h1 className="text-2xl font-semibold">Habits</h1>
            <p className="text-sm text-neutral-500">
              Habits live inside blocks: every time the block appears you get one mark. Skipping on purpose keeps the streak
              (up to {SKIP_LIMIT} in a row; the next one breaks it). Anything not marked by the end of the day counts as missed.
              Free days pause streaks.
            </p>
          </div>
          <NewHabitForm blocks={blocks} />
          {habits.length === 0 && (
            <p className="text-sm text-neutral-500">
              No habits yet. Add one above, or open a block in the <Link href="/calendar" className="underline">calendar</Link>.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-medium text-neutral-600">
                {g.color && <span className="h-3 w-3 rounded-full" style={{ background: g.color }} />}
                {g.title}
                {g.key === "none" && <span className="font-normal text-neutral-400">· place them in a block to start tracking</span>}
              </h2>
              <ul className="space-y-3">
                {g.items.map((h) => (
                  <HabitCard key={h.habit.id} h={h} blocks={blocks} today={today} />
                ))}
              </ul>
            </div>
          ))}
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
