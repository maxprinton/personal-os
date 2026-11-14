// Every message to the bot lands here (server only): link, voice/photo, replies, views, commands,
// actions, and finally the capture (task, note, money). Order matters: the first match wins.
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadFile, HELP, MENU_KEYBOARD, sendMessage, tg } from "@/lib/telegram";
import { aiCheck, hasAi, transcribe } from "@/lib/ai";
import { AccountChoiceNeeded, CaptureError, findAccount, processCapture, processImageCapture } from "@/lib/capture";
import { describe } from "@/lib/parse";
import { balanceText, isBalanceRequest } from "@/lib/bot-balance";
import { isNowRequest, isTodayRequest, nowStatus, todayStatus } from "@/lib/bot-today";
import { aheadRequest, aheadText, dayText } from "@/lib/bot-ahead";
import { parseHabitCommand } from "@/lib/bot-habits";
import { makeCtx, type Ctx } from "@/lib/bot/core";
import { btn, pk, recall, remember, send, type Kb } from "@/lib/bot/tg";
import { commandArg, isNoise, isOneOf, onlyDate } from "@/lib/bot/text";
import { parseBlockNoteCmd, parseEventCmd, parseFreeDayCmd, parseMetricCmd, parsePaymentCmd, parseSetBalanceCmd } from "@/lib/bot/intents";
import { archivedView, recurringView, taskListView } from "@/lib/bot/tasks";
import { createHabit, resolveDone } from "@/lib/bot/habits";
import { appendBlockNote, askFreeDay, createEvent, createPaymentTemplate, paymentsView } from "@/lib/bot/calendar";
import { accounts, askSetBalance, budgetAlert, budgetView, movementsView, setReceipt, unassignedView } from "@/lib/bot/finance";
import { habitsView, insightsView, logMetric, metricDefs, metricsView, notesView, searchView, settingsView } from "@/lib/bot/queries";
import { handleReply } from "@/lib/bot/replies";
import { askNotes, askQuestion } from "@/lib/bot/ask";
import { undoLast } from "@/lib/bot/undo";
import { categorizeView, proposalsView } from "@/lib/bot/categorize";
import { markVideo, workView } from "@/lib/bot/work";
import { parseVideoCmd } from "@/lib/work-log";
import { inboxView, isInboxRequest, isPortfolioSummary, portfolioView } from "@/lib/bot/portfolio";
import { backlogView, handleBacklogCapture, ideasView } from "@/lib/bot/backlog";
import { isBacklogView, isCaptureHelp, isIdeasView, parseBacklogCapture } from "@/lib/backlog/text";
import { handleYoutubeCapture, isYoutubeSummary, parseYoutubeCapture, youtubeView } from "@/lib/bot/youtube-capture";
import { markUsageReported, refreshFromGroq, scopeUsageLine, startOfDay, usageReport, usageSummary, withAiUsage } from "@/lib/ai-usage";
import { addDays } from "@/lib/time";
import { parseDayCommand, runDayCommand, worthItRow } from "@/lib/bot/day";
import { W } from "@/lib/bot/words";
import { applyVocab } from "@/lib/bot/vocab";
import { inSim, why } from "@/lib/bot/sim/store";
import { featureForCommand } from "@/lib/bot/sim/why";
import { vocabFeatures } from "@/lib/bot/registry";
import { loadVocab } from "@/lib/bot/vocab-server";

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


/** opts.ctx: the caller already knows who this is (the Telegram page's practice mode), so no chat lookup. */
export async function handleMessage(admin: SupabaseClient, msg: TgMessage, opts: { ctx?: Ctx; vocabApplied?: boolean } = {}) {
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
    why("Help command → the list of everything the bot understands");
    await tg("sendMessage", {
      chat_id: chatId,
      text: `${HELP}\n\nFirst time? In Personal OS open Settings → Telegram, get a code and send: /link CODE`,
      reply_markup: MENU_KEYBOARD,
    });
    return;
  }

  // ---- Linking: "/link ABC123" (or "/start ABC123") ---------------------------------------
  const link = opts.ctx ? null : /^\/(?:link|start)\s+([A-Z0-9]{6,12})$/i.exec(text);
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

  let c: Ctx;
  if (opts.ctx) c = opts.ctx;
  else {
    const { data: settings } = await admin.from("user_settings").select("user_id,timezone").eq("telegram_chat_id", chatId).maybeSingle();
    if (!settings) {
      await sendMessage(chatId, "This chat is not linked yet. In Personal OS open Settings → Telegram, get a code and send: /link CODE");
      return;
    }
    c = makeCtx(admin, settings.user_id as string, chatId, settings.timezone as string | null);
  }

  // ---- Your own command words (Telegram page → Words): added words become the real command, hidden ones say what replaced them.
  // Not for replies: "hoy" as a reply to a task is a date, not a command.
  if (text && !opts.vocabApplied && !msg.reply_to_message) {
    const r = applyVocab(text, await loadVocab(admin, c.userId), vocabFeatures());
    if ("renamed" in r) {
      why("A word you turned off → the bot says what replaced it");
      await sendMessage(chatId, `That command was renamed: use ${r.renamed.use} instead of ${r.renamed.word}. (Telegram page → Words)`);
      return;
    }
    if (r.text !== text) {
      why(`Your own word “${text.split(/\s+/)[0]}” → ${r.text}`);
      return handleMessage(admin, { ...msg, text: r.text }, { ctx: c, vocabApplied: true });
    }
  }

  // ---- Voice notes and photos: need the AI (Groq), and count toward the daily limit -----------
  if (voice || photoId) {
    if (!hasAi()) {
      await sendMessage(chatId, "Voice notes and photos need the free AI key (GROQ_API_KEY in Vercel). For now, type it.");
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

  // ---- A reply to an answer about notes: a follow-up question about the same notes ---------------
  if (msg.reply_to_message?.message_id && text) {
    const th = await recall(admin, c.userId, chatId, msg.reply_to_message.message_id);
    if (th?.kind === "ask") {
      why("Reply to an @os answer → a follow-up about the same notes");
      const p = th.payload as { ids?: string[]; q?: string; a?: string };
      await answerNotes(c, askQuestion(text) ?? text, { ids: p.ids ?? [], q: p.q ?? "", a: p.a ?? "" });
      return;
    }
  }

  // ---- A reply to one of the bot's messages (correct something, or answer its question) ---------
  if (msg.reply_to_message?.message_id && text) {
    const r = await handleReply(c, msg.reply_to_message.message_id, text);
    if (r) {
      why("Reply to a bot message → it corrects what that message saved");
      await send(chatId, r.text, r.kb);
      if (r.extra) await send(chatId, r.extra);
      return;
    }
  }

  // ---- Ask your notes: @os <question> (also /os, /ask, "os: …") --------------------------------
  const question = askQuestion(text);
  if (question !== null) {
    why("@os → ask your notes (find the notes, read them, answer)");
    await answerNotes(c, question);
    return;
  }

  // ---- Views (read only; they don't count toward the daily limit) ------------------------------
  const known = inSim() ? featureForCommand(text) : null;
  const view = await views(c, text);
  if (view) {
    if (known) why(`Command → ${known.title}`);
    return;
  }

  // ---- YouTube add-on: "yt: idea" / "/yt idea" → idea bank (before the unknown-"/" check) ----------
  const ytIdea = parseYoutubeCapture(text);
  if (ytIdea !== null) {
    why("yt: → a video idea for the YouTube idea bank");
    if (await overLimit(c)) {
      await sendMessage(chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`);
      return;
    }
    try {
      const r = await handleYoutubeCapture(c, ytIdea);
      await send(chatId, r.text, r.kb);
    } catch (e) {
      console.error("youtube capture", e);
      await sendMessage(chatId, "Sorry, I couldn't save that idea. Try again.");
    }
    return;
  }

  // ---- Backlog: "idea: …" / "bug: …" / "/idea …" / "/bug …" → the Backlog Inbox ----------------------
  const blCap = isCaptureHelp(text) ? "help" : parseBacklogCapture(text);
  if (blCap !== null) {
    why("idea: / bug: → one sentence for the Backlog Inbox");
    if (await overLimit(c)) {
      await sendMessage(chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`);
      return;
    }
    try {
      const r = await handleBacklogCapture(c, blCap);
      await send(chatId, r.text, r.kb);
    } catch (e) {
      console.error("backlog capture", e);
      await sendMessage(chatId, "Sorry, I couldn't save that. Try again.");
    }
    return;
  }

  // ---- Undo -------------------------------------------------------------------------------
  if (isOneOf(text, W.undo)) {
    why("Undo → takes back the last thing the bot saved or changed");
    const t = await undoLast(c);
    await sendMessage(chatId, t ?? "Nothing to undo.");
    return;
  }
  if (text.startsWith("/")) {
    why("Starts with “/” but is not a known command");
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
    why(reply.why ?? "A message with a clear start (habit, event, payment, free day, block note, balance, metric)");
    const id = await send(chatId, reply.text, reply.kb);
    const thread = reply.thread ?? threadOf(reply.kb);
    if (thread) await remember(admin, c.userId, chatId, id, "saved", { bm: thread });
    return;
  }

  // ---- "ok", "gracias", "hola", 👍 … are not tasks --------------------------------------------
  if (isNoise(text)) {
    why("Small talk (ok, gracias, hola…) is never saved");
    await sendMessage(chatId, "👋 (not saved) — /help shows what I understand, or tap the buttons below the keyboard.");
    return;
  }

  // ---- Capture: task, note, expense, income, transfer ---------------------------------------------
  why("Free text → the rules decide: expense, income, transfer, note or task (the AI only helps when the rules cannot)");
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
    if (isOneOf(text, W.hidemenu)) {
      await tg("sendMessage", { chat_id: chatId, text: "🙈 Buttons hidden. Send /menu to bring them back.", reply_markup: { remove_keyboard: true } });
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
    if (isOneOf(text, W.recurring)) return await hit(recurringView(c));
    if (isOneOf(text, W.payments)) return await hit(paymentsView(c));
    if (isOneOf(text, W.unassigned)) return await hit(unassignedView(c, 0));
    if (isOneOf(text, W.categorize)) {
      await send(chatId, "✨ Reading your uncategorized transactions…");
      return await hit(categorizeView(c));
    }
    if (isOneOf(text, W.proposals)) return await hit(proposalsView(c));
    if (isOneOf(text, W.budget)) return await hit(budgetView(c));
    if (isOneOf(text, W.movements)) return await hit(movementsView(c));
    if (isOneOf(text, W.notes)) return await hit(notesView(c));
    if (isOneOf(text, W.habits)) return await hit(habitsView(c));
    if (isOneOf(text, W.work)) return await hit(workView(c));
    if (isYoutubeSummary(text)) return await hit(youtubeView(c));
    if (isBacklogView(text)) return await hit(backlogView(c));
    if (isIdeasView(text)) return await hit(ideasView(c));
    if (isPortfolioSummary(text)) return await hit(portfolioView(c));
    if (isInboxRequest(text)) return await hit(inboxView(c));
    if (isOneOf(text, W.insights)) return await hit(insightsView(c));
    const dayCmd = parseDayCommand(text);
    if (dayCmd) return await hit(runDayCommand(c, dayCmd, text));
    if (isOneOf(text, W.metrics)) return await hit(metricsView(c));
    if (isOneOf(text, W.settings)) return await hit(settingsView(c));
    if (isOneOf(text, W.ai)) {
      await send(chatId, await aiCheck());
      return true;
    }
    if (isOneOf(text, W.usage)) {
      await refreshFromGroq(c.admin, c.userId, c.tz);
      markUsageReported();
      const sum = await usageSummary(c.admin, { from: startOfDay(addDays(c.today, -1), c.tz), tz: c.tz, userId: c.userId });
      await send(chatId, usageReport(sum, c.today) ?? "✨ Nothing used yet today.");
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

type ActionReply = { text: string; kb: Kb; thread?: string | null; why?: string };

/** Messages with a clear start: habits, events, payments, free days, block notes, balances, metrics. */
async function actions(c: Ctx, text: string): Promise<ActionReply | null> {
  // Work log: "video B2-5 https://drive.google.com/…" marks that class's video as posted
  const vid = parseVideoCmd(text);
  if (vid) return { ...(await markVideo(c, vid.group, vid.url)), why: "video <class> <link> → marks that class video as posted" };

  // Habits: "habit: Stretch in Gym" · "done stretch" / "skip stretch" (and "done <task>")
  const habitCmd = parseHabitCommand(text);
  if (habitCmd?.kind === "create") {
    const body = text.replace(/^h[aá]bit[o]?\s*:\s*/i, "").trim();
    return { ...(await createHabit(c, text, habitCmd.name, habitCmd.block, body)), why: "habit: → creates a habit inside a block" };
  }
  if (habitCmd?.kind === "mark") return { ...(await resolveDone(c, habitCmd.state, habitCmd.query, text)), why: "done / skip + name → marks the habit, or completes the task with that name" };

  const ev = parseEventCmd(text, c.today);
  if (ev) {
    if ("error" in ev) return { text: ev.error, kb: [] };
    const r = await createEvent(c, text, ev);
    return { ...r, thread: threadOf(r.kb), why: "event: / evento: → a calendar event" };
  }
  const pay = parsePaymentCmd(text, c.today);
  if (pay) {
    if ("error" in pay) return { text: pay.error, kb: [] };
    const r = await createPaymentTemplate(c, text, pay);
    return { ...r, thread: threadOf(r.kb), why: "pago: / payment: → a scheduled payment with its future dates" };
  }
  const free = parseFreeDayCmd(text, c.today);
  if (free) return { ...(await askFreeDay(c, text, free)), why: "libre / free day → a day off (asks what to do with its tasks)" };
  const nb = parseBlockNoteCmd(text);
  if (nb) return { ...(await appendBlockNote(c, text, nb.block, nb.body)), why: "nb: → adds to the note of a block" };
  const bal = parseSetBalanceCmd(text);
  if (bal) {
    const list = await accounts(c);
    const acc = findAccount(bal.account, list)?.account;
    if (acc) return { ...(await askSetBalance(c, text, acc, bal.amount)), why: "saldo / balance + account + amount → sets the real balance" };
    if (list.length) return { text: `I don't have an account called “${bal.account}”. Your accounts: ${list.map((a) => a.name).join(", ")}.`, kb: [] };
  }
  // "sleep 7.5": only when the start looks like a word and a number (saves a query on every message)
  if (/^[\p{L}][\p{L} ]{1,30}:?\s*\+?-?\d/u.test(text)) {
    const defs = await metricDefs(c);
    const m = defs.length ? parseMetricCmd(text, defs.map((d) => d.name)) : null;
    if (m) return { ...(await logMetric(c, text, m)), why: "metric name + number → today's value of that metric" };
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
    const wi = saved.entityType === "transaction" ? await worthItRow(c, saved.id, pk(saved.id)).catch(() => null) : null;
    const savedKb: Kb = [...(bmId ? [[btn("Undo", `undo:${bmId}`)]] : []), ...(wi ? [wi] : [])];
    const id = await send(
      chatId,
      `Saved ✓ ${saved.summary}${by === "ai" ? " · ✨" : ""}${receipt && saved.entityType === "transaction" ? " · 🧾" : ""}`,
      savedKb.length ? savedKb : null
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

/** Finds the notes, reads them and answers; the answer remembers its notes for follow-ups. */
async function answerNotes(c: Ctx, question: string, follow?: { ids: string[]; q: string; a: string }) {
  // Not a reply: the last questions of this chat (45 min) are the conversation's context
  let history: { ids: string[]; q: string; a: string }[] = [];
  if (!follow) {
    const { data } = await c.admin
      .from("bot_threads")
      .select("payload,created_at")
      .eq("user_id", c.userId)
      .eq("chat_id", c.chatId)
      .eq("kind", "ask")
      .gte("created_at", new Date(Date.now() - 45 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(3);
    history = ((data ?? []) as { payload: { ids?: string[]; q?: string; a?: string } }[])
      .map((r) => ({ ids: r.payload.ids ?? [], q: r.payload.q ?? "", a: r.payload.a ?? "" }))
      .reverse();
  }
  if (question && (await overLimit(c))) {
    await sendMessage(c.chatId, `Daily limit of ${DAILY_LIMIT} messages reached. Try again tomorrow.`);
    return;
  }
  await c.admin.from("bot_messages").insert({ user_id: c.userId, raw_text: `[ask] ${question}`.slice(0, 4000) });
  await tg("sendChatAction", { chat_id: c.chatId, action: "typing" }).catch(() => null);
  try {
    const r = await withAiUsage("bot-ask", () => askNotes(c, question, follow, history));
    // what this answer cost and what's left today (always, the user's choice)
    const line = await scopeUsageLine(c.admin, c.userId, c.tz, c.today).catch(() => null);
    markUsageReported();
    const id = await send(c.chatId, line ? `${r.text}\n${line}` : r.text, r.kb);
    if (question.trim()) await remember(c.admin, c.userId, c.chatId, id, "ask", { ids: r.noteIds, q: question.slice(0, 500), a: r.text.slice(0, 1200) });
  } catch (e) {
    console.error("telegram ask", e);
    await sendMessage(c.chatId, "✨ Sorry, I couldn't read your notes this time. Try again in a minute.");
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

