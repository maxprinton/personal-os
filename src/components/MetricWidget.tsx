import { logMetric } from "@/app/habit-actions";
import type { MetricDef } from "@/lib/habits";

/** Quick capture for one metric today: set a value, or tap quick-add buttons. */
export default function MetricWidget({ metric, value }: { metric: MetricDef; value: number | undefined }) {
  const isScale = metric.min_value !== null && metric.max_value !== null && metric.max_value - metric.min_value <= 10 && !metric.daily_goal;
  const pct = metric.daily_goal && value !== undefined ? Math.min(100, Math.round((value / metric.daily_goal) * 100)) : null;
  const g = metric.daily_goal;
  const quick = !g ? [] : g >= 100 ? [Math.round(g / 10), Math.round(g / 4)] : g >= 2 ? [0.25, 0.5] : [0.1, 0.5];

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-baseline justify-between">
        <p className="font-medium">{metric.name}</p>
        <p className="text-sm text-neutral-500">
          {value !== undefined ? `${value} ${metric.unit}` : "—"}
          {metric.daily_goal ? ` / ${metric.daily_goal} ${metric.unit}` : ""}
        </p>
      </div>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-neutral-100">
          <div className="h-1.5 rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
        </div>
      )}
      {isScale ? (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: (metric.max_value as number) - (metric.min_value as number) + 1 }, (_, i) => (metric.min_value as number) + i).map((n) => (
            <form key={n} action={logMetric}>
              <input type="hidden" name="metric_id" value={metric.id} />
              <input type="hidden" name="value" value={n} />
              <button
                className={`h-7 w-7 rounded-md border text-xs ${value === n ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
              >
                {n}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {quick.map((q) => (
            <form key={q} action={logMetric}>
              <input type="hidden" name="metric_id" value={metric.id} />
              <input type="hidden" name="value" value={q} />
              <input type="hidden" name="mode" value="add" />
              <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs">+{q}</button>
            </form>
          ))}
          <form action={logMetric} className="flex items-center gap-1">
            <input type="hidden" name="metric_id" value={metric.id} />
            <input
              name="value"
              inputMode="decimal"
              placeholder="Set value"
              className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-xs"
            />
            <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs">Save</button>
          </form>
        </div>
      )}
    </div>
  );
}
