import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { botToken, tg } from "@/lib/telegram";
import { runMaintenance } from "@/lib/calendar/maintenance";
import { healSeries } from "@/lib/calendar/series";
import { runTemplateSchedules } from "@/lib/notes-db/templates";
import { writingInsight } from "@/lib/writing/insight";
import {
  beforeText,
  claim,
  dayData,
  eveningText,
  linkedTo,
  morningText,
  nowFor,
  placeButtons,
  REMINDER_COLUMNS,
  taskButtons,
  unassignedText,
  type ReminderSettings,
} from "@/lib/reminders";
import { addDays, formatMinutes, timeToMinutes, utcToLocal } from "@/lib/time";
import { habitRow } from "@/lib/bot/habits";
import { blockDoneRow, payRow } from "@/lib/bot/calendar";
import { makeCtx } from "@/lib/bot/core";
import { checkinView } from "@/lib/bot/day";
import { findPatterns, loadPatternRows } from "@/lib/patterns";
import { isoWeekday } from "@/lib/time";
import { accountRows, budgetAlert, setReceipt } from "@/lib/bot/finance";
import { pk, type Kb } from "@/lib/bot/tg";
import { savePendingTransaction } from "@/lib/capture";
import { describe, type Parsed } from "@/lib/parse";
import { startOfDay, usageReport, usageSummary } from "@/lib/ai-usage";
import { runNightly } from "@/lib/auto-categorize";
import { purgeExpired } from "@/lib/notes-trash";
import { listProposals } from "@/lib/category-proposals";
import { proposalsReply } from "@/lib/bot/categorize";
import { localNow } from "@/lib/time";
import { workVideoReminders } from "@/lib/bot/work";
import { runYoutubeCron } from "@/lib/youtube/server/cron";
import { runSearchCron } from "@/lib/search/server";
import { runPortfolioNudge } from "@/lib/bot/portfolio";
import { runBacklogCron, runStepsCron } from "@/lib/bot/backlog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the database every 5 minutes (pg_cron + pg_net). Decides what to send to each linked Telegram chat.

const WINDOW = 60; // minutes after the chosen time in which a late run still sends the message

async function send(chatId: number, text: string, keyboard?: { text: string; callback_data: string }[][]) {
  await tg("sendMessage", { chat_id: chatId, text, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
}

type PhoneLink = { linked: boolean; lastSync: string | null };

async function runForUser(admin: SupabaseClient, s: ReminderSettings & { blockEnd?: boolean; phone?: PhoneLink }) {
  const now = nowFor(s);
  const date = now.date;
  const day = await dayData(admin, s, date);
  let sent = 0;
  // Blocks that ring on the phone: the phone acts, Telegram stays quiet before and after them
  const leftToPhone = (i: { kind: string; phoneAlarm?: boolean }) => Boolean(s.phone?.linked && i.kind === "block" && i.phoneAlarm);

  // ⏰ The phone stopped reading its alarms for 3+ hours (daytime only): one warning per silence
  if (s.phone?.linked && s.phone.lastSync && now.minutes >= 6 * 60 && now.minutes < 23 * 60) {
    const quietFor = Date.now() - Date.parse(s.phone.lastSync);
    if (quietFor > 3 * 3600_000 && (await claim(admin, s.user_id, "alarmsync", s.phone.lastSync))) {
      const since = formatMinutes(utcToLocal(s.phone.lastSync, s.timezone).minutes);
      await send(
        s.telegram_chat_id,
        `⏰ Your phone hasn't synced its alarms since ${since}. Open Personal OS Alarms on the phone so your next alarms are right.`
      );
      sent++;
    }
  }

  if (s.reminder_morning_enabled) {
    const at = timeToMinutes(s.reminder_morning_time);
    if (now.minutes >= at && now.minutes < at + WINDOW && (await claim(admin, s.user_id, "morning", date))) {
      const kb: Kb = [...taskButtons(day.tasks), ...day.payments.slice(0, 5).map((p) => payRow({ ...p, template: p.template ?? null }, date))];
      // ✨ yesterday's AI usage at the end of the morning summary
      const yesterday = addDays(date, -1);
      const sum = await usageSummary(admin, { from: startOfDay(yesterday, s.timezone), tz: s.timezone, userId: s.user_id }).catch(() => null);
      const ai = usageReport(sum, yesterday, { title: "yesterday", short: true });
      await send(s.telegram_chat_id, `${morningText(date, day)}${ai ? `\n\n${ai}` : ""}`, kb.length ? kb : undefined);
      sent++;
    }
  }

  // Telegram keeps insisting while tasks have no block (11:00 and 16:00, if still true)
  if (s.reminder_unassigned_nag && day.unassigned > 0 && !day.freeDay) {
    for (const at of [11 * 60, 16 * 60]) {
      if (now.minutes >= at && now.minutes < at + WINDOW && (await claim(admin, s.user_id, "unassigned", `${date}:${at}`))) {
        const loose = day.tasks.filter((t) => !t.occurrence_id && !t.event_id);
        await send(s.telegram_chat_id, unassignedText(day.unassigned).trim(), placeButtons(loose));
        sent++;
      }
    }
  }

  if (s.reminder_before_minutes > 0) {
    for (const item of day.items) {
      if (leftToPhone(item)) continue;
      const diff = item.start - now.minutes;
      if (diff > 0 && diff <= s.reminder_before_minutes) {
        if (await claim(admin, s.user_id, "before", `${item.kind}:${item.id}:${date}`)) {
          const ctx = await linkedTo(admin, s.user_id, item.kind, item.kind === "block" ? item.blockTypeId ?? item.id : item.id);
          // Tasks placed in this block (any appearance of it today) or in this event
          const sameBlock = new Set(
            day.items.filter((i) => i.kind === "block" && i.blockTypeId === item.blockTypeId).map((i) => i.id)
          );
          const placed = day.tasks.filter((t) =>
            item.kind === "block" ? t.occurrence_id && sameBlock.has(t.occurrence_id) : t.event_id === item.id
          );
          const titles = [...new Set([...placed.map((t) => t.title), ...ctx.tasks])];
          await send(
            s.telegram_chat_id,
            beforeText(item, diff, { tasks: titles, notes: ctx.notes }),
            placed.length ? taskButtons(placed) : undefined
          );
          sent++;
        }
      }
    }
  }

  if (s.reminder_evening_enabled) {
    const at = timeToMinutes(s.reminder_evening_time);
    const { text, pending } = eveningText(day);
    const worthSending = pending.length > 0 || day.tasks.length > 0;
    if (worthSending && now.minutes >= at && now.minutes < at + WINDOW && (await claim(admin, s.user_id, "evening", date))) {
      await send(
        s.telegram_chat_id,
        text,
        // One row per habit inside its block: ✓ / Skip. Then ✓ for open tasks.
        [...pending.slice(0, 30).map(habitRow), ...taskButtons(day.tasks, 8)]
      );
      sent++;
    }
  }

  // 21:00 check-in: the day's numbers and buttons for mood, energy and sleep (same data the app's Insights page edits)
  if (s.reminder_evening_enabled) {
    const at = 21 * 60;
    if (now.minutes >= at && now.minutes < at + WINDOW && (await claim(admin, s.user_id, "checkin", date))) {
      const v = await checkinView(makeCtx(admin, s.user_id, s.telegram_chat_id, s.timezone), { evening: true });
      await send(s.telegram_chat_id, v.text, v.kb);
      sent++;
    }
  }

  // Mondays 09:00: the patterns found in your own days (only once there are 28 logged days and a clear difference)
  if (s.reminder_insights && isoWeekday(date) === 1) {
    const at = 9 * 60;
    if (now.minutes >= at && now.minutes < at + WINDOW && (await claim(admin, s.user_id, "patterns", date))) {
      const rows = await loadPatternRows(admin, addDays(date, -90), date, s.timezone, s.user_id).catch(() => []);
      const found = findPatterns(rows);
      if (found.unlocked && found.patterns.length) {
        await send(s.telegram_chat_id, ["🔎 Patterns in your days", "", ...found.patterns.map((p) => `• ${p.text}`), "", "More in Insights."].join("\n"));
        sent++;
      }
    }
  }

  // When a block ends: what is still open in it (tasks, habits), with ✓ for the block
  if (s.blockEnd) {
    const ended = day.items.filter(
      (i) => i.kind === "block" && !leftToPhone(i) && i.end <= 1440 && now.minutes >= i.end && now.minutes < i.end + 20
    );
    if (ended.length) {
      const { data: occRows } = await admin
        .from("block_occurrences")
        .select("id,status")
        .eq("user_id", s.user_id)
        .in("id", ended.map((i) => i.id));
      const status = new Map(((occRows ?? []) as { id: string; status: string }[]).map((o) => [o.id, o.status]));
      for (const item of ended) {
        if (status.get(item.id) === "done") continue;
        const sameBlock = new Set(day.items.filter((i) => i.kind === "block" && i.blockTypeId === item.blockTypeId).map((i) => i.id));
        const open = day.tasks.filter((t) => t.occurrence_id && sameBlock.has(t.occurrence_id));
        const habits = day.habits.filter((h) => h.occurrenceId === item.id && !h.status);
        if (!open.length && !habits.length) continue;
        if (!(await claim(admin, s.user_id, "after", item.id))) continue;
        const lines = [`🏁 ${item.title} ended (${formatMinutes(item.start % 1440)} – ${formatMinutes(item.end % 1440)})`];
        if (open.length) lines.push(`\n✅ Still open here:\n${open.map((t) => `• ${t.title}`).join("\n")}`);
        if (habits.length) lines.push(`\n🔁 Not logged: ${habits.map((h) => h.title.split(" · ").slice(1).join(" · ")).join(", ")}`);
        lines.push("\nTap ✓ for what you did, ⏭ to move the rest.");
        await send(s.telegram_chat_id, lines.join("\n"), [
          ...habits.slice(0, 8).map(habitRow),
          ...taskButtons(open, 8),
          blockDoneRow(item.id, item.title, false),
        ]);
        sent++;
      }
    }
  }

  // 🎥 A class ended and its video isn't posted: one reminder per class (the work log is optional — errors are ignored)
  try {
    sent += await workVideoReminders(admin, s, now);
  } catch {
    // no work log yet
  }

  // 🆕 New categories the AI proposed (last 36 h), asked once a day at the morning time with ✓ / ✕ buttons
  {
    const at = timeToMinutes(s.reminder_morning_time);
    if (now.minutes >= at && now.minutes < at + WINDOW) {
      const fresh = (await listProposals(admin, s.user_id).catch(() => [])).filter((p) => Date.now() - Date.parse(p.createdAt) < 36 * 3600_000);
      const reply = proposalsReply(fresh, "🆕 The AI suggests new categories for transactions that didn't fit yours");
      if (reply && (await claim(admin, s.user_id, "catprop", date))) {
        await send(s.telegram_chat_id, reply.text, reply.kb);
        sent++;
      }
    }
  }

  // Money messages nobody picked an account for (10+ min): saved without one, so nothing is lost
  sent += await settlePendingAccounts(admin, s);

  // ✍️ Your most repeated writing mistakes of last week (Mondays)
  await writingInsight(admin, s.user_id, date, now.minutes).catch(() => false);

  if (s.reminder_insights) {
    const { data } = await admin
      .from("system_insights")
      .select("insight_type,message,generated_at")
      .eq("user_id", s.user_id)
      .eq("is_read", false)
      .is("deleted_at", null)
      .gte("generated_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order("generated_at");
    const insights = (data ?? []) as { insight_type: string; message: string }[];
    if (insights.length && (await claim(admin, s.user_id, "insights", date))) {
      await send(
        s.telegram_chat_id,
        `🧭 Chief of Staff\n\n${insights.map((i) => `• ${i.message}`).join("\n")}`
      );
      sent++;
    }
  }
  return sent;
}

/** A money message waiting for its account for more than 10 minutes is saved without one, with the account buttons. */
async function settlePendingAccounts(admin: SupabaseClient, s: ReminderSettings & { blockEnd?: boolean }) {
  const { data } = await admin
    .from("bot_messages")
    .select("id,parsed,received_at")
    .eq("user_id", s.user_id)
    .eq("status", "parsed")
    .eq("parsed->>kind", "transaction")
    .lt("received_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .gt("received_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(5);
  let sent = 0;
  for (const bm of (data ?? []) as { id: string; parsed: Parsed & { receipt?: string } }[]) {
    const { data: claimed } = await admin.from("bot_messages").update({ status: "received" }).eq("id", bm.id).eq("status", "parsed").select("id");
    if (!claimed?.length) continue;
    try {
      const parsed = bm.parsed as Extract<Parsed, { kind: "transaction" }> & { receipt?: string };
      const saved = await savePendingTransaction(admin, s.user_id, parsed, null);
      await admin.from("bot_messages").update({ status: "saved", entity_type: saved.entityType, entity_id: saved.id }).eq("id", bm.id);
      const c = makeCtx(admin, s.user_id, s.telegram_chat_id, s.timezone);
      if (parsed.receipt) await setReceipt(c, saved.id, parsed.receipt).catch(() => null);
      const { data: accs } = await admin.from("accounts").select("id,name").eq("user_id", s.user_id).is("deleted_at", null).order("created_at");
      const kb: Kb = [
        ...accountRows((accs ?? []) as { id: string; name: string }[], (a) => `sa:${pk(saved.id)}:${a}`, false),
        [{ text: "Undo", callback_data: `undo:${bm.id}` }],
      ];
      await send(s.telegram_chat_id, `⏱ Saved without an account (no button was tapped): ${describe(parsed)}\nWhich account was it?`, kb);
      const alert = await budgetAlert(c, saved.id).catch(() => null);
      if (alert) await send(s.telegram_chat_id, alert);
      sent++;
    } catch {
      await admin.from("bot_messages").update({ status: "parsed" }).eq("id", bm.id).eq("status", "received");
    }
  }
  return sent;
}

/** Who has the phone app linked (an alarm key) and when it last synced (migration 0059; empty before it). */
async function phoneLinks(admin: SupabaseClient) {
  const map = new Map<string, PhoneLink>();
  let res = await admin.from("user_settings").select("user_id,alarm_key_hash,alarm_last_sync_at");
  if (res.error) res = await admin.from("user_settings").select("user_id,alarm_key_hash");
  if (res.error) return map;
  for (const r of (res.data ?? []) as { user_id: string; alarm_key_hash: string | null; alarm_last_sync_at?: string | null }[]) {
    map.set(r.user_id, { linked: Boolean(r.alarm_key_hash), lastSync: r.alarm_last_sync_at ?? null });
  }
  return map;
}

/** reminder_block_end (migration 0019); ON when the column doesn't exist yet. */
async function blockEndPrefs(admin: SupabaseClient) {
  const { data, error } = await admin.from("user_settings").select("user_id,reminder_block_end");
  const map = new Map<string, boolean>();
  if (!error) for (const r of (data ?? []) as { user_id: string; reminder_block_end: boolean | null }[]) map.set(r.user_id, r.reminder_block_end !== false);
  return map;
}

export async function POST(req: Request) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: true, skipped: "not configured" });

  const { data: secret } = await admin.from("cron_secrets").select("secret").eq("name", "reminders").maybeSingle();
  if (!secret || req.headers.get("x-cron-secret") !== secret.secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Calendar end-of-day routine for everyone (missed habits, block status, morning task placement)
  const { data: everyone } = await admin.from("user_settings").select("user_id,timezone");
  for (const u of (everyone ?? []) as { user_id: string; timezone: string | null }[]) {
    try {
      await runMaintenance(admin, u.user_id, u.timezone ?? "America/Guayaquil");
    } catch {
      // one user's problem must not stop the others
    }
    try {
      // Recurring tasks: a series whose last task is done but has no open one gets its next task (safety net)
      await healSeries(admin, u.user_id, u.timezone ?? "America/Guayaquil");
    } catch {
      // no migration yet, or a one-off error: never stops the rest of the cron
    }
  }
  // ✨ Nightly (about 02:00 local): the AI categorizes whatever is still uncategorized and files proposals for new
  // categories. Quiet on purpose: proposals reach Telegram in the morning, the rest shows on Finance with a ✨.
  const nightStart = Date.now();
  for (const u of (everyone ?? []) as { user_id: string; timezone: string | null }[]) {
    try {
      const now = localNow(u.timezone ?? "America/Guayaquil");
      if (now.minutes < 120 || now.minutes >= 240 || Date.now() - nightStart > 20_000) continue;
      if (await claim(admin, u.user_id, "autocat", now.date)) await runNightly(admin, u.user_id, 30_000);
    } catch (e) {
      console.error("nightly auto-categorize", e);
    }
  }
  // 🗑 Nightly (about 03:00 local): notes that have been in the trash for 30 days are deleted for good
  for (const u of (everyone ?? []) as { user_id: string; timezone: string | null }[]) {
    try {
      const now = localNow(u.timezone ?? "America/Guayaquil");
      if (now.minutes < 180 || now.minutes >= 300) continue;
      if (await claim(admin, u.user_id, "trashpurge", now.date)) await purgeExpired(admin, u.user_id);
    } catch (e) {
      console.error("nightly trash purge", e);
    }
  }
  // Scheduled note templates (Diario every day at 21:00…), with their Telegram notice
  let notesMade = 0;
  try {
    notesMade = await runTemplateSchedules(admin);
  } catch (e) {
    console.error("note templates", e);
  }
  // 🎬 YouTube add-on: check-ins, stats, watched channels, weekly review (optional — errors are ignored)
  let youtube = { sent: 0, refreshed: 0 };
  try {
    youtube = await runYoutubeCron(admin, { botReady: !!botToken(), budgetMs: 15_000 });
  } catch (e) {
    console.error("youtube cron", e);
  }
  // 🔎 Search index: notes whose text changed, then attached files waiting to be read
  let search = { notes: 0, files: 0 };
  try {
    search = await runSearchCron(admin, { budgetMs: 20_000 });
  } catch (e) {
    console.error("search cron", e);
  }
  if (!botToken()) return NextResponse.json({ ok: true, sent: 0, notesMade, youtube, search });

  const { data } = await admin.from("user_settings").select(REMINDER_COLUMNS).not("telegram_chat_id", "is", null);
  let sent = 0;
  const blockEnd = await blockEndPrefs(admin);
  const phones = await phoneLinks(admin);
  for (const s of (data ?? []) as unknown as ReminderSettings[]) {
    try {
      sent += await runForUser(admin, { ...s, blockEnd: blockEnd.get(s.user_id) ?? true, phone: phones.get(s.user_id) });
    } catch {
      // one user's problem must not stop the others
    }
    try {
      // 🌐 Portfolio add-on: Monday-morning check for pages changed but not republished (optional)
      sent += await runPortfolioNudge(admin, s, nowFor(s), {
        claim: (userId, kind, ref) => claim(admin, userId, kind, ref),
        deliver: (chatId, text) => send(chatId, text),
      });
    } catch {
      // the portfolio add-on is optional; its errors are ignored
    }
    try {
      // 🗂 Backlog: the "did it work in real use?" question (09:30) and the Monday summary (08:30)
      sent += await runBacklogCron(admin, s, nowFor(s), {
        claim: (userId, kind, ref) => claim(admin, userId, kind, ref),
        deliver: (chatId, text, kb) => send(chatId, text, kb),
      });
    } catch {
      // the Backlog is optional; its errors are ignored
    }
    try {
      // 🙋 Backlog: new "waiting on you" steps (migration, upload, keys) with a Done button
      sent += await runStepsCron(admin, s, { deliver: (chatId, text, kb) => send(chatId, text, kb) });
    } catch {
      // optional; errors are ignored
    }
  }
  return NextResponse.json({ ok: true, sent: sent + youtube.sent, notesMade, youtube, search });
}
