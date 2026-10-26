import { createClient } from "@/lib/supabase/server";
import { getAgenda, getSettings, whatNow, type AgendaItem } from "@/lib/agenda";
import { formatDateLong, formatMinutes, localNow } from "@/lib/time";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import TaskRow, { type TaskRowData } from "@/components/TaskRow";
import { getContextFor } from "@/lib/links";
import { getTagsFor } from "@/lib/tags";
import { getMetrics } from "@/lib/habits";
import { getHabitSummaries } from "@/lib/calendar/habits";
import { currentUserId, getBlockTypes } from "@/lib/calendar/model";
import { getEvents } from "@/lib/calendar/events";
import { addDays } from "@/lib/time";
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
import { alpha } from "@/components/calendar/util";
import Icon from "@/components/ui/Icon";
import Section from "@/components/ui/Section";

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
  const [blockTypes, upcomingEvents] = userId
    ? await Promise.all([getBlockTypes(supabase, userId), getEvents(supabase, userId, now.date, addDays(now.date, 14), timezone)])
    : [[], []];
  const editOptions = {
    blocks: blockTypes.map((t) => ({ value: t.id, label: t.name })),
    events: upcomingEvents.map((e) => ({ value: e.id, label: `${e.title} (${e.date})` })),
  };
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
  const focusColor = current?.color ?? null;
  const elapsed = current ? Math.min(100, Math.max(0, Math.round(((now.minutes - current.start) / Math.max(1, current.end - current.start)) * 100))) : null;
  const minutesLeft = current ? Math.max(0, current.end - now.minutes) : null;
  const allDay = items.filter((i) => i.allDay);
  const timed = items.filter((i) => !i.allDay);
  const doneCount = timed.filter((i) => i.kind === "block" && (i.status === "done" || i.status === "partial")).length;
  const blockCount = timed.filter((i) => i.kind === "block" && i.status !== "free_day").length;

  return (
    <>
      <AutoRefresh />
      <main className="@container mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-muted">{formatDateLong(now.date)}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          </div>
          {blockCount > 0 && (
            <p className="text-sm text-muted">
              <span className="font-semibold text-fg">{doneCount}</span> of {blockCount} blocks done
            </p>
          )}
        </header>

        {/* Focus: what should I be doing right now? */}
        <section
          className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
          style={focusColor ? { background: `linear-gradient(135deg, ${alpha(focusColor, 0.16)}, ${alpha(focusColor, 0.04)}), var(--surface)` } : undefined}
        >
          <span
            className="absolute inset-y-0 left-0 w-1.5"
            style={{ background: focusColor ?? "var(--accent)" }}
            aria-hidden
          />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {current ? (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-solid opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success-solid" />
                  </span>
                ) : null}
                Right now · {formatMinutes(now.minutes)}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{headline}</h2>
              <p className="mt-1 text-muted">{detail}</p>
            </div>
            {minutesLeft !== null && (
              <div className="sm:text-right">
                <p className="text-3xl font-semibold tabular-nums">{minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m` : `${minutesLeft}m`}</p>
                <p className="text-xs text-muted">left</p>
              </div>
            )}
          </div>
          {elapsed !== null && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-subtle-2" aria-label={`${elapsed}% of this block elapsed`}>
              <div className="h-full rounded-full" style={{ width: `${elapsed}%`, background: focusColor ?? "var(--accent)" }} />
            </div>
          )}
          {(allDay.length > 0 || (current && next)) && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {current && next && (
                <span className="rounded-full bg-surface/80 px-2.5 py-1 font-medium ring-1 ring-line">
                  Next: {next.title} · {formatMinutes(next.start)}
                </span>
              )}
              {allDay.map((i) => (
                <span key={i.id} className="rounded-full bg-surface/80 px-2.5 py-1 ring-1 ring-line">
                  {i.title}
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Left: things to act on */}
          <div className="min-w-0 space-y-6">
            <div className="card p-3">
              <QuickCapture accounts={finance.accounts.map((a) => ({ id: a.id, name: a.name }))} />
            </div>

            {ritual && !ritual.seen && (ritual.items.length > 0 || ritual.unassigned > 0) && <MorningRitual ritual={ritual} readOnly={mobile} />}

            {duePayments.length > 0 && financeOptions && (
              <Section title="Payments due" count={duePayments.length} tone="success">
                <div className="space-y-2">
                  {duePayments.map((p) => (
                    <div key={p.eventId} className="card p-3">
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
                </div>
              </Section>
            )}

            {insights.length > 0 && (
              <Section title="Chief of Staff" tone="warning">
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-warning/30 bg-warning-soft">
                  {insights.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                      <span className="flex gap-2">
                        <Icon name="spark" size={16} className="mt-0.5 text-warning" />
                        <span>
                          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">{i.insight_type}</span>
                          {i.message}
                        </span>
                      </span>
                      <form action={markInsightRead}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="compact shrink-0 rounded-md px-2 py-1 text-xs whitespace-nowrap font-medium text-warning hover:bg-surface/60">Got it</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Today's tasks" count={todayTasks.length} href="/tasks" linkLabel="All tasks">
              {todayTasks.length ? (
                <ul className="space-y-2">
                  {todayTasks.map((t) => (
                    <TaskRow key={t.id} task={t} tags={taskTags.get(t.id)} today={now.date} places={places} editOptions={editOptions} />
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-edge p-4 text-sm text-muted">
                  <Icon name="check" size={18} className="text-success" />
                  All clear — no tasks left for today.
                </div>
              )}
            </Section>

            {habitsToday.length > 0 && (
              <Section title="Habits today" count={habitsToday.length} href="/habits" linkLabel="Streaks">
                <ul className="space-y-2">
                  {habitsToday.map(({ h, t }) => (
                    <li key={`${h.habit.id}-${t.occurrenceId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 shadow-card">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: h.blockColor ?? "var(--accent)" }} />
                        <div className="min-w-0">
                          <p className="font-medium">{h.habit.name}</p>
                          <p className="text-xs text-muted">
                            {h.blockName} · {formatMinutes(Number(t.start.slice(0, 2)) * 60 + Number(t.start.slice(3, 5)))}
                            {h.current > 0 && <span className="ml-1.5 font-medium text-warning">🔥 {h.current}</span>}
                            <span className="ml-1.5">best {h.best}</span>
                          </p>
                        </div>
                      </div>
                      <HabitControls habitId={h.habit.id} occurrenceId={t.occurrenceId} state={t.state} readOnly={mobile} />
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>

          {/* Right: context */}
          <div className="min-w-0 space-y-6">
            {(contextTasks.length > 0 || context.notes.length > 0) && (
              <Section title={soon && !current ? `Coming up: ${soon.title} at ${formatMinutes(soon.start)}` : "For this moment"}>
                <ul className="card divide-y divide-line text-sm">
                  {contextTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                      <Icon name="tasks" size={16} className="text-faint" />
                      {t.title}
                    </li>
                  ))}
                  {context.notes.map((n) => (
                    <li key={n.id}>
                      <Link href={`/notes/${n.id}`} className="flex items-center gap-2 px-3 py-2.5 hover:bg-subtle">
                        <Icon name="notes" size={16} className="text-faint" />
                        {n.title || "Untitled"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Agenda" count={timed.length} href="/calendar" linkLabel="Calendar">
              {timed.length === 0 ? (
                <div className="rounded-xl border border-dashed border-edge p-4 text-sm text-muted">
                  Nothing planned today.{" "}
                  <Link href="/blocks" className="font-medium text-accent hover:underline">Add a block</Link> or{" "}
                  <Link href="/events" className="font-medium text-accent hover:underline">an event</Link>.
                </div>
              ) : (
                <ol className="card relative overflow-hidden py-1">
                  {timed.map((i) => {
                    const isNow = i === current;
                    const past = i.end <= now.minutes;
                    const color = i.color ?? (i.kind === "event" ? "#64748b" : "#6366f1");
                    return (
                      <li
                        key={`${i.kind}-${i.id}-${i.start}`}
                        className={`relative flex items-start gap-3 px-3 py-2.5 ${isNow ? "bg-accent-soft" : ""} ${past || i.status === "free_day" ? "opacity-55" : ""}`}
                      >
                        <span className="w-[4.5rem] shrink-0 pt-0.5 text-xs tabular-nums text-muted">{formatMinutes(i.start)}</span>
                        <span
                          className={`mt-1 h-3 w-3 shrink-0 rounded-full ${i.kind === "event" ? "border-2 bg-transparent" : ""}`}
                          style={i.kind === "event" ? { borderColor: color } : { background: color }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium ${i.fulfilledBy ? "text-faint line-through" : ""}`}>{i.title}</p>
                          <p className="text-xs text-muted">
                            {range(i)} · {i.kind === "event" ? "Event" : "Block"}
                            {i.isHabit ? " · Habit" : ""}
                            {i.status === "free_day" ? " · free day" : ""}
                            {i.fulfilledBy ? ` · fulfilled by ${i.fulfilledBy}` : ""}
                            {i.fulfills ? ` · fulfills ${i.fulfills}` : ""}
                          </p>
                        </div>
                        {i.status === "done" && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">Done</span>}
                        {i.status === "partial" && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">Partly</span>}
                        {isNow && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Now</span>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>

            {finance.txns.length + finance.accounts.length > 0 && (
              <Section title="Finance this month" href="/finance" linkLabel="Finance">
                <Link href="/finance" className="card block p-4 transition-colors hover:border-edge">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted">Spent</p>
                      <p className="text-xl font-semibold tabular-nums">{formatUSD(monthSums.expense)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Net</p>
                      <p className={`text-xl font-semibold tabular-nums ${monthSums.net >= 0 ? "text-success" : "text-danger"}`}>{formatUSD(monthSums.net)}</p>
                    </div>
                  </div>
                  {budgetTotal > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs text-muted">
                        <span>Budgets</span>
                        <span className="tabular-nums">{formatUSD(budgetSpent)} / {formatUSD(budgetTotal)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
                        <div
                          className={`h-full rounded-full ${budgetSpent > budgetTotal ? "bg-danger-solid" : budgetSpent > budgetTotal * 0.8 ? "bg-warning-solid" : "bg-success-solid"}`}
                          style={{ width: `${Math.min(100, Math.round((budgetSpent / budgetTotal) * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </Link>
              </Section>
            )}

            {metrics.length > 0 && (
              <Section title="Daily metrics">
                <div className="grid gap-3 sm:grid-cols-2 @4xl:grid-cols-1 @6xl:grid-cols-2">
                  {metrics.map((m) => (
                    <MetricWidget key={m.id} metric={m} value={values.get(m.id)?.get(now.date)} />
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
