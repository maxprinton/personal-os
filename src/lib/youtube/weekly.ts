// YouTube add-on (Worker C) — pure logic of the weekly channel review (Telegram + note): when it is due and
// the text, from data the server gathers (new ideas, where each video is, check-ins, A/B tests, lessons,
// pending shots, new watchlist outliers).
import { addDays, startOfWeek } from "@/lib/time";
import { WEEKDAYS, stageLabel } from "@/lib/youtube/constants";
import type { CheckinKind, CheckinVerdict, WeeklyReviewPrefs, YtStage } from "@/lib/youtube/types";

/** 0 = Sunday … 6 = Saturday (like WEEKDAYS / WeeklyReviewPrefs.day). */
export const jsWeekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Due when today is the chosen day and we are within 2 h after the chosen time (the cron runs every 5 min). */
export function weeklyDue(prefs: WeeklyReviewPrefs, now: { date: string; minutes: number }, windowMin = 120) {
  if (!prefs.telegram && !prefs.note) return false;
  if (jsWeekday(now.date) !== prefs.day) return false;
  const [h, m] = (prefs.time || "18:00").split(":").map(Number);
  const at = h * 60 + m;
  return now.minutes >= at && now.minutes < at + windowMin;
}

/** The week a review covers: the 7 days ending on the review date (inclusive). Key = its first day. */
export function weekRange(date: string) {
  return { from: addDays(date, -6), to: date, key: startOfWeek(date) };
}

export type WeeklyData = {
  from: string;
  to: string;
  newIdeas: { label: string; source: string }[];
  byStage: { stage: YtStage; videos: string[] }[];
  wipLimit: number;
  wipCount: number;
  checkins: { video: string; kind: CheckinKind; verdict: CheckinVerdict | null; line: string }[];
  dueSoon: { video: string; kind: CheckinKind; due: string }[];
  tests: { video: string; kind: "test_compare" | "swap"; status: string }[];
  lessons: string[];
  pendingShots: { video: string; count: number }[];
  newOutliers: { title: string; score: number | null; channel?: string | null }[];
  published: string[];
};

const VERDICT_ICON: Record<string, string> = { above: "🟢", normal: "⚪", below: "🔴", insufficient: "…" };

/** Markdown for the note + plain text for Telegram (same content, Telegram shorter). */
export function weeklyText(d: WeeklyData, appUrl?: string): { title: string; markdown: string; telegram: string } {
  const title = `YouTube weekly · ${d.from} → ${d.to}`;
  const md: string[] = [];
  const tg: string[] = [`📺 YouTube weekly review (${d.from} → ${d.to})`];

  const sec = (h: string, lines: string[], tgMax = 5) => {
    if (!lines.length) return;
    md.push(`## ${h}`, ...lines.map((l) => `- ${l}`), "");
    tg.push("", `${h}:`, ...lines.slice(0, tgMax).map((l) => `• ${l}`), ...(lines.length > tgMax ? [`• …and ${lines.length - tgMax} more`] : []));
  };

  sec("Published this week", d.published);
  sec("New ideas", d.newIdeas.map((i) => `${i.label}${i.source !== "web" ? ` (${i.source})` : ""}`));
  sec(
    "Where each video is",
    d.byStage.filter((s) => s.videos.length).map((s) => `${stageLabel(s.stage)}: ${s.videos.join(", ")}`),
    8,
  );
  if (d.wipCount > d.wipLimit) {
    md.push(`> ⚠️ ${d.wipCount} videos in progress — your limit is ${d.wipLimit}. Finish one before starting another.`, "");
    tg.push("", `⚠️ ${d.wipCount} videos in progress (limit ${d.wipLimit}).`);
  }
  sec("Check-ins this week", d.checkins.map((c) => `${VERDICT_ICON[c.verdict ?? "insufficient"] ?? ""} ${c.video} · ${c.kind}: ${c.line}`.trim()));
  sec("Check-ins next week", d.dueSoon.map((c) => `${c.video} · ${c.kind} on ${c.due}`));
  sec("A/B tests", d.tests.map((t) => `${t.video} · ${t.kind === "test_compare" ? "Test & compare" : "Swap"}: ${t.status}`));
  sec("Lessons so far", d.lessons);
  sec("Shots still to film", d.pendingShots.map((p) => `${p.video}: ${p.count}`));
  sec("New outliers in watched channels", d.newOutliers.map((o) => `${o.title}${o.score ? ` (${o.score}×)` : ""}${o.channel ? ` — ${o.channel}` : ""}`));

  if (md.length === 0) {
    md.push("A quiet week: nothing new in the pipeline.", "");
    tg.push("", "A quiet week: nothing new in the pipeline.");
  }
  if (appUrl) tg.push("", `Open: ${appUrl}/youtube/weekly`);
  return { title, markdown: md.join("\n").trim(), telegram: tg.join("\n") };
}

export function weekdayName(day: number) {
  return WEEKDAYS[day] ?? WEEKDAYS[0];
}
