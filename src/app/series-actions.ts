"use server";

// Recurring tasks ("repeat after done"): create, edit, pause, resume, delete, skip. Rules in lib/calendar/series.ts.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { parseTags, setTags } from "@/lib/tags";
import { recomputeOccurrenceStatus } from "@/lib/calendar/habits";
import { createSeries, endSeries, nextText, pauseSeries, resumeSeries, skipCurrent, updateSeries } from "@/lib/calendar/series";
import { localNow } from "@/lib/time";
import type { ActionState } from "@/app/actions";

export type SeriesActionResult = { ok?: boolean; error?: string; message?: string };

function refresh() {
  revalidatePath("/");
  revalidatePath("/tasks");
}

async function sctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  const { timezone } = await getSettings(supabase);
  return { supabase, userId: user.id, timezone, today: localNow(timezone).date };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** "New recurring task" form on Tasks → Recurring. */
export async function addSeries(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await sctx();
    const r = await createSeries(c.supabase, c.userId, c.timezone, {
      title: String(form.get("title") ?? ""),
      homeBlockId: String(form.get("home_block") ?? "") || null,
      policy: form.get("rollover_policy"),
      unit: form.get("repeat_unit"),
      every: form.get("repeat_every"),
      firstDue: String(form.get("first_due") ?? "") || null,
    });
    if ("error" in r) return { error: r.error };
    const tags = parseTags(String(form.get("tags") ?? ""));
    if (tags.length) await setTags(c.supabase, "task", r.taskId, tags);
    refresh();
    return { ok: true, at: Date.now() };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Edit window of a series. */
export async function saveSeries(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await sctx();
    const r = await updateSeries(
      c.supabase,
      c.userId,
      String(form.get("id") ?? ""),
      {
        title: String(form.get("title") ?? ""),
        homeBlockId: String(form.get("home_block") ?? "") || null,
        policy: form.get("rollover_policy"),
        unit: form.get("repeat_unit"),
        every: form.get("repeat_every"),
      },
      c.timezone
    );
    if ("error" in r) return { error: r.error };
    refresh();
    return { ok: true, at: Date.now() };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function setSeriesActive(input: { seriesId: string; active: boolean }): Promise<SeriesActionResult> {
  try {
    const c = await sctx();
    const r = input.active ? await resumeSeries(c.supabase, c.userId, c.timezone, input.seriesId) : await pauseSeries(c.supabase, c.userId, input.seriesId);
    if ("error" in r) return { error: r.error };
    refresh();
    return { ok: true, message: input.active ? "Resumed." : "Paused. Nothing new will appear until you resume it." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Stops repeating for good. The open task stays as a normal task. */
export async function removeSeries(input: { seriesId: string }): Promise<SeriesActionResult> {
  try {
    const c = await sctx();
    const r = await endSeries(c.supabase, c.userId, input.seriesId);
    if ("error" in r) return { error: r.error };
    refresh();
    return { ok: true, message: "Stopped repeating. The open task stays as a normal task." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** "Skip this time": archives this one and the next is due today + the interval. */
export async function skipThisTime(input: { taskId: string }): Promise<SeriesActionResult> {
  try {
    const c = await sctx();
    const r = await skipCurrent(c.supabase, c.userId, c.timezone, input.taskId);
    if (!r) return { error: "Only the open task of a recurring series can be skipped." };
    if (r.occurrenceId) await recomputeOccurrenceStatus(c.supabase, c.userId, r.occurrenceId, c.today);
    refresh();
    return { ok: true, message: `Skipped. ${nextText(r)}` };
  } catch (e) {
    return { error: msg(e) };
  }
}
