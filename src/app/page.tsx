import { createClient } from "@/lib/supabase/server";
import { getAgenda, getSettings, whatNow, type AgendaItem } from "@/lib/agenda";
import { formatDateLong, formatMinutes, localNow } from "@/lib/time";
import Link from "next/link";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import TaskRow, { type TaskRowData } from "@/components/TaskRow";
import { getContextFor } from "@/lib/links";
import { getTagsFor } from "@/lib/tags";
import { getMetrics } from "@/lib/habits";
import { getHabitSummaries } from "@/lib/calendar/habits";
import { currentUserId } from "@/lib/calendar/model";
import { runMaintenance } from "@/lib/calendar/maintenance";
import HabitControls from "@/components/HabitControls";
import MorningRitual from "@/components/MorningRitual";
import { getRitual, getTaskPlaces } from "@/lib/calendar/tasks";
import { getDuePayments, getFinanceOptions } from "@/lib/calendar/payments";
import { PaymentDraft } from "@/components/PaymentForms";
import { isMobileRequest } from "@/lib/device";
import MetricWidget from "@/components/MetricWidget";
import QuickCapture from "@/components/QuickCapture";
import { markInsightRead } from "@/app/settings-actions";
import { getFinance } from "@/lib/finance";
import { budgetUsage, formatUSD, inRange, monthRange, totals } from "@/lib/money";
import { textOn } from "@/components/calendar/util";

export const dynamic = "force-dynamic";

function range(i: AgendaItem) {
  if (i.allDay) return "All day";
  return `${formatMinutes(i.start)} – ${formatMinutes(i.end % 1440)}`;
}

export default async function CommandCenter() {
  const supabase = await createClient();
  await supabase.rpc("rollover_my_tasks");
  const { timezone } = await getSettings(supabase);
  const userId = await currentUserId(supabase);
  const mobile = await isMobileRequest();
  if (userId) await runMaintenance(supabase, userId, timezone);
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
    .map((i) =>
      i.kind === "event" ? { type: "event" as const, id: i.id } : { type: "block_type" as const, id: i.blockTypeId ?? i.id }
    );
  const context = await getContextFor(supabase, contextTargets);

  const { data: taskData } = await supabase
    .from("tasks")
    .select("id,title,status,rollover_policy,scheduled_for,rolled_over_count,is_habit,home_block_type_id,occurrence_id,event_id")
    .is("deleted_at", null)
    .eq("status", "pending")
    .lte("scheduled_for", now.date)
    .order("scheduled_for")
    .order("created_at");
  const todayTasks = (taskData ?? []) as TaskRowData[];
  const taskTags = await getTagsFor(supabase, "task", todayTasks.map((t) => t.id));
  const [places, ritual] = userId
    ? await Promise.all([getTaskPlaces(supabase, userId, todayTasks), getRitual(supabase, userId, now.date)])
    : ([undefined, null] as const);
  const [duePayments, financeOptions] = userId
    ? await Promise.all([getDuePayments(supabase, userId, now.date), getFinanceOptions(supabase, userId)])
    : ([[], null] as const);

  // The tasks placed in the current block (in any of its appearances today) or in the current event
  const sameBlockIds = new Set(
    items.filter((i) => i.kind === "block" && activeBlock && i.blockTypeId === activeBlock.blockTypeId).map((i) => i.id)
  );
  const placedNow = todayTasks
    .filter((t) => (t.occurrence_id && sameBlockIds.has(t.occurrence_id)) || (activeEvent && t.event_id === activeEvent.id))
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));
  const contextTasks = [...placedNow, ...context.tasks.filter((t) => t.status === "pending" && !placedNow.some((p) => p.id === t.id))];
  const [habits, { metrics, values }] = await Promise.all([
    userId ? getHabitSummaries(supabase, userId, now.date) : Promise.resolve([]),
    getMetrics(supabase, now.date, 1),
  ]);
  const habitsToday = habits
    .flatMap((h) => h.today.map((t) => ({ h, t })))
    .sort((a, b) => a.t.start.localeCompare(b.t.start));
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
        <section
          className="rounded-xl bg-neutral-900 p-6 text-white"
          style={current?.color ? { background: current.color, color: textOn(current.color) } : undefined}
        >
          <p className="text-xs uppercase tracking-wide opacity-70">
            What should I be doing right now? · {formatMinutes(now.minutes)}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">{headline}</h1>
          <p className="mt-1 opacity-80">{detail}</p>
          {items.some((i) => i.allDay) && (
            <p className="mt-3 text-sm opacity-80">
              Today: {items.filter((i) => i.allDay).map((i) => i.title).join(" · ")}
            </p>
          )}
        </section>

        <QuickCapture />

        {ritual && !ritual.seen && (ritual.items.length > 0 || ritual.unassigned > 0) && <MorningRitual ritual={ritual} readOnly={mobile} />}

        {duePayments.length > 0 && financeOptions && (
          <section className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-4">
            <h2 className="text-sm font-medium text-green-900">Payments due</h2>
            {duePayments.map((p) => (
              <div key={p.eventId} className="rounded-lg bg-white p-3">
                <PaymentDraft
                  eventId={p.eventId}
                  title={p.title}
                  date={p.date}
                  template={p.template}
                  options={financeOptions}
                  today={now.date}
                  readOnly={mobile}
                />
              </div>
            ))}
          </section>
        )}

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
                <TaskRow key={t.id} task={t} tags={taskTags.get(t.id)} today={now.date} places={places} />
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
              {habitsToday.map(({ h, t }) => (
                <li key={`${h.habit.id}-${t.occurrenceId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                  <div>
                    <p className="font-medium">{h.habit.name}</p>
                    <p className="text-xs text-neutral-500">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: h.blockColor ?? "#6366f1" }} />
                      {h.blockName} {formatMinutes(Number(t.start.slice(0, 2)) * 60 + Number(t.start.slice(3, 5)))} · streak {h.current} · best {h.best}
                    </p>
                  </div>
                  <HabitControls habitId={h.habit.id} occurrenceId={t.occurrenceId} state={t.state} readOnly={mobile} />
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
                const past = !i.allDay && i.end <= now.minutes;
                return (
                  <li
                    key={`${i.kind}-${i.id}-${i.start}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      isNow ? "border-neutral-900" : "border-neutral-200"
                    } ${i.kind === "event" ? "border-dashed" : ""} ${past || i.status === "free_day" ? "opacity-50" : ""}`}
                  >
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: i.color ?? (i.kind === "event" ? "#64748b" : "#6366f1") }}
                    />
                    <div className="flex-1">
                      <p className={`font-medium ${i.fulfilledBy ? "line-through text-neutral-400" : ""}`}>
                        {i.title}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {range(i)} · {i.kind === "event" ? "Event" : "Block"}
                        {i.status === "done" ? " · done" : i.status === "partial" ? " · partly done" : ""}
                        {i.status === "free_day" ? " · free day" : ""}
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
