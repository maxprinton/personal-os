"use client";

import { useActionState } from "react";
import { importBankCsv, importCalendar, importNotes, type ImportState } from "@/app/import-actions";

const box = "space-y-3 rounded-lg border border-neutral-200 p-4";
const btn = "rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50";

function Result({ s }: { s: ImportState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.message) return <p className="text-sm text-green-700">{s.message}</p>;
  return null;
}

export function BankImport({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [s, action, pending] = useActionState<ImportState, FormData>(importBankCsv, {});
  return (
    <form action={action} className={box}>
      <h2 className="font-medium">Bank statement (CSV)</h2>
      <p className="text-sm text-neutral-500">
        Needs a header row with a Date column and either Amount (negative = expense) or Debit/Credit columns. Spanish
        headers (Fecha, Monto, Débito…) work too.
      </p>
      <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
      <div className="flex flex-wrap gap-2 text-sm">
        <select name="date_order" defaultValue="dmy" className="rounded-md border border-neutral-300 px-2 py-1">
          <option value="ymd">Dates like 2026-10-23</option>
          <option value="dmy">Dates like 23/10/2026</option>
          <option value="mdy">Dates like 10/23/2026</option>
        </select>
        <select name="account_id" defaultValue="" className="rounded-md border border-neutral-300 px-2 py-1">
          <option value="">No account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <button disabled={pending} className={btn}>{pending ? "Importing..." : "Import transactions"}</button>
      <Result s={s} />
    </form>
  );
}

export function CalendarImport() {
  const [s, action, pending] = useActionState<ImportState, FormData>(importCalendar, {});
  return (
    <form action={action} className={box}>
      <h2 className="font-medium">Google / Apple Calendar (.ics)</h2>
      <p className="text-sm text-neutral-500">
        Google Calendar: Settings → Import &amp; export → Export, unzip, pick the .ics. Apple Calendar: File → Export.
      </p>
      <input type="file" name="file" accept=".ics,text/calendar" multiple required className="text-sm" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="all_day" /> Include all-day events
      </label>
      <button disabled={pending} className={btn}>{pending ? "Importing..." : "Import events"}</button>
      <Result s={s} />
    </form>
  );
}

export function NotesImport() {
  const [s, action, pending] = useActionState<ImportState, FormData>(importNotes, {});
  return (
    <form action={action} className={box}>
      <h2 className="font-medium">Notes (.md / .txt)</h2>
      <p className="text-sm text-neutral-500">
        Select many files at once. Google Keep (via Google Takeout) and Apple Notes (exported as text or Markdown)
        both work. The file name becomes the title.
      </p>
      <input type="file" name="files" accept=".md,.markdown,.txt,text/plain,text/markdown" multiple required className="text-sm" />
      <button disabled={pending} className={btn}>{pending ? "Importing..." : "Import notes"}</button>
      <Result s={s} />
    </form>
  );
}
