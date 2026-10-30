import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { botToken, tg } from "@/lib/telegram";
import { runMaintenance } from "@/lib/calendar/maintenance";
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
import { addDays, formatMinutes, timeToMinutes } from "@/lib/time";
import { habitRow } from "@/lib/bot/habits";
import { blockDoneRow, payRow } from "@/lib/bot/calendar";
import { makeCtx } from "@/lib/bot/core";
import { accountRows, budgetAlert, setReceipt } from "@/lib/bot/finance";
import { pk, type Kb } from "@/lib/bot/tg";
import { savePendingTransaction } from "@/lib/capture";
import { describe, type Parsed } from "@/lib/parse";
import { startOfDay, usageReport, usageSummary } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Called by the database every 5 minutes (pg_cron + pg_net). Decides what to send to each linked Telegram chat.

const WINDOW = 60; // minutes after the chosen time in which a late run still sends the message

async function send(chatId: number, text: string, keyboard?: { text: string; callback_data: string }[][]) {
  await tg("sendMessage", { chat_id: chatId, text, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
}

async function runForUser(admin: SupabaseClient, s: ReminderSettings & { blockEnd?: boolean }) {
  const now = nowFor(s);
  const date = now.date;
  const day = await dayData(admin, s, date);
  let sent = 0;

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

  // When a block ends: what is still open in it (tasks, habits), with ✓ for the block
  if (s.blockEnd) {
    const ended = day.items.filter((i) => i.kind === "block" && i.end <= 1440 && now.minutes >= i.end && now.minutes < i.end + 20);
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
  }
  // Scheduled note templates (Diario every day at 21:00…), with their Telegram notice
  let notesMade = 0;
  try {
    notesMade = await runTemplateSchedules(admin);
  } catch (e) {
    console.error("note templates", e);
  }
  if (!botToken()) return NextResponse.json({ ok: true, sent: 0, notesMade });

  const { data } = await admin.from("user_settings").select(REMINDER_COLUMNS).not("telegram_chat_id", "is", null);
  let sent = 0;
  const blockEnd = await blockEndPrefs(admin);
  for (const s of (data ?? []) as unknown as ReminderSettings[]) {
    try {
      sent += await runForUser(admin, { ...s, blockEnd: blockEnd.get(s.user_id) ?? true });
    } catch {
      // one user's problem must not stop the others
    }
  }
  return NextResponse.json({ ok: true, sent, notesMade });
}
