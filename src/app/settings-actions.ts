"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { botToken, tg, webhookSecret } from "@/lib/telegram";
import type { ActionState } from "@/app/actions";
import { liveTagLinks } from "@/lib/tags";
import { dayData, morningText } from "@/lib/reminders";
import { localNow } from "@/lib/time";

/** One-time code the user sends to the bot: /link CODE (valid 15 minutes). */
export async function createLinkCode() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  await supabase
    .from("user_settings")
    .update({ telegram_link_code: code, telegram_link_expires: new Date(Date.now() + 15 * 60 * 1000).toISOString() })
    .eq("user_id", user.id);
  revalidatePath("/settings");
}

export async function unlinkTelegram() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_settings").update({ telegram_chat_id: null }).eq("user_id", user.id);
  revalidatePath("/settings");
}

/** Points the Telegram bot at this app's webhook. */
export async function connectBot(_prev: ActionState): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const token = botToken();
  if (!token) return { error: "TELEGRAM_BOT_TOKEN is not set in Vercel yet." };
  if (!process.env.SUPABASE_SECRET_KEY) return { error: "SUPABASE_SECRET_KEY is not set in Vercel yet." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || host.startsWith("localhost")) return { error: "Connect the bot from the public site, not localhost." };
  const res = await tg("setWebhook", {
    url: `https://${host}/api/telegram/webhook`,
    secret_token: webhookSecret(token),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  if (!res?.ok) return { error: `Telegram said: ${res?.description ?? "no answer"}` };
  // The menu Telegram shows when you type "/" (not essential: a failure here doesn't stop the connection)
  await tg("setMyCommands", {
    commands: [
      { command: "today", description: "Today: block, tasks, habits, payments, notes" },
      { command: "now", description: "The block of right now: tasks, habits, note" },
      { command: "tomorrow", description: "Tomorrow: schedule, tasks, payments" },
      { command: "week", description: "Rest of this week, day by day" },
      { command: "nextweek", description: "Next week, day by day" },
      { command: "day", description: "Any day: /day friday · /day 5 nov" },
      { command: "tasks", description: "All open tasks, with buttons" },
      { command: "payments", description: "What to pay now and next" },
      { command: "balance", description: "Money in each account" },
      { command: "budget", description: "Budgets: spent, left" },
      { command: "movements", description: "Latest transactions (delete, account, receipt)" },
      { command: "unassigned", description: "Transactions without an account" },
      { command: "categorize", description: "AI categorizes your uncategorized transactions" },
      { command: "proposals", description: "New categories the AI suggests (create or skip)" },
      { command: "search", description: "Find tasks, notes, events, money: /search word" },
      { command: "notes", description: "Latest notes" },
      { command: "habits", description: "Streaks and today's habits" },
      { command: "metrics", description: "Today's metrics" },
      { command: "archived", description: "Archived tasks (restore)" },
      { command: "insights", description: "Unread insights" },
      { command: "settings", description: "Telegram reminders on/off and times" },
      { command: "usage", description: "AI used today and what's left" },
      { command: "undo", description: "Undo the last thing" },
      { command: "menu", description: "Show the buttons under the keyboard" },
      { command: "os", description: "Ask about your notes: /os question (or @os question)" },
      { command: "ai", description: "Check the AI connection" },
      { command: "help", description: "Everything the bot understands" },
    ],
  }).catch(() => null);
  revalidatePath("/settings");
  return { ok: true, at: Date.now() };
}

export async function generateInsightsNow() {
  const supabase = await createClient();
  await supabase.rpc("generate_my_insights");
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function markInsightRead(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("system_insights").update({ is_read: true }).eq("id", id);
  revalidatePath("/");
}

export async function deleteTag(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("entity_tags").update({ deleted_at: now }).eq("tag_id", id).is("deleted_at", null);
  await supabase.from("tags").update({ deleted_at: now }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/tasks");
  revalidatePath("/notes");
}

/** Removes every tag that is not used by any task, note, event or block. */
export async function deleteUnusedTags() {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { live, orphans } = await liveTagLinks(supabase);
  if (orphans.length) {
    await supabase.from("entity_tags").update({ deleted_at: now }).in("id", orphans.map((o) => o.id));
  }
  const { data: tags } = await supabase.from("tags").select("id").is("deleted_at", null);
  const inUse = new Set(live.map((u) => u.tag_id));
  const unused = ((tags ?? []) as { id: string }[]).map((t) => t.id).filter((id) => !inUse.has(id));
  if (unused.length) {
    await supabase.from("tags").update({ deleted_at: now }).in("id", unused);
  }
  revalidatePath("/settings");
}

export async function saveReminders(_prev: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const time = (v: FormDataEntryValue | null, fallback: string) => {
    const s = String(v ?? "");
    return /^\d{2}:\d{2}$/.test(s) ? s : fallback;
  };
  const before = Number(form.get("before") ?? 10);
  // "When a block ends" exists after migration 0019 (and only shows in the form then)
  if (form.get("block_end_present") !== null) {
    await supabase.from("user_settings").update({ reminder_block_end: form.get("block_end_on") === "on" }).eq("user_id", user.id);
  }
  const { error } = await supabase
    .from("user_settings")
    .update({
      reminder_morning_enabled: form.get("morning_on") === "on",
      reminder_morning_time: time(form.get("morning_time"), "07:00"),
      reminder_evening_enabled: form.get("evening_on") === "on",
      reminder_evening_time: time(form.get("evening_time"), "21:00"),
      reminder_before_minutes: [0, 5, 10, 15, 30, 60].includes(before) ? before : 10,
      reminder_insights: form.get("insights_on") === "on",
      reminder_unassigned_nag: form.get("unassigned_on") === "on",
    })
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true, at: Date.now() };
}

/** Sends today's morning summary right now, to check that reminders reach Telegram. */
export async function sendTestReminder(_prev: ActionState): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: s } = await supabase.from("user_settings").select("timezone,telegram_chat_id").eq("user_id", user.id).maybeSingle();
  if (!s?.telegram_chat_id) return { error: "Link your Telegram chat first." };
  const timezone = (s.timezone as string) ?? "America/Guayaquil";
  const date = localNow(timezone).date;
  const day = await dayData(supabase, { user_id: user.id, timezone }, date);
  const res = await tg("sendMessage", { chat_id: s.telegram_chat_id, text: `(Test)\n${morningText(date, day)}` });
  if (!res?.ok) return { error: `Telegram said: ${res?.description ?? "no answer"}` };
  return { ok: true, at: Date.now() };
}
