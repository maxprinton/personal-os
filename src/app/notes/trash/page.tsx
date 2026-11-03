import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId } from "@/lib/calendar/model";
import { TRASH_DAYS, listTrash } from "@/lib/notes-trash";
import TrashList from "@/components/TrashList";

export const dynamic = "force-dynamic";

// Notes → Trash: notes you deleted wait here for 30 days (restore them or delete them for good).
export default async function NotesTrashPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const { timezone } = await getSettings(supabase);
  let items: Awaited<ReturnType<typeof listTrash>> = [];
  let error: string | null = null;
  try {
    items = await listTrash(supabase, userId);
  } catch (e) {
    error = e instanceof Error ? e.message : "The trash couldn't load.";
  }
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone });
  const rows = items.map((i) => ({ ...i, deletedLabel: day.format(new Date(i.deletedAt)) }));

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
          <p className="text-sm text-muted">Deleted notes stay here for {TRASH_DAYS} days, then they are deleted for good.</p>
        </div>
        <Link href="/notes" className="rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:bg-subtle">
          ← Back to Notes
        </Link>
      </div>
      {error ? <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{error}</p> : <TrashList initial={rows} days={TRASH_DAYS} />}
    </main>
  );
}
