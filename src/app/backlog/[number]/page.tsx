import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { listActivity, listEvents, listItems, loadSettings } from "@/lib/backlog/data";
import ActivityPanel from "@/components/backlog/ActivityPanel";
import ItemEditor from "@/components/backlog/ItemEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backlog item · Personal OS" };

export default async function BacklogItemPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) notFound();
  const sb = await createClient();
  const userId = await currentUserId(sb);
  if (!userId) notFound();
  const [{ items }, settings] = await Promise.all([listItems(sb, userId), loadSettings(sb, userId)]);
  const item = items.find((i) => i.number === n);
  if (!item) notFound();
  const events = await listEvents(sb, userId, item.id);
  const activity = await listActivity(sb, userId, { limit: 30, itemId: item.id });
  const nowIso = new Date().toISOString();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <ItemEditor item={item} items={items} settings={settings} events={events} nowIso={nowIso} />
      <div className="mt-6"><ActivityPanel rows={activity.rows} working={activity.working} nowIso={nowIso} title="Claude's work on this item" /></div>
    </main>
  );
}
