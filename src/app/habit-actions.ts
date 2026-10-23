"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { clearActivity, setActivity, type HabitEntity } from "@/lib/habits";
import { localNow } from "@/lib/time";
import type { ActionState } from "@/app/actions";

function refresh() {
  revalidatePath("/");
  revalidatePath("/habits");
}

/** op = completed | skipped | failed | clear */
export async function logHabit(form: FormData) {
  const entityType = String(form.get("entity_type") ?? "") as HabitEntity;
  const entityId = String(form.get("entity_id") ?? "");
  const op = String(form.get("op") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!entityId || !["time_block", "event", "task"].includes(entityType)) return;

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const date = String(form.get("date") ?? "") || localNow(timezone).date;

  if (op === "clear") await clearActivity(supabase, entityType, entityId, date);
  else if (op === "completed" || op === "failed") await setActivity(supabase, entityType, entityId, date, op);
  else if (op === "skipped") await setActivity(supabase, entityType, entityId, date, "skipped", reason || "No reason given");
  refresh();
}

function num(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function createMetric(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  const unit = String(form.get("unit") ?? "").trim();
  if (!name || !unit) return { error: "Name and unit are required." };
  const min_value = num(form.get("min_value"));
  const max_value = num(form.get("max_value"));
  if (min_value !== null && max_value !== null && max_value < min_value) return { error: "Max must be ≥ min." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("metric_definitions")
    .insert({ name, unit, min_value, max_value, daily_goal: num(form.get("daily_goal")) });
  if (error) return { error: error.code === "23505" ? "You already track a metric with that name." : error.message };
  refresh();
  return { ok: true, at: Date.now() };
}

export async function addStarterMetrics() {
  const supabase = await createClient();
  const starters: { name: string; unit: string; min_value: number; max_value: number; daily_goal: number | null }[] = [
    { name: "Water intake", unit: "L", min_value: 0, max_value: 10, daily_goal: 2.5 },
    { name: "Mood", unit: "1-10", min_value: 1, max_value: 10, daily_goal: null },
  ];
  for (const s of starters) await supabase.from("metric_definitions").insert(s);
  refresh();
}

export async function deleteMetric(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("metric_definitions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  refresh();
}

/** Save today's value. mode=set replaces it, mode=add adds to it (e.g. +0.25 L of water). */
export async function logMetric(form: FormData) {
  const metricId = String(form.get("metric_id") ?? "");
  const value = num(form.get("value"));
  const mode = String(form.get("mode") ?? "set");
  if (!metricId || value === null) return;

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const date = localNow(timezone).date;
  const { data: def } = await supabase
    .from("metric_definitions")
    .select("min_value,max_value")
    .eq("id", metricId)
    .maybeSingle();
  const { data: existing } = await supabase
    .from("daily_metrics")
    .select("id,value")
    .eq("metric_id", metricId)
    .eq("log_date", date)
    .is("deleted_at", null)
    .maybeSingle();

  let next = mode === "add" ? Number(existing?.value ?? 0) + value : value;
  if (def?.min_value !== null && def?.min_value !== undefined) next = Math.max(Number(def.min_value), next);
  if (def?.max_value !== null && def?.max_value !== undefined) next = Math.min(Number(def.max_value), next);
  next = Math.round(next * 100) / 100;

  if (existing) await supabase.from("daily_metrics").update({ value: next }).eq("id", existing.id);
  else await supabase.from("daily_metrics").insert({ metric_id: metricId, log_date: date, value: next });
  refresh();
}
