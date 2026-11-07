// Friendly panel shown when the portfolio tables don't exist yet (migration 0042 not run).
import { MIGRATION_FILE } from "@/lib/portfolio/constants";

export default function MigrationPanel() {
  return (
    <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm">
      <p className="font-medium text-warning">The Portfolio add-on needs its database tables first.</p>
      <ol className="list-decimal space-y-1 pl-5 text-fg">
        <li>Open Supabase → SQL Editor → New query.</li>
        <li>
          Paste the whole file <b>{MIGRATION_FILE}</b> (in your PERSONAL OS folder) and press Run.
        </li>
        <li>Then reload this page.</li>
      </ol>
    </div>
  );
}
