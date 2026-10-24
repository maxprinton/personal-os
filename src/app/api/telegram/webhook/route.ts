import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { botToken, HELP, sendMessage, tg, unpackId, webhookSecret } from "@/lib/telegram";
import { parseMessage, saveParsed, undoSaved, userContext } from "@/lib/capture";
import { completeTaskFromBot, markHabitFromBot } from "@/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAILY_LIMIT = 100;

type TgUpdate = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: Request) {
  const token = botToken();
  if (!token) return ok();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret(token)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return ok();
  const update = (await req.json().catch(() => ({}))) as TgUpdate;

  // ---- "Undo" button --------------------------------------------------
  // ---- Habit buttons (evening check-in): hk:d = done, hk:s = skip, per habit inside its block ----
  const habitBtn = /^hk:([ds]):([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{22})$/.exec(update.callback_query?.data ?? "");
  if (update.callback_query && habitBtn) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    let text = "Could not log that.";
    let logged = false;
    const habitId = unpackId(habitBtn[2]);
    const occurrenceId = unpackId(habitBtn[3]);
    if (chatId && habitId && occurrenceId) {
      const { data: s } = await admin
        .from("user_settings")
        .select("user_id,timezone")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
      if (s) {
        const r = await markHabitFromBot(
          admin,
          s.user_id,
          s.timezone ?? "America/Guayaquil",
          habitId,
          occurrenceId,
          habitBtn[1] === "d" ? "done" : "skipped"
        );
        text = r.text;
        logged = r.ok;
      }
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: text.slice(0, 190) });
    if (chatId && logged) await sendMessage(chatId, text);
    return ok();
  }

  // ---- Task buttons: tk = complete the task (the only task action Telegram allows) ----
  const taskBtn = /^tk:([A-Za-z0-9_-]{22})$/.exec(update.callback_query?.data ?? "");
  if (update.callback_query && taskBtn) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const taskId = unpackId(taskBtn[1]);
    let r = { ok: false, text: "Could not complete that." };
    if (chatId && taskId) {
      const { data: s } = await admin
        .from("user_settings")
        .select("user_id,timezone")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
      if (s) r = await completeTaskFromBot(admin, s.user_id, s.timezone ?? "America/Guayaquil", taskId);
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: r.text.slice(0, 190) });
    if (chatId && r.ok) await sendMessage(chatId, r.text);
    return ok();
  }

  // Buttons from the old (v1) evening message
  if (update.callback_query && /^(hd|hs):/.test(update.callback_query.data ?? "")) {
    await tg("answerCallbackQuery", {
      callback_query_id: update.callback_query.id,
      text: "This button is from an older version. Use tonight's check-in, or mark it on the computer.",
    });
    return ok();
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const botMessageId = cq.data?.startsWith("undo:") ? cq.data.slice(5) : null;
    let text = "Nothing to undo.";
    if (chatId && botMessageId) {
      const { data: settings } = await admin.from("user_settings").select("user_id").eq("telegram_chat_id", chatId).maybeSingle();
      if (settings) {
        const { data: bm } = await admin
          .from("bot_messages")
          .select("id,entity_type,entity_id,status")
          .eq("id", botMessageId)
          .eq("user_id", settings.user_id)
          .maybeSingle();
        if (bm && bm.status === "saved" && bm.entity_type && bm.entity_id) {
          await undoSaved(admin, settings.user_id, bm.entity_type, bm.entity_id);
          await admin.from("bot_messages").update({ status: "undone" }).eq("id", bm.id);
          text = "Undone.";
        }
      }
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text });
    if (chatId && text === "Undone.") await sendMessage(chatId, "Undone. Nothing was kept.");
    return ok();
  }

  const msg = update.message;
  const text = msg?.text?.trim();
  if (!msg || !text) return ok();
  const chatId = msg.chat.id;

  if (/^\/(start|help)\b/i.test(text) && !/^\/start\s+\S/.test(text)) {
    await sendMessage(chatId, `${HELP}\n\nFirst time? In Personal OS open Settings → Telegram, get a code and send: /link CODE`);
    return ok();
  }

  // ---- Linking: "/link ABC123" (or "/start ABC123") ---------------------
  const link = /^\/(?:link|start)\s+([A-Z0-9]{6,12})$/i.exec(text);
  if (link) {
    const code = link[1].toUpperCase();
    const { data: s } = await admin
      .from("user_settings")
      .select("user_id,telegram_link_expires")
      .eq("telegram_link_code", code)
      .maybeSingle();
    if (!s || !s.telegram_link_expires || new Date(s.telegram_link_expires) < new Date()) {
      await sendMessage(chatId, "That code is invalid or expired. Generate a new one in Settings → Telegram.");
      return ok();
    }
    await admin.from("user_settings").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
    await admin
      .from("user_settings")
      .update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_expires: null })
      .eq("user_id", s.user_id);
    await sendMessage(chatId, `Linked! ${HELP}`);
    return ok();
  }

  const { data: settings } = await admin.from("user_settings").select("user_id").eq("telegram_chat_id", chatId).maybeSingle();
  if (!settings) {
    await sendMessage(chatId, "This chat is not linked yet. In Personal OS open Settings → Telegram, get a code and send: /link CODE");
    return ok();
  }
  const userId = settings.user_id as string;

  // ---- /undo -------------------------------------------------------------
  if (/^\/undo\b/i.test(text)) {
    const { data: last } = await admin
      .from("bot_messages")
      .select("id,entity_type,entity_id")
      .eq("user_id", userId)
      .eq("status", "saved")
      .is("deleted_at", null)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.entity_type && last.entity_id) {
      await undoSaved(admin, userId, last.entity_type, last.entity_id);
      await admin.from("bot_messages").update({ status: "undone" }).eq("id", last.id);
      await sendMessage(chatId, "Undone.");
    } else {
      await sendMessage(chatId, "Nothing to undo.");
    }
    return ok();
  }
  if (text.startsWith("/")) {
    await sendMessage(chatId, HELP);
    return ok();
  }

  // ---- Rate limit -------------------------------------------------------
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from("bot_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("received_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) {
    await sendMessage(chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`);
    return ok();
  }

  // ---- Capture -----------------------------------------------------------
  const { data: bm } = await admin
    .from("bot_messages")
    .insert({ user_id: userId, raw_text: text.slice(0, 4000) })
    .select("id")
    .single();
  try {
    const ctx = await userContext(admin, userId);
    const { parsed, by } = await parseMessage(text, ctx.today, ctx.categories.map((c) => c.name));
    const saved = await saveParsed(admin, userId, parsed, "telegram_bot", ctx);
    if (bm) {
      await admin
        .from("bot_messages")
        .update({ status: "saved", parsed: { ...parsed, by }, entity_type: saved.entityType, entity_id: saved.id })
        .eq("id", bm.id);
    }
    await sendMessage(chatId, `Saved ✓ ${saved.summary}`, bm?.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (bm) await admin.from("bot_messages").update({ status: "failed", error: message }).eq("id", bm.id);
    await sendMessage(chatId, "Sorry, I could not save that. Try rephrasing, e.g. \"spent 12 on lunch\".");
  }
  return ok();
}
