// Shown when migration 0053 (working copies) has not been run yet.
export default function CopiesMigration() {
  return (
    <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm">
      <p className="font-medium text-warning">Working copies need one more database table.</p>
      <ol className="list-decimal space-y-1 pl-5 text-fg">
        <li>Open Supabase → SQL Editor → New query.</li>
        <li>Paste the whole file <b>MIGRACION-0053-template-manager-copias.sql</b> (in your PERSONAL OS folder) and press Run.</li>
        <li>Then reload this page.</li>
      </ol>
    </div>
  );
}
