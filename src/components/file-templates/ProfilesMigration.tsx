// Shown when migration 0054 (project profiles) has not been run yet.
import { MIGRATION_0054 } from "@/lib/file-templates/constants";

export default function ProfilesMigration() {
  return (
    <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm">
      <p className="font-medium text-warning">Project profiles need two more database tables.</p>
      <ol className="list-decimal space-y-1 pl-5 text-fg">
        <li>Open Supabase → SQL Editor → New query.</li>
        <li>Paste the whole file <b>{MIGRATION_0054}</b> (in your PERSONAL OS folder) and press Run.</li>
        <li>Then reload this page.</li>
      </ol>
    </div>
  );
}
