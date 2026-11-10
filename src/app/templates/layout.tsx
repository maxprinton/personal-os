// Template Manager add-on: header + sub-navigation for every /templates page.
// If migration 0052 has not been run, every page shows the "run the migration" panel instead.
import TmNav from "@/components/file-templates/TmNav";
import { MIGRATION_FILE } from "@/lib/file-templates/constants";
import { tmReady, tmServer } from "@/lib/file-templates/db";

export const metadata = { title: "Template Manager · Personal OS" };
export const dynamic = "force-dynamic";

export default async function TemplatesLayout({ children }: { children: React.ReactNode }) {
  const { missing } = await tmReady();
  let inbox = 0;
  let trash = 0;
  if (!missing) {
    const { supabase, userId } = await tmServer();
    if (userId) {
      const [a, b] = await Promise.all([
        supabase.from("tm_templates").select("id", { head: true, count: "exact" }).eq("user_id", userId).is("deleted_at", null).eq("status", "inbox"),
        supabase.from("tm_templates").select("id", { head: true, count: "exact" }).eq("user_id", userId).not("deleted_at", "is", null),
      ]);
      inbox = a.count ?? 0;
      trash = b.count ?? 0;
    }
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-4 space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Template Manager</h1>
          <p className="text-sm text-muted">Your project-management templates: find the right one by phase and approach, see when to use it, download it.</p>
        </div>
        <TmNav inbox={inbox} trash={trash} />
      </header>
      {missing ? (
        <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm">
          <p className="font-medium text-warning">The Template Manager needs its database tables first.</p>
          <ol className="list-decimal space-y-1 pl-5 text-fg">
            <li>Open Supabase → SQL Editor → New query.</li>
            <li>Paste the whole file <b>{MIGRATION_FILE}</b> (in your PERSONAL OS folder) and press Run.</li>
            <li>Then reload this page.</li>
          </ol>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
