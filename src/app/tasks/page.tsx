import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { getLinkOptions } from "@/lib/links";
import { getTagsFor, idsWithTag } from "@/lib/tags";
import { localNow, utcToLocal, zonedToUtc } from "@/lib/time";
import Nav from "@/components/Nav";
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
    .select("id,title,status,rollover_policy,scheduled_for,rolled_over_count,is_habit,completed_at")
    .is("deleted_at", null)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at");
  if (tag) query = query.in("id", await idsWithTag(supabase, "task", tag));
  const { data } = await query;
  const tasks = (data ?? []) as TaskWithDone[];

  const tags = await getTagsFor(supabase, "task", tasks.map((t) => t.id));
  const linkOptions = await getLinkOptions(supabase, zonedToUtc(today, "00:00", timezone).toISOString(), timezone);

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
      <Nav active="/tasks" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="text-sm text-neutral-500">
            Each task decides what happens at midnight if it is not done.
            {tag && (
              <>
                {" "}Filtered by <strong>#{tag}</strong> · <Link href="/tasks" className="underline">clear</Link>
              </>
            )}
          </p>
        </div>
        <TaskForm today={today} linkOptions={linkOptions} />
        {groups.map((g) =>
          g.items.length || g.empty ? (
            <section key={g.title} className="space-y-2">
              <h2 className="text-sm font-medium text-neutral-500">
                {g.title} {g.items.length ? `(${g.items.length})` : ""}
              </h2>
              {g.items.length ? (
                <ul className="space-y-2">
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} tags={tags.get(t.id)} today={today} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-400">{g.empty}</p>
              )}
            </section>
          ) : null
        )}
      </main>
    </>
  );
}
