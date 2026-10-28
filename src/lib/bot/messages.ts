// Every message to the bot lands here (server only): link, voice/photo, replies, views, commands,
// actions, and finally the capture (task, note, money). Order matters: the first match wins.
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadFile, HELP, MENU_KEYBOARD, sendMessage, tg } from "@/lib/telegram";
import { geminiCheck, hasGemini, transcribe } from "@/lib/gemini";
import { AccountChoiceNeeded, CaptureError, findAccount, processCapture, processImageCapture } from "@/lib/capture";
import { describe } from "@/lib/parse";
import { balanceText, isBalanceRequest } from "@/lib/bot-balance";
import { isNowRequest, isTodayRequest, nowStatus, todayStatus } from "@/lib/bot-today";
import { aheadRequest, aheadText, dayText } from "@/lib/bot-ahead";
import { gemAnswer, gemQuestion } from "@/lib/bot-gem";
import { parseHabitCommand } from "@/lib/bot-habits";
import { makeCtx, type Ctx } from "@/lib/bot/core";
import { btn, pk, remember, send, type Kb } from "@/lib/bot/tg";
import { commandArg, isNoise, isOneOf, onlyDate } from "@/lib/bot/text";
import { parseBlockNoteCmd, parseEventCmd, parseFreeDayCmd, parseMetricCmd, parsePaymentCmd, parseSetBalanceCmd } from "@/lib/bot/intents";
import { archivedView, taskListView } from "@/lib/bot/tasks";
import { createHabit, resolveDone } from "@/lib/bot/habits";
import { appendBlockNote, askFreeDay, createEvent, createPaymentTemplate, paymentsView } from "@/lib/bot/calendar";
import { accounts, askSetBalance, budgetAlert, budgetView, movementsView, setReceipt, unassignedView } from "@/lib/bot/finance";
import { habitsView, insightsView, logMetric, metricDefs, metricsView, notesView, searchView, settingsView } from "@/lib/bot/queries";
import { handleReply } from "@/lib/bot/replies";
import { undoLast } from "@/lib/bot/undo";

export const DAILY_LIMIT = 100;

export type TgMessage = {
  message_id?: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string };
  photo?: { file_id: string; file_size?: number; width?: number }[];
  document?: { file_id: string; mime_type?: string; file_size?: number };
  reply_to_message?: { message_id: number; from?: { is_bot?: boolean } };
};

// Whole-message commands (after norm: no accents, lower case, no emoji, no "?")
const W = {
  help: ["/help", "/start", "help", "ayuda", "/ayuda"],
  menu: ["/menu", "menu", "/teclado"],
  tasks: ["/tareas", "tareas", "/tasks", "tasks", "/todo", "mis tareas", "todas las tareas", "all tasks"],
  archived: ["/archivadas", "archivadas", "/archived", "archived", "/archivo"],
  payments: ["/pagos", "pagos", "/payments", "payments", "/bills", "bills", "que tengo que pagar", "por pagar"],
  unassigned: ["/sincuenta", "sincuenta", "sin cuenta", "/unassigned", "unassigned", "/no_account"],
  budget: ["/presupuesto", "/presupuestos", "presupuesto", "presupuestos", "/budget", "/budgets", "budget", "budgets"],
  movements: ["/movimientos", "movimientos", "/movements", "movements", "/txns", "/transactions", "transactions", "ultimos movimientos", "/recent"],
  notes: ["/notas", "notas", "/notes", "notes", "mis notas"],
  habits: ["/habitos", "habitos", "/habits", "habits", "rachas", "/streaks", "streaks"],
  insights: ["/insights", "insights", "/consejos"],
  metrics: ["/metricas", "metricas", "/metrics", "metrics"],
  settings: ["/ajustes", "ajustes", "/settings", "settings", "/config", "config", "configuracion"],
  ai: ["/ai"],
  undo: ["/undo", "/deshacer", "deshacer", "undo"],
};

export async function handleMessage(admin: SupabaseClient, msg: TgMessage) {
  const chatId = msg.chat.id;
  let text = msg.text?.trim() ?? "";
  const voice = msg.voice ?? msg.audio ?? null;
  const photoId = msg.photo?.length
    ? msg.photo[msg.photo.length - 1].file_id
    : msg.document?.mime_type?.startsWith("image/")
      ? msg.document.file_id
      : null;
  if (!text && !voice && !photoId) return;

  // ---- Help and the keyboard of buttons --------------------------------------------------
  if ((isOneOf(text, W.help) || /^\/start(@\w+)?$/i.test(text)) && !/^\/start\s+\S/.test(text)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `${HELP}\n\nFirst time? In Personal OS open Settings → Telegram, get a code and send: /link CODE`,
      reply_markup: MENU_KEYBOARD,
    });
    return;
  }

  // ---- Linking: "/link ABC123" (or "/start ABC123") ---------------------------------------
  const link = /^\/(?:link|start)\s+([A-Z0-9]{6,12})$/i.exec(text);
  if (link) {
    const code = link[1].toUpperCase();
    const { data: s } = await admin.from("user_settings").select("user_id,telegram_link_expires").eq("telegram_link_code", code).maybeSingle();
    if (!s || !s.telegram_link_expires || new Date(s.telegram_link_expires) < new Date()) {
      await sendMessage(chatId, "That code is invalid or expired. Generate a new one in Settings → Telegram.");
      return;
    }
    await admin.from("user_settings").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
    await admin.from("user_settings").update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_expires: null }).eq("user_id", s.user_id);
    await tg("sendMessage", { chat_id: chatId, text: `Linked! ${HELP}`, reply_markup: MENU_KEYBOARD });
    return;
  }

  const { data: settings } = await admin.from("user_settings").select("user_id,timezone").eq("telegram_chat_id", chatId).maybeSingle();
  if (!settings) {
    await sendMessage(chatId, "This chat is not linked yet. In Personal OS open Settings → Telegram, get a code and send: /link CODE");
    return;
  }
  const c = makeCtx(admin, settings.user_id as string, chatId, settings.timezone as string | null);

  // ---- Voice notes and photos: need Gemini, and count toward the daily limit ------------------
  if (voice || photoId) {
    if (!hasGemini()) {
      await sendMessage(chatId, "Voice notes and photos need the free Gemini key (GEMINI_API_KEY in Vercel). For now, type it.");
      return;
    }
    if (await overLimit(c)) {
      await sendMessage(chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`);
      return;
    }
  }
  if (voice) {
    if ((voice.duration ?? 0) > 180) {
      await sendMessage(chatId, "That voice note is too long. Keep it under 3 minutes.");
      return;
    }
    const file = await downloadFile(voice.file_id);
    const heard = file ? await transcribe(file.base64, voice.mime_type || "audio/ogg") : null;
    if (!heard) {
      await sendMessage(chatId, "Sorry, I could not understand that voice note. Try again or type it.");
      return;
    }
    await sendMessage(chatId, `🎙 “${heard.slice(0, 500)}”`);
    text = heard.trim(); // from here on it's handled exactly like a typed message
  }
  if (photoId) {
    const caption = msg.caption?.trim() ?? "";
    const { data: pm } = await admin.from("bot_messages").insert({ user_id: c.userId, raw_text: `[photo] ${caption}`.slice(0, 4000) }).select("id").single();
    const file = await downloadFile(photoId);
    if (!file) {
      if (pm) await admin.from("bot_messages").update({ status: "failed", error: "photo download" }).eq("id", pm.id);
      await sendMessage(chatId, "Sorry, I could not get that photo (too big?). Try again.");
      return;
    }
    const mime = msg.document?.mime_type?.startsWith("image/") && !msg.photo?.length ? msg.document.mime_type : "image/jpeg";
    await replyCapture(c, pm?.id as string | undefined, () => processImageCapture(admin, c.userId, { base64: file.base64, mimeType: mime }, caption, "telegram_bot", true), photoId);
    return;
  }

  // ---- A reply to one of the bot's messages (correct something, or answer its question) ---------
  if (msg.reply_to_message?.message_id && text) {
    const r = await handleReply(c, msg.reply_to_message.message_id, text);
    if (r) {
      await send(chatId, r.text, r.kb);
      if (r.extra) await send(chatId, r.extra);
      return;
    }
  }

  // ---- @gem / /gem / gem: — ask Gemini about your own data (read only) ----------------------
  const question = gemQuestion(text);
  if (question !== null) {
    if (!hasGemini()) return void (await sendMessage(chatId, "✨ @gem needs the free Gemini key (GEMINI_API_KEY in Vercel). Check with /ai."));
    if (await overLimit(c)) return void (await sendMessage(chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`));
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => null);
    try {
      for (const part of await gemAnswer(admin, c.userId, c.tz, question)) await sendMessage(chatId, part);
    } catch {
      await sendMessage(chatId, "✨ Sorry, I could not read your data this time. Try again in a minute.");
    }
    return;
  }

  // ---- Views (read only; they don't count toward the daily limit) ------------------------------
  const view = await views(c, text);
  if (view) return;

  // ---- Undo -------------------------------------------------------------------------------
  if (isOneOf(text, W.undo)) {
    const t = await undoLast(c);
    await sendMessage(chatId, t ?? "Nothing to undo.");
    return;
  }
  if (text.startsWith("/")) {
    const cmd = text.split(/\s+/)[0];
    await sendMessage(chatId, `I don't know ${cmd}. Try /today, /tasks, /payments, /search word… or /help for everything.`);
    return;
  }

  if (await overLimit(c)) {
    await sendMessage(chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`);
    return;
  }

  // ---- Actions with a clear start ------------------------------------------------------------
  const reply = await actions(c, text);
  if (reply) {
    const id = await send(chatId, reply.text, reply.kb);
    const thread = reply.thread ?? threadOf(reply.kb);
    if (thread) await remember(admin, c.userId, chatId, id, "saved", { bm: thread });
    return;
  }

  // ---- "ok", "gracias", "hola", 👍 … are not tasks --------------------------------------------
  if (isNoise(text)) {
    await sendMessage(chatId, "👋 (not saved) — /help shows what I understand, or tap the buttons below the keyboard.");
    return;
  }

  // ---- Capture: task, note, expense, income, transfer ---------------------------------------------
  const { data: bm } = await admin.from("bot_messages").insert({ user_id: c.userId, raw_text: text.slice(0, 4000) }).select("id").single();
  await replyCapture(c, bm?.id as string | undefined, () => processCapture(admin, c.userId, text, "telegram_bot", null, true));
}

/** Read-only answers. true = handled. */
async function views(c: Ctx, text: string): Promise<boolean> {
  const chatId = c.chatId;
  const show = async (v: { text: string; kb: Kb }) => void (await send(chatId, v.text, v.kb));
  const hit = async (p: Promise<{ text: string; kb: Kb }>) => {
    await show(await p);
    return true;
  };
  try {
    if (isOneOf(text, W.menu)) {
      await tg("sendMessage", { chat_id: chatId, text: "⌨️ The buttons are below the keyboard. Tap ⌨ in the chat bar if you don't see them.", reply_markup: MENU_KEYBOARD });
      return true;
    }
    if (isNowRequest(text)) {
      const r = await nowStatus(c.admin, c.userId, c.tz);
      for (let i = 0; i < r.text.length; i++) await send(chatId, r.text[i], i === r.text.length - 1 ? r.keyboard : null);
      return true;
    }
    if (isTodayRequest(text)) {
      const r = await todayStatus(c.admin, c.userId, c.tz);
      await send(chatId, r.text, r.keyboard);
      for (const extra of r.extra) await send(chatId, extra);
      return true;
    }
    if (isBalanceRequest(text)) {
      await send(chatId, await balanceText(c.admin, c.userId));
      return true;
    }
    const ahead = aheadRequest(text);
    if (ahead) {
      await show(await aheadText(c.admin, c.userId, c.tz, ahead));
      return true;
    }
    // "/day friday", "qué tengo el jueves", "what do I have on the 5th"
    const dayArg = commandArg(text, ["/dia", "/day", "dia", "day", "que tengo", "what do i have", "what do i have on", "agenda"]);
    if (dayArg !== null && dayArg) {
      const date = onlyDate(dayArg, c.today, "future");
      if (date) {
        if (date === c.today) {
          const r = await todayStatus(c.admin, c.userId, c.tz);
          await send(chatId, r.text, r.keyboard);
        } else {
          await show(await dayText(c.admin, c.userId, c.tz, c.today, date));
        }
        return true;
      }
    }
    if (isOneOf(text, W.tasks)) return await hit(taskListView(c, 0));
    if (isOneOf(text, W.archived)) return await hit(archivedView(c));
    if (isOneOf(text, W.payments)) return await hit(paymentsView(c));
    if (isOneOf(text, W.unassigned)) return await hit(unassignedView(c, 0));
    if (isOneOf(text, W.budget)) return await hit(budgetView(c));
    if (isOneOf(text, W.movements)) return await hit(movementsView(c));
    if (isOneOf(text, W.notes)) return await hit(notesView(c));
    if (isOneOf(text, W.habits)) return await hit(habitsView(c));
    if (isOneOf(text, W.insights)) return await hit(insightsView(c));
    if (isOneOf(text, W.metrics)) return await hit(metricsView(c));
    if (isOneOf(text, W.settings)) return await hit(settingsView(c));
    if (isOneOf(text, W.ai)) {
      await send(chatId, await geminiCheck());
      return true;
    }
    const q = commandArg(text, ["/buscar", "/search", "/find", "buscar", "busca", "search", "find"]);
    if (q !== null) return await hit(searchView(c, q));
  } catch (e) {
    console.error("telegram view", text, e);
    await send(chatId, "Sorry, I could not load that. Try again in a minute.");
    return true;
  }
  return false;
}

type ActionReply = { text: string; kb: Kb; thread?: string | null };

/** Messages with a clear start: habits, events, payments, free days, block notes, balances, metrics. */
async function actions(c: Ctx, text: string): Promise<ActionReply | null> {
  // Habits: "habit: Stretch in Gym" · "done stretch" / "skip stretch" (and "done <task>")
  const habitCmd = parseHabitCommand(text);
  if (habitCmd?.kind === "create") {
    const body = text.replace(/^h[aá]bit[o]?\s*:\s*/i, "").trim();
    return createHabit(c, text, habitCmd.name, habitCmd.block, body);
  }
  if (habitCmd?.kind === "mark") return resolveDone(c, habitCmd.state, habitCmd.query, text);

  const ev = parseEventCmd(text, c.today);
  if (ev) {
    if ("error" in ev) return { text: ev.error, kb: [] };
    const r = await createEvent(c, text, ev);
    return { ...r, thread: threadOf(r.kb) };
  }
  const pay = parsePaymentCmd(text, c.today);
  if (pay) {
    if ("error" in pay) return { text: pay.error, kb: [] };
    const r = await createPaymentTemplate(c, text, pay);
    return { ...r, thread: threadOf(r.kb) };
  }
  const free = parseFreeDayCmd(text, c.today);
  if (free) return askFreeDay(c, text, free);
  const nb = parseBlockNoteCmd(text);
  if (nb) return appendBlockNote(c, text, nb.block, nb.body);
  const bal = parseSetBalanceCmd(text);
  if (bal) {
    const list = await accounts(c);
    const acc = findAccount(bal.account, list)?.account;
    if (acc) return askSetBalance(c, text, acc, bal.amount);
    if (list.length) return { text: `I don't have an account called “${bal.account}”. Your accounts: ${list.map((a) => a.name).join(", ")}.`, kb: [] };
  }
  // "sleep 7.5": only when the start looks like a word and a number (saves a query on every message)
  if (/^[\p{L}][\p{L} ]{1,30}:?\s*\+?-?\d/u.test(text)) {
    const defs = await metricDefs(c);
    const m = defs.length ? parseMetricCmd(text, defs.map((d) => d.name)) : null;
    if (m) return logMetric(c, text, m);
  }
  return null;
}

/** The log id behind an Undo button (so a reply to that message can correct it). */
function threadOf(kb: Kb): string | null {
  const data = kb[0]?.[0]?.callback_data ?? "";
  return data.startsWith("undo:") ? data.slice(5) : null;
}

/** Saves a capture and answers (Saved ✓ + Undo, the account question, or why it failed). */
async function replyCapture(c: Ctx, bmId: string | undefined, run: () => ReturnType<typeof processCapture>, receipt?: string) {
  const { admin, chatId } = c;
  try {
    const { saved, parsed, by } = await run();
    if (bmId) {
      await admin.from("bot_messages").update({ status: "saved", parsed: { ...parsed, by }, entity_type: saved.entityType, entity_id: saved.id }).eq("id", bmId);
    }
    if (receipt && saved.entityType === "transaction") await setReceipt(c, saved.id, receipt).catch(() => null);
    const id = await send(
      chatId,
      `Saved ✓ ${saved.summary}${by === "ai" ? " · ✨" : ""}${receipt && saved.entityType === "transaction" ? " · 🧾" : ""}`,
      bmId ? [[btn("Undo", `undo:${bmId}`)]] : null
    );
    if (bmId) await remember(admin, c.userId, chatId, id, "saved", { bm: bmId });
    if (saved.entityType === "transaction") {
      const alert = await budgetAlert(c, saved.id).catch(() => null);
      if (alert) await send(chatId, alert);
    }
  } catch (e) {
    if (e instanceof AccountChoiceNeeded && bmId) {
      // Money message without an account: keep it pending and ask which account before saving
      await admin.from("bot_messages").update({ status: "parsed", parsed: { ...e.parsed, by: e.by, ...(receipt ? { receipt } : {}) } }).eq("id", bmId);
      const key = pk(bmId);
      const rows: Kb = [];
      for (let i = 0; i < e.accounts.length; i += 2) {
        rows.push(e.accounts.slice(i, i + 2).map((a) => btn(a.name.slice(0, 30), `ac:${key}:${pk(a.id)}`)));
      }
      rows.push([btn("No account", `ac:${key}:n`), btn("Cancel", `ac:${key}:x`)]);
      await send(chatId, `${describe(e.parsed)}${e.by === "ai" ? " · ✨" : ""}\n\nWhich account? (if you don't tap one, in 10 minutes it is saved without an account)`, rows);
      return;
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    if (bmId) await admin.from("bot_messages").update({ status: "failed", error: message }).eq("id", bmId);
    await sendMessage(chatId, e instanceof CaptureError ? e.message : "Sorry, I could not save that. Try rephrasing, e.g. “spent 12 on lunch”.");
  }
}

/** More than DAILY_LIMIT messages in the last 24 hours (button taps don't count). */
async function overLimit(c: Ctx) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await c.admin
    .from("bot_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", c.userId)
    .gte("received_at", since)
    .not("raw_text", "like", "button:%");
  return (count ?? 0) >= DAILY_LIMIT;
}

