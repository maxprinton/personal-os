import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { botToken, packId, tg } from "@/lib/telegram";
import { runMaintenance } from "@/lib/calendar/maintenance";
import {
  beforeText,
  claim,
  dayData,
  eveningText,
  linkedTo,
  morningText,
  nowFor,
  REMINDER_COLUMNS,
  type ReminderSettings,
} from "@/lib/reminders";
import { timeToMinutes } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Called by the database every 5 minutes (pg_cron + pg_net). Decides what to send to each linked Telegram chat.

const WINDOW = 60; // minutes after the chosen time in which a late run still sends the message

async function send(chatId: number, text: string, keyboard?: { text: string; callback_data: string }[][]) {
  await tg("sendMessage", { chat_id: chatId, text, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
}

async function runForUser(admin: SupabaseClient, s: ReminderSettings) {
  const now = nowFor(s);
  const date = now.date;
  const day = await dayData(admin, s, date);
  let sent = 0;

  if (s.reminder_morning_enabled) {
    const at = timeToMinutes(s.reminder_morning_time);
    if (now.minutes >= at && now.minutes < at + WINDOW && (await claim(admin, s.user_id, "morning", date))) {
      await send(s.telegram_chat_id, morningText(date, day));
      sent++;
    }
  }

  if (s.reminder_before_minutes > 0) {
    for (const item of day.items) {
      const diff = item.start - now.minutes;
      if (diff > 0 && diff <= s.reminder_before_minutes) {
        if (await claim(admin, s.user_id, "before", `${item.kind}:${item.id}:${date}`)) {
          const ctx = await linkedTo(admin, s.user_id, item.kind, item.kind === "block" ? item.blockTypeId ?? item.id : item.id);
          await send(s.telegram_chat_id, beforeText(item, diff, ctx));
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
        // One row per habit inside its block: ✓ / Skip
        pending.slice(0, 40).map((h) => [
          { text: `✓ ${h.title}`.slice(0, 60), callback_data: `hk:d:${packId(h.habitId)}:${packId(h.occurrenceId)}` },
          { text: "Skip", callback_data: `hk:s:${packId(h.habitId)}:${packId(h.occurrenceId)}` },
        ])
      );
      sent++;
    }
  }

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
  if (!botToken()) return NextResponse.json({ ok: true, sent: 0 });

  const { data } = await admin.from("user_settings").select(REMINDER_COLUMNS).not("telegram_chat_id", "is", null);
  let sent = 0;
  for (const s of (data ?? []) as unknown as ReminderSettings[]) {
    try {
      sent += await runForUser(admin, s);
    } catch {
      // one user's problem must not stop the others
    }
  }
  return NextResponse.json({ ok: true, sent });
}
