"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { addDays, localNow, minutesToTime, zonedToUtc } from "@/lib/time";
import { parseClock } from "@/lib/daily-facts";
import type { ActionState } from "@/app/actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Writes Mood / Energy as the metric (same value the Today widget and Telegram "mood 7" use), creating the metric if needed. */
async function setMetric(supabase: Supabase, name: "Mood" | "Energy", date: string, value: number) {
  let { data: def } = await supabase
    .from("metric_definitions")
    .select("id")
    .ilike("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (!def) {
    const ins = await supabase.from("metric_definitions").insert({ name, unit: "1-10", min_value: 1, max_value: 10 }).select("id").single();
    def = ins.data;
  }
  if (!def) return;
  const { data: existing } = await supabase
    .from("daily_metrics")
    .select("id")
    .eq("metric_id", def.id)
    .eq("log_date", date)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) await supabase.from("daily_metrics").update({ value }).eq("id", existing.id);
  else await supabase.from("daily_metrics").insert({ metric_id: def.id, log_date: date, value });
}

function scale(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

/** The check-in form: only the fields that were filled are written; the rest stays as it was. */
export async function saveCheckin(_prev: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const date = String(form.get("date") ?? "") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < addDays(today, -6)) return { error: "Pick today or one of the last 6 days." };

  const mood = scale(form.get("mood"));
  const energy = scale(form.get("energy"));
  const bedRaw = String(form.get("bed") ?? "").trim();
  const wakeRaw = String(form.get("wake") ?? "").trim();
  const highlight = String(form.get("highlight") ?? "").trim().slice(0, 280);
  const bed = bedRaw ? parseClock(bedRaw) : null;
  const wake = wakeRaw ? parseClock(wakeRaw) : null;
  if (bedRaw && bed === null) return { error: "I couldn't read the bedtime. Use a time like 23:30." };
  if (wakeRaw && wake === null) return { error: "I couldn't read the wake-up time. Use a time like 07:15." };

  // Make sure the day's row exists (rebuilt from the raw data), then write only the inputs.
  await supabase.rpc("refresh_my_daily_facts", { p_from: date, p_to: date });

  const patch: Record<string, unknown> = {};
  if (mood !== null) {
    await setMetric(supabase, "Mood", date, mood);
    patch.mood = mood;
  }
  if (energy !== null) {
    await setMetric(supabase, "Energy", date, energy);
    patch.energy = energy;
  }
  // The row of a day is the day you wake up: a bedtime from 12:00 on belongs to the night before.
  if (bed !== null) {
    const bedDate = bed >= 12 * 60 ? addDays(date, -1) : date;
    patch.bedtime = zonedToUtc(bedDate, minutesToTime(bed), timezone).toISOString();
  }
  if (wake !== null) patch.wake_at = zonedToUtc(date, minutesToTime(wake), timezone).toISOString();
  if (highlight) patch.highlight = highlight;
  if (!Object.keys(patch).length) return { error: "Fill at least one field." };

  const { data, error } = await supabase.from("daily_facts").update(patch).eq("date", date).select("date");
  if (error) return { error: error.code === "23514" ? "Bedtime has to be before the wake-up time." : "Could not save. Try again." };
  if (!data?.length) return { error: "That day has no row yet. Try again in a moment." };
  revalidatePath("/insights");
  return { ok: true, at: Date.now() };
}
