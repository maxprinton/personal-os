import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { botToken, HELP, packId, sendMessage, tg, unpackId, webhookSecret } from "@/lib/telegram";
import { AccountChoiceNeeded, CaptureError, processCapture, savePendingTransaction, undoSaved } from "@/lib/capture";
import { describe, type Parsed } from "@/lib/parse";
import { balanceText, isBalanceRequest } from "@/lib/bot-balance";
import { completeTaskFromBot, markHabitFromBot } from "@/lib/reminders";
import { parseHabitCommand, runHabitCommand } from "@/lib/bot-habits";
import { isTodayRequest, todayStatus } from "@/lib/bot-today";
import { aheadRequest, aheadText } from "@/lib/bot-ahead";
import { archiveFromBot, rescheduleNextFromBot } from "@/lib/bot-task-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAILY_LIMIT = 100;

type TgUpdate = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id?: number; chat: { id: number } } };
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
  // ---- Account buttons: ac:<message>:<account> | n (no account) | x (cancel) ----------------
  const accBtn = /^ac:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{22}|n|x)$/.exec(update.callback_query?.data ?? "");
  if (update.callback_query && accBtn) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const messageId = cq.message?.message_id;
    const bmId = unpackId(accBtn[1]);
    let answer = "Could not save that.";
    let finalText: string | null = null;
    let undoId: string | undefined;
    if (chatId && bmId) {
      const { data: s } = await admin.from("user_settings").select("user_id").eq("telegram_chat_id", chatId).maybeSingle();
      if (s) {
        const { data: bm } = await admin
          .from("bot_messages")
          .select("id,status,parsed")
          .eq("id", bmId)
          .eq("user_id", s.user_id)
          .maybeSingle();
        const parsed = bm?.parsed as (Parsed & { by?: string }) | null;
        if (!bm || bm.status !== "parsed" || !parsed || parsed.kind !== "transaction") {
          answer = "Already handled.";
        } else if (accBtn[2] === "x") {
          await admin.from("bot_messages").update({ status: "undone" }).eq("id", bm.id);
          answer = "Cancelled.";
          finalText = "Cancelled. Nothing was saved.";
        } else {
          try {
            // Claim it first, so a double tap cannot save it twice
            const { data: claimed } = await admin
              .from("bot_messages")
              .update({ status: "received" })
              .eq("id", bm.id)
              .eq("status", "parsed")
              .select("id");
            if (!claimed?.length) {
              answer = "Already handled.";
            } else {
              const accountId = accBtn[2] === "n" ? null : unpackId(accBtn[2]);
              const saved = await savePendingTransaction(admin, s.user_id, parsed, accountId);
              await admin
                .from("bot_messages")
                .update({ status: "saved", entity_type: saved.entityType, entity_id: saved.id })
                .eq("id", bm.id);
              answer = "Saved ✓";
              finalText = `Saved ✓ ${saved.summary}`;
              undoId = bm.id;
            }
          } catch (e) {
            await admin.from("bot_messages").update({ status: "parsed" }).eq("id", bm.id).eq("status", "received");
            answer = e instanceof CaptureError ? e.message : "Could not save that. Try again.";
          }
        }
      }
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: answer.slice(0, 190) });
    if (chatId && messageId && finalText) {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: finalText,
        reply_markup: { inline_keyboard: undoId ? [[{ text: "Undo", callback_data: `undo:${undoId}` }]] : [] },
      });
    }
    return ok();
  }

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

  // ---- Task buttons: tn = next time its block happens, ta = archive ----
  const taskAct = /^t([na]):([A-Za-z0-9_-]{22})$/.exec(update.callback_query?.data ?? "");
  if (update.callback_query && taskAct) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const taskId = unpackId(taskAct[2]);
    let r = { ok: false, text: "Could not do that." };
    if (chatId && taskId) {
      const { data: s } = await admin
        .from("user_settings")
        .select("user_id,timezone")
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
      if (s) {
        const tz = s.timezone ?? "America/Guayaquil";
        r = taskAct[1] === "n" ? await rescheduleNextFromBot(admin, s.user_id, tz, taskId) : await archiveFromBot(admin, s.user_id, tz, taskId);
      }
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

  const { data: settings } = await admin.from("user_settings").select("user_id,timezone").eq("telegram_chat_id", chatId).maybeSingle();
  if (!settings) {
    await sendMessage(chatId, "This chat is not linked yet. In Personal OS open Settings → Telegram, get a code and send: /link CODE");
    return ok();
  }
  const userId = settings.user_id as string;

  // ---- "/hoy": what's pending today, the block I'm in, what's left ------------
  if (isTodayRequest(text)) {
    try {
      const r = await todayStatus(admin, userId, (settings.timezone as string | null) ?? "America/Guayaquil");
      await tg("sendMessage", { chat_id: chatId, text: r.text, ...(r.keyboard.length ? { reply_markup: { inline_keyboard: r.keyboard } } : {}) });
    } catch {
      await sendMessage(chatId, "Sorry, I could not load today. Try again in a minute.");
    }
    return ok();
  }

  // ---- /balance: money in each account (read only) ---------------------------------
  if (isBalanceRequest(text)) {
    try {
      await sendMessage(chatId, await balanceText(admin, userId));
    } catch {
      await sendMessage(chatId, "Sorry, I could not load your balances. Try again in a minute.");
    }
    return ok();
  }

  // ---- /tomorrow, /thisweek, /nextweek (read only) -------------------------
  const ahead = aheadRequest(text);
  if (ahead) {
    try {
      await sendMessage(chatId, await aheadText(admin, userId, (settings.timezone as string | null) ?? "America/Guayaquil", ahead));
    } catch {
      await sendMessage(chatId, "Sorry, I could not load that. Try again in a minute.");
    }
    return ok();
  }

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

  // ---- Habits: "habit: Stretch in Gym", "done stretch", "skip stretch" ------
  const habitCmd = parseHabitCommand(text);
  if (habitCmd) {
    const tz = (settings.timezone as string | null) ?? "America/Guayaquil";
    try {
      const r = await runHabitCommand(admin, userId, tz, habitCmd);
      let undoId: string | undefined;
      if (r.createdId) {
        // Logged like a capture, so /undo and the Undo button remove the new habit
        const { data: hm } = await admin
          .from("bot_messages")
          .insert({ user_id: userId, raw_text: text.slice(0, 4000), status: "saved", parsed: { ...habitCmd, kind: "habit_create" }, entity_type: "habit", entity_id: r.createdId })
          .select("id")
          .single();
        undoId = hm?.id;
      }
      await sendMessage(chatId, r.text, undoId);
    } catch {
      await sendMessage(chatId, "Sorry, I could not do that with your habits. Try again or use the app.");
    }
    return ok();
  }

  // ---- Capture -----------------------------------------------------------
  const { data: bm } = await admin
    .from("bot_messages")
    .insert({ user_id: userId, raw_text: text.slice(0, 4000) })
    .select("id")
    .single();
  try {
    const { saved, parsed, by } = await processCapture(admin, userId, text, "telegram_bot", null, true);
    if (bm) {
      await admin
        .from("bot_messages")
        .update({ status: "saved", parsed: { ...parsed, by }, entity_type: saved.entityType, entity_id: saved.id })
        .eq("id", bm.id);
    }
    await sendMessage(chatId, `Saved ✓ ${saved.summary}`, bm?.id);
  } catch (e) {
    if (e instanceof AccountChoiceNeeded && bm) {
      // Money message without an account: keep it pending and ask which account before saving
      await admin.from("bot_messages").update({ status: "parsed", parsed: { ...e.parsed, by: e.by } }).eq("id", bm.id);
      const key = packId(bm.id);
      const rows: { text: string; callback_data: string }[][] = [];
      for (let i = 0; i < e.accounts.length; i += 2) {
        rows.push(e.accounts.slice(i, i + 2).map((a) => ({ text: a.name.slice(0, 30), callback_data: `ac:${key}:${packId(a.id)}` })));
      }
      rows.push([
        { text: "No account", callback_data: `ac:${key}:n` },
        { text: "Cancel", callback_data: `ac:${key}:x` },
      ]);
      await tg("sendMessage", {
        chat_id: chatId,
        text: `${describe(e.parsed)}\n\nWhich account?`,
        reply_markup: { inline_keyboard: rows },
      });
      return ok();
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    if (bm) await admin.from("bot_messages").update({ status: "failed", error: message }).eq("id", bm.id);
    await sendMessage(
      chatId,
      e instanceof CaptureError ? e.message : "Sorry, I could not save that. Try rephrasing, e.g. \"spent 12 on lunch\"."
    );
  }
  return ok();
}
