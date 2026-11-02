// Work log in Telegram (server only): /work (this month + videos still to post), "video B2-5 <Drive link>" to mark a video
// as posted, and the reminder sent after a class ends if its video is not posted yet. Every query filters by user_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/bot/core";
import { usd } from "@/lib/bot/core";
import type { Kb } from "@/lib/bot/tg";
import { claim } from "@/lib/reminders";
import { tg } from "@/lib/telegram";
import { addDays, formatMinutes, timeToMinutes } from "@/lib/time";
import {
  byTime, classEnded, fmtHours, monthBounds, monthKey, monthLabelEn, needsEvidence, shortDay, summarize, toWorkClass, type WorkClass,
} from "@/lib/work-log";

type Reply = { text: string; kb: Kb };

const MISSING = "The work log isn't set up yet. In Supabase run MIGRACION-0027-registro-de-horas.sql, then try again.";

/** Finished classes (any month) whose video is not posted. Newest first. */
async function toPost(admin: SupabaseClient, userId: string, today: string, nowMin: number): Promise<{ list: WorkClass[]; missing: boolean }> {
  const { data, error } = await admin
    .from("work_classes")
    .select("*")
    .eq("user_id", userId)
    .eq("video_posted", false)
    .lte("class_date", today)
    .order("class_date", { ascending: false })
    .limit(200);
  if (error) return { list: [], missing: true };
  const now = { date: today, minutes: nowMin };
  return { list: ((data ?? []) as Record<string, unknown>[]).map(toWorkClass).filter((c) => c.status === "taught" && classEnded(c, now)), missing: false };
}

export async function workView(c: Ctx): Promise<Reply> {
  const month = monthKey(c.today);
  const { from, to } = monthBounds(month);
  const { data, error } = await c.admin.from("work_classes").select("*").eq("user_id", c.userId).gte("class_date", from).lte("class_date", to);
  if (error) return { text: MISSING, kb: [] };
  const classes = ((data ?? []) as Record<string, unknown>[]).map(toWorkClass).sort(byTime);
  const sum = summarize(classes, { date: c.today, minutes: c.nowMin });
  const pending = (await toPost(c.admin, c.userId, c.today, c.nowMin)).list;
  const L = [`💼 Work · ${monthLabelEn(month)}`, `${sum.classes} ${sum.classes === 1 ? "class" : "classes"} · ${fmtHours(sum.hours)} h · ${usd(sum.amount)}${sum.cancelled ? ` · ${sum.cancelled} cancelled by students` : ""}`];
  if (sum.recoveryHours || sum.extraHours || sum.collaborationCount) {
    L.push(`Extra ${fmtHours(sum.extraHours)} h · Recovered ${fmtHours(sum.recoveryHours)} h · Collaborations ${sum.collaborationCount}`);
  }
  if (sum.missingEvidenceCount) L.push(`⚠️ ${sum.missingEvidenceCount} extra/recovered ${sum.missingEvidenceCount === 1 ? "class has" : "classes have"} no video link yet — not counted for the company.`);
  if (pending.length) {
    L.push("", `🎥 Videos still to post (${pending.length})`);
    for (const p of pending.slice(0, 10)) L.push(`• ${p.group_name} · ${shortDay(p.class_date)}${needsEvidence(p.sheet_type) ? " · needed as evidence" : ""}`);
    if (pending.length > 10) L.push(`+ ${pending.length - 10} older ones on the web`);
    L.push("", "When it's posted, send: video <class> <Drive link>  (e.g. video " + pending[0].group_name + " https://drive.google.com/…)");
  } else {
    L.push("", "🎥 Every finished class has its video marked as posted.");
  }
  return { text: L.join("\n"), kb: [] };
}

/** "video B2-5 <link>": marks the most recent finished class of that group without a video (or the latest one without a group). */
export async function markVideo(c: Ctx, group: string | null, url: string): Promise<Reply> {
  const { list, missing } = await toPost(c.admin, c.userId, c.today, c.nowMin);
  if (missing) return { text: MISSING, kb: [] };
  const hit = group ? list.find((x) => x.group_name.trim().toLowerCase() === group.trim().toLowerCase()) : list[0];
  if (!hit) {
    return {
      text: group
        ? `I found no finished class “${group}” waiting for a video.${list.length ? `\nWaiting: ${[...new Set(list.map((x) => x.group_name))].slice(0, 8).join(", ")}` : ""}`
        : "Every finished class already has its video marked as posted.",
      kb: [],
    };
  }
  const { error } = await c.admin
    .from("work_classes")
    .update({ video_posted: true, video_url: url, video_posted_at: new Date().toISOString() })
    .eq("id", hit.id)
    .eq("user_id", c.userId);
  if (error) return { text: "I couldn't save that. Try again in a minute.", kb: [] };
  const left = list.length - 1;
  return { text: `✓ Video saved for ${hit.group_name} · ${shortDay(hit.class_date)}.${left ? ` ${left} more waiting.` : " That was the last one."}`, kb: [] };
}

/** Sent by the 5-minute cron: 10 minutes to 12 hours after a class ended without its video posted (once per class). */
export async function workVideoReminders(
  admin: SupabaseClient,
  s: { user_id: string; telegram_chat_id: number },
  now: { date: string; minutes: number },
): Promise<number> {
  const { data, error } = await admin
    .from("work_classes")
    .select("*")
    .eq("user_id", s.user_id)
    .eq("video_posted", false)
    .gte("class_date", addDays(now.date, -1))
    .lte("class_date", now.date);
  if (error || !data?.length) return 0;
  let folder: string | null | undefined;
  let sent = 0;
  for (const c of (data as Record<string, unknown>[]).map(toWorkClass).filter((x) => x.status === "taught").sort(byTime)) {
    if (!classEnded(c, now)) continue;
    const start = timeToMinutes(c.start_time);
    let end = timeToMinutes(c.end_time);
    if (end < start) end += 1440; // past midnight
    const since = now.minutes - (end - (c.class_date === now.date ? 0 : 1440));
    if (since < 10 || since > 720) continue;
    if (!(await claim(admin, s.user_id, "workvideo", c.id))) continue;
    if (folder === undefined) {
      const { data: set } = await admin.from("work_settings").select("video_folder_url").eq("user_id", s.user_id).maybeSingle();
      folder = (set?.video_folder_url as string | null) ?? null;
    }
    const lines = [
      `🎥 ${c.group_name} ended (${formatMinutes(start)} – ${formatMinutes(end % 1440)}) and its video isn't posted yet.`,
      needsEvidence(c.sheet_type) ? "The company voids Hora Extra / Recuperación without the full recording." : "",
      folder ? `Drive folder: ${folder}` : "",
      `When it's up, send: video ${c.group_name} <Drive link>`,
    ].filter(Boolean);
    await tg("sendMessage", { chat_id: s.telegram_chat_id, text: lines.join("\n"), disable_web_page_preview: true });
    sent++;
  }
  return sent;
}
