import type { createClient } from "@/lib/supabase/server";
import { getActiveBlocks, type BlockRow } from "@/lib/agenda";
import { computeStreaks, completionRate, type DayStatus } from "@/lib/streaks";
import { addDays, occursOn } from "@/lib/time";

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

export type HabitSummary = {
  block: BlockRow;
  dueToday: boolean;
  todayStatus: DayStatus | null;
  todayReason: string | null;
  current: number;
  best: number;
  rate: number | null;
  last14: { date: string; due: boolean; status: DayStatus | null }[];
};

/** Habit time blocks with streaks, 14-day history and today's status. */
export async function getHabitSummaries(supabase: Supabase, today: string): Promise<HabitSummary[]> {
  const blocks = (await getActiveBlocks(supabase)).filter((b) => b.is_habit);
  if (!blocks.length) return [];
  const since = addDays(today, -365);
  const { data } = await supabase
    .from("activity_logs")
    .select("entity_id,log_date,status,skip_reason")
    .eq("entity_type", "time_block")
    .in("entity_id", blocks.map((b) => b.id))
    .gte("log_date", since)
    .is("deleted_at", null);
  const rows = (data ?? []) as { entity_id: string; log_date: string; status: DayStatus; skip_reason: string | null }[];

  return blocks.map((block) => {
    const logs = new Map<string, DayStatus>();
    let todayReason: string | null = null;
    for (const r of rows.filter((r) => r.entity_id === block.id)) {
      logs.set(r.log_date, r.status);
      if (r.log_date === today) todayReason = r.skip_reason;
    }
    const start = block.valid_from > since ? block.valid_from : since;
    const scheduled: string[] = [];
    for (let d = start; d <= today; d = addDays(d, 1)) {
      if (occursOn(block, d)) scheduled.push(d);
    }
    const { current, best } = computeStreaks(scheduled, logs, today);
    const last14 = Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i - 13);
      return { date, due: occursOn(block, date), status: logs.get(date) ?? null };
    });
    return {
      block,
      dueToday: occursOn(block, today),
      todayStatus: logs.get(today) ?? null,
      todayReason,
      current,
      best,
      rate: completionRate(scheduled.slice(-30), logs, today),
      last14,
    };
  });
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
