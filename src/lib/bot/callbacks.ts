// Every button tap lands here (server only). Most actions change only the row that was tapped
// (✓ → "↩ Undo ✓"), so a list stays in one message instead of filling the chat.
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePendingTransaction, CaptureError } from "@/lib/capture";
import { getTask } from "@/lib/calendar/tasks";
import type { FreeDayPolicy } from "@/lib/calendar/types";
import type { Parsed } from "@/lib/parse";
import { makeCtx, type Ctx } from "@/lib/bot/core";
import { ask, btn, edit, editKb, keyboardOf, logAction, remember, replaceRows, send, sendPhoto, toast, undoRow, upk, type Kb } from "@/lib/bot/tg";
import { unpackDate } from "@/lib/bot/text";
import {
  archiveTask, archivedRow, blockRows, completeTask, dateRows, doneRow, menuRows, moveToDate, moveToNextBlock, movedRow,
  placeInBlock, reopenTask, taskListView, taskRow, unarchiveTask, undoMove,
} from "@/lib/bot/tasks";
import { habitRow, habitTitle, markHabit, markedRow, saveHabit, unmarkHabit } from "@/lib/bot/habits";
import { blockDoneRow, confirmPay, payMenu, saveFreeDay, skipPay, toggleBlockDone } from "@/lib/bot/calendar";
import {
  accountRows, accounts, budgetAlert, deleteTxn, getTxn, receiptOf, restoreTxn, saveBalance, setReceipt, setTxnAccount, txnLabel, txnRow, unassignedView,
} from "@/lib/bot/finance";
import { cycleBefore, generateInsights, insightsView, noteView, setTime, settingsView, timeRows, toggleSetting } from "@/lib/bot/queries";
import { undoById } from "@/lib/bot/undo";
import { dayText } from "@/lib/bot-ahead";

export type CallbackQuery = { id: string; data?: string; message?: { message_id?: number; chat: { id: number }; reply_markup?: unknown } };

export async function handleCallback(admin: SupabaseClient, cq: CallbackQuery) {
  const chatId = cq.message?.chat.id;
  if (!chatId) return toast(cq.id, "This button has expired.");
  const { data: s } = await admin.from("user_settings").select("user_id,timezone").eq("telegram_chat_id", chatId).maybeSingle();
  if (!s) return toast(cq.id, "This chat is not linked. Send /link CODE first.");
  const c = makeCtx(admin, s.user_id as string, chatId, s.timezone as string | null);
  try {
    await route(c, cq, chatId, cq.message?.message_id ?? null);
  } catch (e) {
    console.error("telegram callback", cq.data, e);
    await toast(cq.id, "Something went wrong. Try again.", true);
  }
}

async function route(c: Ctx, cq: CallbackQuery, chatId: number, msgId: number | null) {
  const data = cq.data ?? "";
  const [verb, a = "", b = "", d = ""] = data.split(":");
  const kb = keyboardOf(cq.message);

  /** Swaps the rows of one item in the tapped message; without them, sends `text` with the rows. */
  const swap = async (key: string, rows: Kb, text?: string) => {
    const next = replaceRows(kb, key, rows);
    if (next && msgId) await editKb(chatId, msgId, next);
    else if (text) await send(chatId, text, rows);
  };
  const id = (packed: string) => upk(packed) ?? "";
  const task = async (packed: string) => {
    const t = await getTask(c.admin, c.userId, id(packed));
    return t ? { id: t.id, title: t.title, status: t.status } : null;
  };
  const say = (text: string, alert = false) => toast(cq.id, text, alert);

  switch (verb) {
    // ---- Undo of anything logged --------------------------------------------------------
    case "undo": {
      const text = await undoById(c, data.slice(5));
      await say(text ? "Undone." : "Nothing to undo.");
      if (text) {
        await swap(`undo:${data.slice(5)}`, [], text);
        if (replaceRows(kb, `undo:${data.slice(5)}`, [])) await send(chatId, text);
      }
      return;
    }

    // ---- Account of a money message waiting for it -------------------------------------------
    case "ac":
      return pickAccount(c, cq, chatId, msgId, id(a), b);

    // ---- Habits -------------------------------------------------------------------------
    case "hk": {
      const habitId = id(b);
      const occId = id(d);
      const state = a === "d" ? "done" : "skipped";
      const r = await markHabit(c, habitId, occId, state);
      if (!r.ok) return say(r.text, true);
      await logAction(c.admin, c.userId, "(habit button)", "habit_check", habitId, { habitId, occurrenceId: occId });
      await say(r.text);
      const title = await habitTitle(c, habitId, occId);
      return swap(`${b}:${d}`, markedRow(habitId, occId, title, state), r.text);
    }
    case "hu": {
      const r = await unmarkHabit(c, id(a), id(b));
      await say(r.text);
      const title = await habitTitle(c, id(a), id(b));
      return swap(`${a}:${b}`, [habitRow({ habitId: id(a), occurrenceId: id(b), title })]);
    }
    case "hp":
      return pendingHabit(c, cq, chatId, msgId, id(a), b);
    case "hd":
    case "hs":
      return say("This button is from an older version. Use /today or tonight's check-in.", true);

    // ---- Tasks ---------------------------------------------------------------------------
    case "tk":
    case "td": {
      const r = await completeTask(c, id(a));
      if (!r.ok) return say(r.text, true);
      await logAction(c.admin, c.userId, "(✓ task)", "task_done", id(a));
      await say(r.text);
      return swap(a, doneRow({ id: id(a), title: r.title ?? "task" }), r.text);
    }
    case "tu": {
      const r = await reopenTask(c, id(a));
      await say(r.text);
      return swap(a, [taskRow({ id: id(a), title: r.title ?? "task" })]);
    }
    case "tm": {
      const t = await task(a);
      if (!t) return say("That task no longer exists.", true);
      await say(t.title);
      return swap(a, menuRows(t), "⋯");
    }
    case "tc": {
      const t = await task(a);
      await say("OK");
      if (!t) return swap(a, []);
      return swap(a, t.status === "pending" || t.status === "backlog" ? [taskRow(t)] : t.status === "completed" ? doneRow(t) : []);
    }
    case "tD": {
      const t = await task(a);
      if (!t) return say("That task no longer exists.", true);
      await say("Pick a day");
      return swap(a, dateRows(t, c.today), `📅 ${t.title}`);
    }
    case "tq": {
      const date = unpackDate(b);
      if (!date) return say("Bad date.", true);
      const r = await moveToDate(c, id(a), date);
      if (!r.ok) return say(r.text, true);
      await logAction(c.admin, c.userId, "(📅 task)", "task_move", id(a), { prevDate: r.prevDate ?? null, prevOcc: r.prevOcc ?? null });
      await say(r.text);
      return swap(a, movedRow({ id: id(a), title: r.title ?? "task" }, r.label ?? date, r.prevDate ?? null, r.prevOcc ?? null), r.text);
    }
    case "tO": {
      const t = await task(a);
      if (!t) return say("That task no longer exists.", true);
      await say("Write the date");
      await swap(a, [taskRow(t)]);
      const q = await ask(chatId, `📅 New date for “${t.title}”?\nReply with: friday · 5 nov · 12/11 · in 10 days · 2026-11-05`, "friday, 5 nov…");
      if (!(await remember(c.admin, c.userId, chatId, q, "task_date", { taskId: t.id }))) await needsMigration(chatId);
      return;
    }
    case "tB": {
      const t = await task(a);
      if (!t) return say("That task no longer exists.", true);
      await say(b === "1" ? "Tomorrow's blocks" : "Today's blocks");
      return swap(a, await blockRows(c, t, b === "1" ? 1 : 0), `🧱 ${t.title}`);
    }
    case "tp": {
      const r = await placeInBlock(c, id(a), id(b));
      if (!r.ok) return say(r.text, true);
      await logAction(c.admin, c.userId, "(🧱 task)", "task_move", id(a), { prevDate: r.prevDate ?? null, prevOcc: r.prevOcc ?? null });
      await say(r.text);
      return swap(a, movedRow({ id: id(a), title: r.title ?? "task" }, r.label ?? "block", r.prevDate ?? null, r.prevOcc ?? null), r.text);
    }
    case "tn": {
      const r = await moveToNextBlock(c, id(a));
      if (!r.ok) {
        // No block to go to: offer the dates instead of a dead end
        await say(r.text, true);
        const t = await task(a);
        return t ? swap(a, dateRows(t, c.today)) : undefined;
      }
      await logAction(c.admin, c.userId, "(⏭ task)", "task_move", id(a), { prevDate: r.prevDate ?? null, prevOcc: r.prevOcc ?? null });
      await say(r.text);
      return swap(a, movedRow({ id: id(a), title: r.title ?? "task" }, r.label ?? "next", r.prevDate ?? null, r.prevOcc ?? null), r.text);
    }
    case "tv": {
      const r = await undoMove(c, id(a), b === "-" ? null : unpackDate(b), d === "-" ? null : id(d));
      await say(r.text);
      return swap(a, r.ok ? [taskRow({ id: id(a), title: r.title ?? "task" })] : []);
    }
    case "te": {
      const t = await task(a);
      if (!t) return say("That task no longer exists.", true);
      await say("Write the new name");
      await swap(a, [taskRow(t)]);
      const q = await ask(chatId, `✏️ New name for “${t.title}”? (reply to this message)`, t.title);
      if (!(await remember(c.admin, c.userId, chatId, q, "task_rename", { taskId: t.id }))) await needsMigration(chatId);
      return;
    }
    case "ta": {
      const r = await archiveTask(c, id(a));
      if (!r.ok) return say(r.text, true);
      await logAction(c.admin, c.userId, "(🗄 task)", "task_archive", id(a), { prevDate: r.prevDate ?? null, prevOcc: r.prevOcc ?? null });
      await say(r.text);
      return swap(a, archivedRow({ id: id(a), title: r.title ?? "task" }, r.prevDate ?? null, r.prevOcc ?? null), r.text);
    }
    case "tR": {
      const r = await unarchiveTask(c, id(a), b === "-" ? null : unpackDate(b), d === "-" ? null : id(d));
      await say(r.text);
      return swap(a, r.ok ? [taskRow({ id: id(a), title: r.title ?? "task" })] : []);
    }
    case "tr": {
      const r = await unarchiveTask(c, id(a));
      await say(r.text);
      return swap(a, r.ok ? [taskRow({ id: id(a), title: r.title ?? "task" })] : []);
    }
    case "pl": {
      const v = await taskListView(c, Number(a) || 0);
      await say(`Page ${(Number(a) || 0) + 1}`);
      if (msgId) return edit(chatId, msgId, v.text, v.kb);
      return void (await send(chatId, v.text, v.kb));
    }
    case "dv": {
      const date = unpackDate(a);
      if (!date) return say("Bad date.", true);
      await say("…");
      const v = await dayText(c.admin, c.userId, c.tz, c.today, date);
      return void (await send(chatId, v.text, v.kb));
    }

    // ---- Blocks -----------------------------------------------------------------------------
    case "bd": {
      const r = await toggleBlockDone(c, id(a));
      if (!r.ok) return say(r.text, true);
      await say(r.text);
      return swap(`bd:${a}`, [blockDoneRow(id(a), r.name ?? "Block", Boolean(r.done))], r.text);
    }

    // ---- Payments ----------------------------------------------------------------------------
    case "py": {
      const v = await payMenu(c, id(a));
      await say("💳");
      return void (await send(chatId, v.text, v.kb));
    }
    case "pA": {
      const v = await payMenu(c, id(a), true);
      await say("💳");
      if (msgId) return edit(chatId, msgId, v.text, v.kb);
      return void (await send(chatId, v.text, v.kb));
    }
    case "pc":
    case "pC": {
      const r = await confirmPay(c, id(a), b === "n" ? null : id(b), null, verb === "pC");
      if (!r.ok) return say(r.text, true);
      await say(r.text);
      if (msgId) await edit(chatId, msgId, r.text, r.kb);
      else await send(chatId, r.text, r.kb);
      const alert = r.txnId ? await budgetAlert(c, r.txnId).catch(() => null) : null;
      if (alert) await send(chatId, alert);
      return;
    }
    case "pO": {
      await say("Write the amount");
      const q = await ask(chatId, "✍️ How much did you pay? Reply with the amount, e.g. “32.50” (add the account to change it: “32.50 visa”).", "32.50");
      if (!(await remember(c.admin, c.userId, chatId, q, "pay_amount", { eventId: id(a), accountId: b === "n" ? null : id(b), again: false }))) await needsMigration(chatId);
      return;
    }
    case "pk": {
      const r = await skipPay(c, id(a));
      if (!r.ok) return say(r.text, true);
      await say(r.text);
      // In a list (morning, /today, /payments) only its row changes; in the 💳 menu the whole message does
      const isMenu = kb.some((row) => row.some((x) => x.callback_data.startsWith("px:")));
      const next = isMenu ? null : replaceRows(kb, a, [[btn(`↩ Undo skip`, r.kb[0]?.[0]?.callback_data ?? "px")]]);
      if (next && msgId) return editKb(chatId, msgId, next);
      if (msgId && isMenu) return edit(chatId, msgId, r.text, r.kb);
      return void (await send(chatId, r.text, r.kb));
    }
    case "px":
      await say("OK");
      if (msgId) await editKb(chatId, msgId, []);
      return;

    // ---- Free days --------------------------------------------------------------------------
    case "fd":
      return pendingFreeDay(c, cq, chatId, msgId, id(a), b);

    // ---- Accounts, balances, movements ---------------------------------------------------------
    case "sa": {
      const r = await setTxnAccount(c, id(a), b === "n" ? null : id(b));
      if (!r.ok) return say(r.text, true);
      await say(r.text);
      const t = await getTxn(c, id(a));
      return swap(a, t ? [txnRow(t)] : [], r.text);
    }
    case "su": {
      const r = await setTxnAccount(c, id(a), b === "n" ? null : id(b));
      await say(r.text);
      const v = await unassignedView(c, Number(d) || 0);
      if (msgId) return edit(chatId, msgId, v.text, v.kb);
      return void (await send(chatId, v.text, v.kb));
    }
    case "sk": {
      await say("OK");
      if (a === "x") {
        if (msgId) await editKb(chatId, msgId, []);
        return;
      }
      const v = await unassignedView(c, Number(a) || 0);
      if (msgId) return edit(chatId, msgId, v.text, v.kb);
      return void (await send(chatId, v.text, v.kb));
    }
    case "bs":
      return pendingBalance(c, cq, chatId, msgId, id(a), b);
    case "md": {
      const t = await getTxn(c, id(a));
      if (!t || t.deleted_at) return say("Already deleted.", true);
      await deleteTxn(c, t.id);
      await say("🗑 Deleted");
      return swap(a, [[btn(`↩ Undo 🗑 ${txnLabel(t, c.tz)}`, `mr:${a}`)]], `🗑 Deleted: ${txnLabel(t, c.tz)}`);
    }
    case "mr": {
      await restoreTxn(c, id(a));
      await say("↩ Restored");
      const t = await getTxn(c, id(a));
      return swap(a, t ? [txnRow(t)] : []);
    }
    case "mt": {
      await c.admin.from("transfers").update({ deleted_at: new Date().toISOString() }).eq("id", id(a)).eq("user_id", c.userId);
      await say("🗑 Transfer deleted");
      return swap(a, [[btn("↩ Undo 🗑 transfer", `mT:${a}`)]]);
    }
    case "mT": {
      await c.admin.from("transfers").update({ deleted_at: null }).eq("id", id(a)).eq("user_id", c.userId);
      await say("↩ Transfer restored");
      return swap(a, [[btn("🗑 ⇄ transfer (restored)", `mt:${a}`)]]);
    }
    case "ma": {
      const list = await accounts(c);
      await say("Which account?");
      return swap(a, [...accountRows(list, (acc) => `sa:${a}:${acc}`), [btn("✕", `mc:${a}`)]], "🏦 Which account?");
    }
    case "mc": {
      await say("OK");
      const t = await getTxn(c, id(a));
      return swap(a, t ? [txnRow(t)] : []);
    }
    case "rp": {
      const file = await receiptOf(c, id(a));
      if (!file) return say("No receipt photo saved for this one.", true);
      await say("🧾");
      const t = await getTxn(c, id(a));
      if (!(await sendPhoto(chatId, file, t ? txnLabel(t, c.tz) : undefined))) await send(chatId, "Telegram could not send that photo any more.");
      return;
    }

    // ---- Notes ------------------------------------------------------------------------------
    case "no": {
      const v = await noteView(c, id(a));
      await say("📄");
      for (let i = 0; i < v.parts.length; i++) await send(chatId, v.parts[i], i === v.parts.length - 1 ? v.kb : null);
      return;
    }
    case "nA": {
      await say("Write the text");
      const q = await ask(chatId, "✏️ What should I add to this note? (reply to this message; “[] text” makes a checkbox)", "text to add");
      if (!(await remember(c.admin, c.userId, chatId, q, "note_append", { noteId: id(a) }))) await needsMigration(chatId);
      return;
    }
    case "nd": {
      await c.admin.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", id(a)).eq("user_id", c.userId).is("block_name", null);
      await say("🗑 Note deleted");
      if (msgId) await editKb(chatId, msgId, [[btn("↩ Undo delete", `nD:${a}`)]]);
      return;
    }
    case "nD": {
      await c.admin.from("notes").update({ deleted_at: null }).eq("id", id(a)).eq("user_id", c.userId);
      await say("↩ Note restored");
      if (msgId) await editKb(chatId, msgId, [[btn("✏️ Add text", `nA:${a}`), btn("🗑 Delete", `nd:${a}`)]]);
      return;
    }

    // ---- Insights -----------------------------------------------------------------------------
    case "ir": {
      await c.admin.from("system_insights").update({ is_read: true }).eq("id", id(a)).eq("user_id", c.userId);
      await say("✓ Read");
      return swap(a, []);
    }
    case "ig": {
      const ok = await generateInsights(c);
      await say(ok ? "🔄 Done" : "Could not generate them now.", !ok);
      const v = await insightsView(c);
      if (msgId) return edit(chatId, msgId, v.text, v.kb);
      return;
    }

    // ---- Settings -------------------------------------------------------------------------------
    case "st":
    case "sb":
    case "sv":
    case "sX": {
      if (verb === "st") await toggleSetting(c, a);
      if (verb === "sb") await cycleBefore(c);
      if (verb === "sv") await setTime(c, a, b);
      await say("Saved ✓");
      const v = await settingsView(c);
      if (msgId) return edit(chatId, msgId, v.text, v.kb);
      return;
    }
    case "sT":
      await say("Pick a time");
      if (msgId) await editKb(chatId, msgId, timeRows(a === "e" ? "e" : "m"));
      return;
    case "sx":
      await say("OK");
      if (msgId) await editKb(chatId, msgId, []);
      return;

    default:
      return say("This button is from an older version.", true);
  }
}

/** Questions need bot_threads (migration 0019) to know what an answer belongs to. */
async function needsMigration(chatId: number) {
  await send(chatId, "⚠ Answering this needs the database update (migration 0019 in Supabase). Until then, do it on the web. Your reply would be saved as a new item, so don't send it.");
}

// ---- Things waiting for a tap (kept in bot_messages with status "parsed") ------------------------

async function pendingRow(c: Ctx, bmId: string) {
  const { data } = await c.admin.from("bot_messages").select("id,status,parsed").eq("id", bmId).eq("user_id", c.userId).maybeSingle();
  if (!data || data.status !== "parsed") return null;
  // Claim it, so a double tap cannot run it twice
  const { data: claimed } = await c.admin.from("bot_messages").update({ status: "received" }).eq("id", data.id).eq("status", "parsed").select("id");
  if (!claimed?.length) return null;
  return { id: data.id as string, parsed: (data.parsed ?? {}) as Record<string, unknown> };
}

const done = (c: Ctx, id: string, status: "undone" | "saved" | "parsed") => c.admin.from("bot_messages").update({ status }).eq("id", id).eq("user_id", c.userId);

async function pickAccount(c: Ctx, cq: CallbackQuery, chatId: number, msgId: number | null, bmId: string, choice: string) {
  const bm = await pendingRow(c, bmId);
  if (!bm || bm.parsed.kind !== "transaction") return toast(cq.id, "Already handled.");
  if (choice === "x") {
    await done(c, bm.id, "undone");
    await toast(cq.id, "Cancelled.");
    if (msgId) await edit(chatId, msgId, "Cancelled. Nothing was saved.", []);
    return;
  }
  try {
    const parsed = bm.parsed as unknown as Extract<Parsed, { kind: "transaction" }> & { receipt?: string };
    const saved = await savePendingTransaction(c.admin, c.userId, parsed, choice === "n" ? null : upk(choice));
    await c.admin.from("bot_messages").update({ status: "saved", entity_type: saved.entityType, entity_id: saved.id }).eq("id", bm.id);
    if (parsed.receipt) await setReceipt(c, saved.id, parsed.receipt).catch(() => null);
    await toast(cq.id, "Saved ✓");
    const text = `Saved ✓ ${saved.summary}${parsed.receipt ? " · 🧾" : ""}`;
    if (msgId) {
      await edit(chatId, msgId, text, undoRow(bm.id));
      await remember(c.admin, c.userId, chatId, msgId, "saved", { bm: bm.id });
    } else {
      const m = await send(chatId, text, undoRow(bm.id));
      await remember(c.admin, c.userId, chatId, m, "saved", { bm: bm.id });
    }
    const alert = await budgetAlert(c, saved.id).catch(() => null);
    if (alert) await send(chatId, alert);
  } catch (e) {
    await done(c, bm.id, "parsed");
    await toast(cq.id, e instanceof CaptureError ? e.message : "Could not save that. Try again.", true);
  }
}

async function pendingHabit(c: Ctx, cq: CallbackQuery, chatId: number, msgId: number | null, bmId: string, choice: string) {
  const bm = await pendingRow(c, bmId);
  if (!bm || bm.parsed.kind !== "habit_pending") return toast(cq.id, "Already handled.");
  await done(c, bm.id, "undone");
  if (choice === "x") {
    await toast(cq.id, "Cancelled.");
    if (msgId) await edit(chatId, msgId, "Cancelled. No habit was created.", []);
    return;
  }
  let r;
  if (choice === "n") {
    r = await saveHabit(c, "(habit)", String(bm.parsed.full ?? bm.parsed.name), null, null);
  } else {
    const blockId = upk(choice);
    const { data: bt } = await c.admin.from("block_types").select("id,name").eq("id", blockId ?? "").eq("user_id", c.userId).maybeSingle();
    if (!bt) return toast(cq.id, "That block no longer exists.", true);
    r = await saveHabit(c, "(habit)", String(bm.parsed.name), bt.id as string, bt.name as string);
  }
  await toast(cq.id, "Saved ✓");
  if (msgId) await edit(chatId, msgId, r.text, r.kb);
  else await send(chatId, r.text, r.kb);
}

async function pendingFreeDay(c: Ctx, cq: CallbackQuery, chatId: number, msgId: number | null, bmId: string, choice: string) {
  const bm = await pendingRow(c, bmId);
  if (!bm || bm.parsed.kind !== "freeday_pending") return toast(cq.id, "Already handled.");
  await done(c, bm.id, "undone");
  if (choice === "x") {
    await toast(cq.id, "Cancelled.");
    if (msgId) await edit(chatId, msgId, "Cancelled. No free day was saved.", []);
    return;
  }
  const policy: FreeDayPolicy = choice === "u" ? "unassigned" : choice === "h" ? "home_block" : "move_next";
  const r = await saveFreeDay(c, "(free day)", String(bm.parsed.from), String(bm.parsed.to), (bm.parsed.note as string | null) ?? null, policy);
  await toast(cq.id, "🌴");
  if (msgId) await edit(chatId, msgId, r.text, r.kb);
  else await send(chatId, r.text, r.kb);
}

async function pendingBalance(c: Ctx, cq: CallbackQuery, chatId: number, msgId: number | null, bmId: string, choice: string) {
  const bm = await pendingRow(c, bmId);
  if (!bm || bm.parsed.kind !== "balance_pending") return toast(cq.id, "Already handled.");
  await done(c, bm.id, "undone");
  if (choice !== "y") {
    await toast(cq.id, "Cancelled.");
    if (msgId) await edit(chatId, msgId, "Cancelled. The balance was not changed.", []);
    return;
  }
  const r = await saveBalance(c, String(bm.parsed.accountId), Number(bm.parsed.amount));
  await toast(cq.id, "Saved ✓");
  if (msgId) await edit(chatId, msgId, r.text, r.kb);
  else await send(chatId, r.text, r.kb);
}

