import { createClient } from "@/lib/supabase/server";
import { getAgenda, getSettings, whatNow, type AgendaItem } from "@/lib/agenda";
import { formatDateLong, formatMinutes, localNow } from "@/lib/time";
import Link from "next/link";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import TaskRow, { type TaskRowData } from "@/components/TaskRow";
import { getContextFor } from "@/lib/links";
import { getTagsFor } from "@/lib/tags";
import { getHabitSummaries, getMetrics } from "@/lib/habits";
import HabitControls from "@/components/HabitControls";
import MetricWidget from "@/components/MetricWidget";
import QuickCapture from "@/components/QuickCapture";
import { markInsightRead } from "@/app/settings-actions";
import { getFinance } from "@/lib/finance";
import { budgetUsage, formatUSD, inRange, monthRange, totals } from "@/lib/money";

export const dynamic = "force-dynamic";

function range(i: AgendaItem) {
  return `${formatMinutes(i.start)} – ${formatMinutes(i.end % 1440)}`;
}

export default async function CommandCenter() {
  const supabase = await createClient();
  await supabase.rpc("rollover_my_tasks");
  const { timezone } = await getSettings(supabase);
  const now = localNow(timezone);
  const items = await getAgenda(supabase, now.date, timezone);
  const { activeEvent, activeBlock, next } = whatNow(items, now.minutes);
  const current = activeEvent ?? activeBlock;

  // Context: what is linked to the current block/event, or to an event starting in <= 5 minutes
  const soon = items.find(
    (i) => i.kind === "event" && i.start > now.minutes && i.start - now.minutes <= 5
  );
  const contextTargets = [activeEvent, activeBlock, soon]
    .filter((i): i is AgendaItem => Boolean(i))
    .map((i) => ({ type: i.kind === "event" ? ("event" as const) : ("time_block" as const), id: i.id }));
  const context = await getContextFor(supabase, contextTargets);
  const contextTasks = context.tasks.filter((t) => t.status === "pending");

  const { data: taskData } = await supabase
    .from("tasks")
    .select("id,title,status,rollover_policy,scheduled_for,rolled_over_count,is_habit")
    .is("deleted_at", null)
    .eq("status", "pending")
    .lte("scheduled_for", now.date)
    .order("scheduled_for")
    .order("created_at");
  const todayTasks = (taskData ?? []) as TaskRowData[];
  const taskTags = await getTagsFor(supabase, "task", todayTasks.map((t) => t.id));
  const [habits, { metrics, values }] = await Promise.all([
    getHabitSummaries(supabase, now.date),
    getMetrics(supabase, now.date, 1),
  ]);
  const habitsToday = habits.filter((h) => h.dueToday);
  const { data: insightData } = await supabase
    .from("system_insights")
    .select("id,insight_type,message")
    .eq("is_read", false)
    .is("deleted_at", null)
    .order("generated_at", { ascending: false })
    .limit(5);
  const insights = (insightData ?? []) as { id: string; insight_type: string; message: string }[];
  const finance = await getFinance(supabase, timezone);
  const monthSums = totals(finance.txns.filter((t) => inRange(t, monthRange(now.date))));
  const monthlyBudgets = finance.budgets.filter((b) => b.period === "monthly");
  const budgetTotal = monthlyBudgets.reduce((s, b) => s + b.limit_amount, 0);
  const budgetSpent = monthlyBudgets.reduce((s, b) => s + budgetUsage(b, finance.txns, now.date).spent, 0);

  let headline = "Free time";
  let detail = next ? `Next: ${next.title} at ${formatMinutes(next.start)}` : "Nothing else scheduled today.";
  if (current) {
    headline = current.title;
    const parts = [`Until ${formatMinutes(current.end % 1440)}`];
    if (activeEvent?.fulfills) parts.push(`fulfills your “${activeEvent.fulfills}” block`);
    else if (activeEvent && activeBlock) parts.push(`overlaps your “${activeBlock.title}” block`);
    else if (!activeEvent) parts.push("planned block");
    detail = parts.join(" · ");
  }

  return (
    <>
      <Nav active="/" />
      <AutoRefresh />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <section className="rounded-xl bg-neutral-900 p-6 text-white">
          <p className="text-xs uppercase tracking-wide text-neutral-400">
            What should I be doing right now? · {formatMinutes(now.minutes)}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">{headline}</h1>
          <p className="mt-1 text-neutral-300">{detail}</p>
        </section>

        <QuickCapture />

        {insights.length > 0 && (
          <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-medium text-amber-900">Chief of Staff</h2>
            <ul className="space-y-2">
              {insights.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="mr-1 text-xs uppercase text-amber-700">{i.insight_type}</span>
                    {i.message}
                  </span>
                  <form action={markInsightRead}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="shrink-0 text-xs text-amber-800 underline">Got it</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(contextTasks.length > 0 || context.notes.length > 0) && (
          <section className="space-y-2 rounded-xl border border-neutral-200 p-4">
            <h2 className="text-sm font-medium text-neutral-500">
              {soon && !current ? `Coming up: ${soon.title} at ${formatMinutes(soon.start)}` : "For this moment"}
            </h2>
            {contextTasks.length > 0 && (
              <ul className="space-y-1 text-sm">
                {contextTasks.map((t) => (
                  <li key={t.id}>Task · {t.title}</li>
                ))}
              </ul>
            )}
            {context.notes.length > 0 && (
              <ul className="space-y-1 text-sm">
                {context.notes.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`} className="underline">Note · {n.title || "Untitled"}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-500">Today&apos;s tasks ({todayTasks.length})</h2>
            <Link href="/tasks" className="text-sm text-neutral-500 hover:text-neutral-900">All tasks →</Link>
          </div>
          {todayTasks.length ? (
            <ul className="space-y-2">
              {todayTasks.map((t) => (
                <TaskRow key={t.id} task={t} tags={taskTags.get(t.id)} today={now.date} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-400">No tasks left for today.</p>
          )}
        </section>

        {habitsToday.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-500">Habits today</h2>
              <Link href="/habits" className="text-sm text-neutral-500 hover:text-neutral-900">Streaks →</Link>
            </div>
            <ul className="space-y-2">
              {habitsToday.map((h) => (
                <li key={h.block.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                  <div>
                    <p className="font-medium">{h.block.title}</p>
                    <p className="text-xs text-neutral-500">Streak {h.current} · best {h.best}</p>
                  </div>
                  <HabitControls blockId={h.block.id} status={h.todayStatus} reason={h.todayReason} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {metrics.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-500">Daily metrics</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {metrics.map((m) => (
                <MetricWidget key={m.id} metric={m} value={values.get(m.id)?.get(now.date)} />
              ))}
            </div>
          </section>
        )}

        {finance.txns.length + finance.accounts.length > 0 && (
          <Link href="/finance" className="block rounded-lg border border-neutral-200 p-3 hover:border-neutral-400">
            <p className="text-sm font-medium text-neutral-500">Finance this month</p>
            <p className="text-sm">
              Spent <strong>{formatUSD(monthSums.expense)}</strong>
              {budgetTotal > 0 ? ` of ${formatUSD(budgetTotal)} budgeted (${formatUSD(budgetSpent)} in budgeted categories)` : ""}
              {" · "}Net <strong className={monthSums.net >= 0 ? "text-green-700" : "text-red-600"}>{formatUSD(monthSums.net)}</strong>
            </p>
          </Link>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium text-neutral-500">{formatDateLong(now.date)}</h2>
          {items.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing planned today. Add a time block or an event to get started.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((i) => {
                const isNow = i === current;
                const past = i.end <= now.minutes;
                return (
                  <li
                    key={`${i.kind}-${i.id}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      isNow ? "border-neutral-900" : "border-neutral-200"
                    } ${past ? "opacity-50" : ""}`}
                  >
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: i.kind === "event" ? "#111827" : i.color ?? "#6366f1" }}
                    />
                    <div className="flex-1">
                      <p className={`font-medium ${i.fulfilledBy ? "line-through text-neutral-400" : ""}`}>
                        {i.title}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {range(i)} · {i.kind === "event" ? "Event" : "Time block"}
                        {i.isHabit ? " · Habit" : ""}
                        {i.fulfilledBy ? ` · fulfilled by ${i.fulfilledBy}` : ""}
                        {i.fulfills ? ` · fulfills ${i.fulfills}` : ""}
                      </p>
                    </div>
                    {isNow && <span className="text-xs font-medium">NOW</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
