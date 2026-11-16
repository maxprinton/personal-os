import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId } from "@/lib/calendar/model";
import { localNow } from "@/lib/time";
import { loadSummaryData } from "@/lib/finance-summary-data";
import { monthOf, nextMonth, prevMonth, summarizeMonth, summaryMonthName } from "@/lib/finance-summary";
import MonthlySummary from "@/components/MonthlySummary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monthly summary · Personal OS" };

/** BL-28: the summary of any month. ?m=YYYY-MM (default: this month, "so far"). */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const thisMonth = monthOf(today);
  // A month in the future or a malformed one falls back to this month
  const month = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m <= thisMonth ? m : thisMonth;
  const userId = await currentUserId(supabase);
  const data = userId ? await loadSummaryData(supabase, userId, timezone) : null;
  const s = data ? summarizeMonth(data, month, today) : null;
  const first = data?.txns[0]?.localDate.slice(0, 7);

  return (
    <main className="mx-auto w-full max-w-[800px] space-y-6 px-4 py-6 sm:px-8 lg:py-9">
      <div>
        <Link href="/finance" className="text-sm text-accent hover:underline">← Finance</Link>
        <h1 className="mt-2 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Monthly summary</h1>
      </div>
      <nav className="flex items-center gap-3 text-sm" aria-label="Month">
        {!first || prevMonth(month) >= first ? (
          <Link href={`/finance/summary?m=${prevMonth(month)}`} className="rounded-md border border-edge px-3 py-1.5 hover:bg-subtle">← {summaryMonthName(prevMonth(month))}</Link>
        ) : (
          <span className="rounded-md border border-line px-3 py-1.5 text-faint">← nothing earlier</span>
        )}
        {month < thisMonth && (
          <Link href={`/finance/summary?m=${nextMonth(month)}`} className="rounded-md border border-edge px-3 py-1.5 hover:bg-subtle">{summaryMonthName(nextMonth(month))} →</Link>
        )}
        {month !== thisMonth && <Link href="/finance/summary" className="text-accent hover:underline">This month</Link>}
      </nav>
      {s ? <MonthlySummary s={s} /> : <p className="text-sm text-faint">Sign in to see your summary.</p>}
    </main>
  );
}
