import type { createClient } from "@/lib/supabase/server";
import type { DayStatus } from "@/lib/streaks";
import { addDays } from "@/lib/time";

// Legacy activity log helpers (task habits). Block habits moved to lib/calendar/habits.ts.

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type HabitEntity = "time_block" | "event" | "task";

/** Create or update the log for one habit on one day. */
export async function setActivity(
  supabase: Supabase,
  entityType: HabitEntity,
  entityId: string,
  date: string,
  status: DayStatus,
  reason?: string | null
) {
  const { data: existing } = await supabase
    .from("activity_logs")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("log_date", date)
    .is("deleted_at", null)
    .maybeSingle();
  const values = { status, skip_reason: status === "skipped" ? reason || null : null };
  if (existing) {
    return supabase.from("activity_logs").update(values).eq("id", existing.id);
  }
  return supabase
    .from("activity_logs")
    .insert({ entity_type: entityType, entity_id: entityId, log_date: date, ...values });
}

export async function clearActivity(supabase: Supabase, entityType: HabitEntity, entityId: string, date: string) {
  return supabase
    .from("activity_logs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("log_date", date)
    .is("deleted_at", null);
}

export type MetricDef = {
  id: string;
  name: string;
  unit: string;
  min_value: number | null;
  max_value: number | null;
  daily_goal: number | null;
};

export async function getMetrics(supabase: Supabase, today: string, days = 7) {
  const { data: defs } = await supabase
    .from("metric_definitions")
    .select("id,name,unit,min_value,max_value,daily_goal")
    .is("deleted_at", null)
    .order("created_at");
  const metrics = (defs ?? []) as MetricDef[];
  const values = new Map<string, Map<string, number>>();
  if (metrics.length) {
    const { data } = await supabase
      .from("daily_metrics")
      .select("metric_id,log_date,value")
      .in("metric_id", metrics.map((m) => m.id))
      .gte("log_date", addDays(today, -(days - 1)))
      .is("deleted_at", null);
    for (const r of (data ?? []) as { metric_id: string; log_date: string; value: number }[]) {
      const m = values.get(r.metric_id) ?? new Map<string, number>();
      m.set(r.log_date, Number(r.value));
      values.set(r.metric_id, m);
    }
  }
  return { metrics, values };
}
