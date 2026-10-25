import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId, getBlockTypes } from "@/lib/calendar/model";
import { getEvents } from "@/lib/calendar/events";
import { getTaskPlaces } from "@/lib/calendar/tasks";
import { getTagsFor, idsWithTag } from "@/lib/tags";
import { addDays, localNow, utcToLocal } from "@/lib/time";
import TaskForm from "@/components/TaskForm";
import TaskRow, { type TaskRowData } from "@/components/TaskRow";

export const dynamic = "force-dynamic";

type TaskWithDone = TaskRowData & { completed_at: string | null };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const supabase = await createClient();
  await supabase.rpc("rollover_my_tasks");
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;

  let query = supabase
    .from("tasks")
    .select("id,title,status,rollover_policy,scheduled_for,rolled_over_count,is_habit,completed_at,home_block_type_id,occurrence_id,event_id")
    .is("deleted_at", null)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at");
  if (tag) query = query.in("id", await idsWithTag(supabase, "task", tag));
  const { data } = await query;
  const tasks = (data ?? []) as TaskWithDone[];

  const tags = await getTagsFor(supabase, "task", tasks.map((t) => t.id));
  const userId = await currentUserId(supabase);
  const places = userId ? await getTaskPlaces(supabase, userId, tasks) : undefined;
  const types = userId ? await getBlockTypes(supabase, userId) : [];
  const upcoming = userId ? await getEvents(supabase, userId, today, addDays(today, 14), timezone) : [];
  const blockOptions = types.map((t) => ({ value: t.id, label: t.name }));
  const eventOptions = upcoming.map((e) => ({ value: e.id, label: `${e.title} (${e.date})` }));

  const groups: { title: string; items: TaskWithDone[]; empty?: string }[] = [
    {
      title: "Today",
      items: tasks.filter((t) => t.status === "pending" && t.scheduled_for !== null && t.scheduled_for <= today),
      empty: "Nothing for today.",
    },
    { title: "Upcoming", items: tasks.filter((t) => t.status === "pending" && t.scheduled_for !== null && t.scheduled_for > today) },
    { title: "Backlog", items: tasks.filter((t) => t.status === "backlog" || (t.status === "pending" && !t.scheduled_for)) },
    {
      title: "Done today",
      items: tasks.filter((t) => t.status === "completed" && t.completed_at && utcToLocal(t.completed_at, timezone).date === today),
    },
    { title: "Graveyard", items: tasks.filter((t) => t.status === "failed").slice(-20) },
  ];

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted">
            Each task has a home block: every morning it goes into that block if the block is on the calendar that day. Nothing moves silently: undone tasks show up in the morning ritual on Today.
            {tag && (
              <>
                {" "}Filtered by <strong>#{tag}</strong> · <Link href="/tasks" className="underline">clear</Link>
              </>
            )}
          </p>
        </div>
        <TaskForm today={today} blockOptions={blockOptions} eventOptions={eventOptions} />
        {groups.map((g) =>
          g.items.length || g.empty ? (
            <section key={g.title} className="space-y-2">
              <h2 className="section-title">
                {g.title} {g.items.length ? `(${g.items.length})` : ""}
              </h2>
              {g.items.length ? (
                <ul className="space-y-2">
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} tags={tags.get(t.id)} today={today} places={places} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-faint">{g.empty}</p>
              )}
            </section>
          ) : null
        )}
      </main>
    </>
  );
}
