import { createClient } from "@/lib/supabase/server";
import { getActiveBlocks } from "@/lib/agenda";
import { describeDays, formatMinutes, timeToMinutes } from "@/lib/time";
import { deleteBlock } from "@/app/actions";
import Nav from "@/components/Nav";
import BlockForm from "@/components/BlockForm";

export const dynamic = "force-dynamic";

export default async function BlocksPage() {
  const supabase = await createClient();
  const blocks = await getActiveBlocks(supabase);

  return (
    <>
      <Nav active="/blocks" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Time blocks</h1>
          <p className="text-sm text-neutral-500">Your ideal week: recurring blocks with no specific date.</p>
        </div>
        <BlockForm />
        <ul className="space-y-2">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color ?? "#6366f1" }} />
              <div className="flex-1">
                <p className="font-medium">{b.title}</p>
                <p className="text-sm text-neutral-500">
                  {formatMinutes(timeToMinutes(b.start_time))} – {formatMinutes(timeToMinutes(b.end_time))}
                  {timeToMinutes(b.end_time) < timeToMinutes(b.start_time) ? " (next day)" : ""} ·{" "}
                  {describeDays(b.rrule)}
                  {b.is_habit ? " · Habit" : ""}
                </p>
              </div>
              <form action={deleteBlock}>
                <input type="hidden" name="id" value={b.id} />
                <button className="text-sm text-neutral-500 hover:text-red-600">Delete</button>
              </form>
            </li>
          ))}
          {blocks.length === 0 && <p className="text-sm text-neutral-500">No time blocks yet.</p>}
        </ul>
      </main>
    </>
  );
}
