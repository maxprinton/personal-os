import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { detectTests, listActivity, listItems, listSteps, listTests, loadSettings, MISSING } from "@/lib/backlog/data";
import BacklogApp from "@/components/backlog/BacklogApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backlog · Personal OS" };

export default async function BacklogPage() {
  const sb = await createClient();
  const userId = await currentUserId(sb);
  if (!userId) return <Shell>You are signed out. Sign in again.</Shell>;
  const [{ items, missing, error }, settings] = await Promise.all([listItems(sb, userId), loadSettings(sb, userId)]);
  if (missing) return <Shell>{MISSING}</Shell>;
  if (error) return <Shell>{error}</Shell>;
  const activity = await listActivity(sb, userId, { limit: 30 });
  const [pendingSteps, doneSteps] = await Promise.all([listSteps(sb, userId, { status: "pending" }), listSteps(sb, userId, { status: "done", limit: 15 })]);
  await detectTests(sb, userId);
  const tests = await listTests(sb, userId);
  const nowIso = new Date().toISOString();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:py-6">
      <BacklogApp items={items} settings={settings} nowIso={nowIso} data={{ tests, pendingSteps, doneSteps, activity: activity.rows, working: activity.working }} />
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Backlog</h1>
      <p className="text-sm text-muted">{children}</p>
    </main>
  );
}
