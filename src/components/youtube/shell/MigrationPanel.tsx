// Friendly panel shown when the YouTube tables don't exist yet (migration not run). Owned by the Lead.
import { MIGRATION_FILE } from "@/lib/youtube/constants";

export default function MigrationPanel({ what = "The YouTube add-on" }: { what?: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm">
      <p className="font-medium text-warning">{what} needs its database tables first.</p>
      <ol className="list-decimal space-y-1 pl-5 text-fg">
        <li>Open Supabase → SQL Editor → New query.</li>
        <li>
          Paste the whole file <b>{MIGRATION_FILE}</b> (in your PERSONAL OS folder) and press Run.
        </li>
        <li>The check at the end should say “ok” on every row. Then reload this page.</li>
      </ol>
    </div>
  );
}
