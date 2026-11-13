import RecurringForm from "@/components/RecurringForm";
import SeriesRow, { type SeriesRowData } from "@/components/SeriesRow";
import { describeSeries, type SeriesView } from "@/lib/calendar/series";

type Option = { value: string; label: string };

/** Tasks → Recurring: every task that repeats after you finish it, plus the form to create one. */
export default function RecurringSection({ views, today, blockOptions }: { views: SeriesView[]; today: string; blockOptions: Option[] }) {
  const names = new Map(blockOptions.map((b) => [b.value, b.label]));
  const rows: SeriesRowData[] = views.map((v) => ({
    id: v.series.id,
    title: v.series.title,
    every: v.series.repeat_every,
    unit: v.series.repeat_unit,
    label: describeSeries(v.series.repeat_unit, v.series.repeat_every),
    policy: v.series.rollover_policy,
    active: v.series.active,
    homeBlockId: v.series.home_block_type_id,
    homeBlockName: v.series.home_block_type_id ? names.get(v.series.home_block_type_id) ?? "a removed block" : null,
    status: v.status,
    late: v.late,
    lastDoneOn: v.series.last_done_on,
    history: v.history,
    avgGap: v.avgGap,
  }));
  return (
    <section id="recurring" className="space-y-2">
      <h2 className="section-title">Recurring {rows.length ? `(${rows.length})` : ""}</h2>
      <p className="text-sm text-muted">
        Tasks that come back by themselves a set time after you finish them. Finish it on day 4 instead of day 3 and the next one simply counts from day 4.
      </p>
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <SeriesRow key={r.id} series={r} blockOptions={blockOptions} />
          ))}
        </ul>
      )}
      <RecurringForm today={today} blockOptions={blockOptions} />
    </section>
  );
}
