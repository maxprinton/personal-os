"use server";
// /youtube/settings — save the add-on settings (Lead).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/actions";
import { FINDER_DEFAULTS, parseChannelUrl } from "@/lib/youtube/constants";
import { isMissingTable } from "@/lib/youtube/db";
import type { FinderFilters, SonicIdentity, WeeklyReviewPrefs } from "@/lib/youtube/types";

function str(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s || null;
}
/** "" → null · not a number / out of range → NaN */
function num(v: FormDataEntryValue | null, min: number, max: number) {
  const s = String(v ?? "").trim().replace(/[\s,_]/g, "");
  if (!s) return null;
  const n = Number(s.replace(/k$/i, "000").replace(/m$/i, "000000"));
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

export async function saveYtSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  const bad: string[] = [];
  const check = (label: string, n: number | null) => {
    if (n !== null && Number.isNaN(n)) bad.push(label);
    return n !== null && !Number.isNaN(n) ? n : null;
  };

  const channelRaw = str(form.get("channel_url"));
  const channel = channelRaw ? parseChannelUrl(channelRaw) : null;
  if (channelRaw && !channel) return { error: "The channel link should look like https://www.youtube.com/@yourname" };

  const viewGoal = check("View goal", num(form.get("view_goal"), 0, 1e10));
  const wpm = check("Words per minute (60–400)", num(form.get("words_per_min"), 60, 400));
  const wip = check("Work-in-progress limit (1–50)", num(form.get("wip_limit"), 1, 50));
  const finder: FinderFilters = {
    min_views: check("Finder · min views", num(form.get("min_views"), 0, 1e10)) ?? FINDER_DEFAULTS.min_views,
    max_subs: check("Finder · max subscribers", num(form.get("max_subs"), 0, 1e10)) ?? FINDER_DEFAULTS.max_subs,
    min_outlier: check("Finder · min outlier (×)", num(form.get("min_outlier"), 1, 1000)) ?? FINDER_DEFAULTS.min_outlier,
    min_age_days: check("Finder · min age (days)", num(form.get("min_age_days"), 0, 3650)) ?? FINDER_DEFAULTS.min_age_days,
    max_results: check("Finder · max results (5–50)", num(form.get("max_results"), 5, 50)) ?? FINDER_DEFAULTS.max_results,
  };
  const shorts = String(form.get("shorts") ?? "exclude");
  if (shorts === "include" || shorts === "only" || shorts === "exclude") finder.shorts = shorts;
  const bpmMin = check("BPM from (40–220)", num(form.get("bpm_min"), 40, 220));
  const bpmMax = check("BPM to (40–220)", num(form.get("bpm_max"), 40, 220));
  if (bad.length) return { error: `Check: ${bad.join(", ")}.` };
  if (bpmMin !== null && bpmMax !== null && bpmMin > bpmMax) return { error: "BPM “from” must be lower than “to”." };

  const sonic: SonicIdentity = {
    instruments: String(form.get("instruments") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20),
    bpm_min: bpmMin,
    bpm_max: bpmMax,
    key: str(form.get("music_key")),
    style: str(form.get("music_style")),
    notes: str(form.get("music_notes")),
  };
  const day = Number(form.get("weekly_day") ?? 0);
  const time = String(form.get("weekly_time") ?? "18:00");
  const weekly: WeeklyReviewPrefs = {
    day: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "18:00",
    telegram: form.get("weekly_telegram") === "on",
    note: form.get("weekly_note") === "on",
  };

  const supabase = await createClient();
  const { data: before } = await supabase.from("yt_settings").select("channel_url,channel_id,channel_title").maybeSingle();
  const channelChanged = (before?.channel_url ?? null) !== (channel?.url ?? null);
  const { error } = await supabase.from("yt_settings").upsert(
    {
      channel_url: channel?.url ?? null,
      channel_handle: channel?.handle ?? null,
      // keep the id/title found by the API unless the link changed
      channel_id: channelChanged ? channel?.channelId ?? null : before?.channel_id ?? channel?.channelId ?? null,
      channel_title: channelChanged ? null : before?.channel_title ?? null,
      view_goal: viewGoal,
      words_per_min: wpm ?? 150,
      wip_limit: wip ?? 3,
      finder_filters: finder,
      sonic_identity: sonic,
      weekly_review: weekly,
      footage_root: str(form.get("footage_root")),
    },
    { onConflict: "user_id" },
  );
  if (error) return { error: isMissingTable(error) ? "Run MIGRACION-0031-youtube.sql in Supabase first, then try again." : error.message };
  revalidatePath("/youtube", "layout");
  return { ok: true, at: Date.now() };
}
