import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId } from "@/lib/calendar/model";
import { localNow } from "@/lib/time";
import { monthOf } from "@/lib/finance-summary";
import { categorySeries, cumulativeLine, defaultRange, monthlyBuckets, MAX_MONTHS, neededSpan, parseChartQuery } from "@/lib/finance-charts";
import { loadChartData } from "@/lib/finance-charts-data";
import FinanceCharts from "@/components/finance/FinanceCharts";
import RememberCharts from "@/components/finance/RememberCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Charts · Finance · Personal OS" };

const field = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm";

/** BL-122: Finance → Charts. ?from=&to= (range of the monthly charts) &a=&b= (the two months of the line). */
export default async function ChartsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; a?: string; b?: string }> }) {
  const q = await searchParams;
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const p = parseChartQuery(q, today);
  const userId = await currentUserId(supabase);

  let body: React.ReactNode;
  if (!userId) {
    body = <p className="text-sm text-faint">Sign in to see your charts.</p>;
  } else {
    try {
      const span = neededSpan(p);
      const { txns, cats } = await loadChartData(supabase, userId, timezone, span.start, span.end);
      const monthly = monthlyBuckets(txns, cats, p.from, p.to, today);
      const { series } = categorySeries(monthly, cats);
      const lineA = cumulativeLine(txns, cats, p.a, today);
      const lineB = cumulativeLine(txns, cats, p.b, today);
      const adjIds = cats.filter((c) => c.name.trim().toLowerCase() === "adjustment").map((c) => c.id);
      body = <FinanceCharts monthly={monthly} series={series} adjIds={adjIds} multiYear={monthly.length > 0 && monthly[0].month.slice(0, 4) !== monthly[monthly.length - 1].month.slice(0, 4)} lineA={lineA} lineB={lineB} />;
    } catch {
      body = <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">The charts could not load right now. Refresh in a moment.</p>;
    }
  }
  const thisMonth = monthOf(today);
  const def = defaultRange(today);

  return (
    <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 py-6 sm:px-8 lg:py-9">
      <RememberCharts />
      <div>
        <Link href="/finance" className="text-sm text-accent hover:underline">← Finance</Link>
        <h1 className="mt-2 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Charts</h1>
      </div>

      <form method="get" action="/finance/charts" className="card flex flex-wrap items-end gap-3 p-4">
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="mb-1 text-xs font-medium text-muted">Month-by-month charts</legend>
          <label className="space-y-1 text-xs text-muted">
            From
            <input type="date" name="from" defaultValue={p.from} max={today} className={`${field} block`} />
          </label>
          <label className="space-y-1 text-xs text-muted">
            To
            <input type="date" name="to" defaultValue={p.to} max={today} className={`${field} block`} />
          </label>
        </fieldset>
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="mb-1 text-xs font-medium text-muted">Line: compare</legend>
          <label className="space-y-1 text-xs text-muted">
            Month A
            <input type="month" name="a" defaultValue={p.a} max={thisMonth} className={`${field} block`} />
          </label>
          <label className="space-y-1 text-xs text-muted">
            Month B
            <input type="month" name="b" defaultValue={p.b} max={thisMonth} className={`${field} block`} />
          </label>
        </fieldset>
        <button className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium transition-colors hover:bg-subtle">Update</button>
        <Link href="/finance/charts?reset=1" className="pb-1.5 text-sm text-accent hover:underline">Back to defaults</Link>
        <p className="w-full text-xs text-faint">
          Default: {def.from} to today, up to {MAX_MONTHS} months. Your choice is remembered in this browser.
          {p.capped && <span className="text-warning"> The range was cut to the latest {MAX_MONTHS} months.</span>}
        </p>
      </form>

      {body}
    </main>
  );
}
