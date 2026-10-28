// Replies to the bot's own messages (server only):
//  · reply to a "Saved ✓ …" message to correct it: an amount, an account, a date, a category, a new
//    name, "@Block", "done", or "delete";
//  · answers to the bot's questions (new name, another date, the amount paid, text to add to a note).
import { getBlockTypes } from "@/lib/calendar/model";
import { autoPlaceTasks } from "@/lib/calendar/tasks";
import { zonedToUtc } from "@/lib/time";
import { findAccount } from "@/lib/capture";
import type { Ctx } from "@/lib/bot/core";
import { usd } from "@/lib/bot/core";
import { recall, undoRow, type Kb } from "@/lib/bot/tg";
import { bestMatches, findAmount, findDate, findTime, fold, onlyAmount, onlyDate, plusMinutes, shortDay, simplify } from "@/lib/bot/text";
import { completeTask, moveToDate, renameTask, doneRow } from "@/lib/bot/tasks";
import { confirmPay } from "@/lib/bot/calendar";
import { accounts, budgetAlert } from "@/lib/bot/finance";
import { appendToNote } from "@/lib/bot/queries";
import { undoLogged, type LogRow } from "@/lib/bot/undo";

type Reply = { text: string; kb: Kb; extra?: string | null };

const DELETE = /^(?:borrar|borra|borralo|eliminar|elimina|delete|remove|undo|deshacer|cancelar|cancel|quitar)$/i;
const DONE = /^(?:hecha?|hecho|lista?|listo|done|completed?|terminad[ao])$/i;
const STOP = /\b(?:con|en|de|del|desde|from|with|on|in|using|la|el|a|al|para|for|por|the|cuenta|account)\b/gi;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** null = this reply is not to a message the bot knows: handle it as a normal message. */
export async function handleReply(c: Ctx, replyTo: number, text: string): Promise<Reply | null> {
  const thread = await recall(c.admin, c.userId, c.chatId, replyTo);
  if (!thread) return null;
  const p = thread.payload;
  const answer = text.trim();
  switch (thread.kind) {
    case "task_rename": {
      const r = await renameTask(c, String(p.taskId), answer);
      return { text: r.text, kb: [] };
    }
    case "task_date": {
      const date = onlyDate(answer, c.today, "future") ?? findDate(answer, c.today, "future")?.date ?? null;
      if (!date) return { text: "I didn't get that date. Try “friday”, “5 nov” or “2026-11-05”, replying to the question again.", kb: [] };
      const r = await moveToDate(c, String(p.taskId), date);
      return { text: r.text, kb: [] };
    }
    case "pay_amount": {
      const amount = onlyAmount(answer) ?? findAmount(answer)?.amount ?? null;
      if (!amount) return { text: "Write the amount you paid, e.g. “32.50” (you can add the account: “32.50 pichincha”).", kb: [] };
      const list = await accounts(c);
      const named = findAccount(answer, list)?.account.id ?? null;
      const accountId = named ?? (typeof p.accountId === "string" ? p.accountId : null);
      const r = await confirmPay(c, String(p.eventId), accountId, amount, Boolean(p.again));
      const extra = r.ok && r.txnId ? await budgetAlert(c, r.txnId).catch(() => null) : null;
      return { text: r.text, kb: r.kb, extra };
    }
    case "note_append": {
      const r = await appendToNote(c, String(p.noteId), answer);
      return { text: r.text, kb: [] };
    }
    case "saved":
      return correct(c, String(p.bm), answer);
    default:
      return null;
  }
}

async function correct(c: Ctx, bmId: string, answer: string): Promise<Reply> {
  const { data } = await c.admin
    .from("bot_messages")
    .select("id,entity_type,entity_id,status,parsed")
    .eq("id", bmId)
    .eq("user_id", c.userId)
    .maybeSingle();
  const bm = data as LogRow | null;
  if (!bm || !bm.entity_id) return { text: "I can't find that one any more.", kb: [] };
  if (bm.status !== "saved") return { text: "That one was already undone.", kb: [] };
  if (DELETE.test(fold(answer).trim())) {
    const t = await undoLogged(c, bm);
    return { text: t ?? "Nothing to undo.", kb: [] };
  }
  switch (bm.entity_type) {
    case "transaction":
      return correctTxn(c, bm.entity_id, answer);
    case "task":
      return correctTask(c, bm.entity_id, answer);
    case "note": {
      const t = /^(?:t[ií]tulo|title)\s*:\s*(.+)$/i.exec(answer);
      if (t) {
        await c.admin.from("notes").update({ title: t[1].trim().slice(0, 200) }).eq("id", bm.entity_id).eq("user_id", c.userId);
        return { text: `✏️ Note renamed: ${t[1].trim()}`, kb: [] };
      }
      const r = await appendToNote(c, bm.entity_id, answer);
      return { text: r.text, kb: [] };
    }
    case "habit": {
      const name = answer.replace(/\s+/g, " ").slice(0, 80);
      await c.admin.from("habits").update({ name }).eq("id", bm.entity_id).eq("user_id", c.userId);
      return { text: `✏️ Habit renamed: ${name}`, kb: [] };
    }
    case "event":
      return correctEvent(c, bm.entity_id, answer);
    case "transfer": {
      const amount = onlyAmount(answer) ?? findAmount(answer)?.amount ?? null;
      const date = findDate(answer, c.today, "past")?.date ?? null;
      if (!amount && !date) return { text: "For a transfer you can change the amount or the date, or write “delete”.", kb: [] };
      await c.admin
        .from("transfers")
        .update({
          ...(amount ? { amount } : {}),
          ...(date ? { occurred_at: date === c.today ? new Date().toISOString() : zonedToUtc(date, "12:00", c.tz).toISOString() } : {}),
        })
        .eq("id", bm.entity_id)
        .eq("user_id", c.userId);
      return { text: `✏️ Transfer updated${amount ? `: ${usd(amount)}` : ""}${date ? ` (${shortDay(date)})` : ""}`, kb: [] };
    }
    case "payment_template": {
      const amount = onlyAmount(answer);
      if (amount) {
        await c.admin.from("payment_templates").update({ expected_amount: amount }).eq("id", bm.entity_id).eq("user_id", c.userId);
        return { text: `✏️ Expected amount: ${usd(amount)}`, kb: [] };
      }
      const name = answer.replace(/\s+/g, " ").slice(0, 80);
      await c.admin.from("payment_templates").update({ name }).eq("id", bm.entity_id).eq("user_id", c.userId);
      await c.admin.from("events").update({ title: name }).eq("user_id", c.userId).eq("payment_template_id", bm.entity_id).is("payment_status", null);
      return { text: `✏️ Payment renamed: ${name}`, kb: [] };
    }
    default:
      return { text: "This one can only be undone: reply “delete”.", kb: [] };
  }
}

async function correctTxn(c: Ctx, id: string, answer: string): Promise<Reply> {
  const { data: t } = await c.admin
    .from("transactions")
    .select("id,type,amount,description,account_id,category_id,occurred_at")
    .eq("id", id)
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!t) return { text: "That transaction no longer exists.", kb: [] };
  const [list, { data: cats }] = await Promise.all([
    accounts(c),
    c.admin.from("categories").select("id,name,kind").eq("user_id", c.userId).is("deleted_at", null),
  ]);
  const changes: Record<string, unknown> = {};
  let rest = answer;
  const amount = onlyAmount(rest) ?? findAmount(rest)?.amount ?? null;
  if (amount) {
    changes.amount = amount;
    rest = findAmount(rest)?.rest ?? "";
  }
  if (/\b(?:sin cuenta|no account)\b/i.test(fold(rest))) {
    changes.account_id = null;
    rest = fold(rest).replace(/\b(?:sin cuenta|no account)\b/, "");
  } else {
    const acc = findAccount(rest, list);
    if (acc) {
      changes.account_id = acc.account.id;
      rest = fold(rest).replace(acc.needle, "");
    }
  }
  const d = findDate(rest, c.today, "past");
  if (d) {
    changes.occurred_at = d.date === c.today ? new Date().toISOString() : zonedToUtc(d.date, "12:00", c.tz).toISOString();
    rest = d.rest;
  }
  if (/^(?:ingreso|income)$/i.test(rest.trim())) {
    changes.type = "income";
    rest = "";
  } else if (/^(?:gasto|expense)$/i.test(rest.trim())) {
    changes.type = "expense";
    rest = "";
  }
  const type = (changes.type as string | undefined) ?? (t.type as string);
  const catList = ((cats ?? []) as { id: string; name: string; kind: string }[]).filter((x) => x.kind === type);
  const words = simplify(rest);
  const cat = catList.find((x) => words === simplify(x.name) || new RegExp(`\\b${simplify(x.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(words));
  if (cat) {
    changes.category_id = cat.id;
    rest = words.replace(simplify(cat.name), "");
  }
  const leftover = rest.replace(STOP, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (leftover.length >= 3 && !Object.keys(changes).length) changes.description = cap(answer.trim().slice(0, 300));
  else if (leftover.length >= 3 && changes.amount && !changes.category_id && !changes.account_id && !changes.occurred_at) changes.description = cap(leftover);
  if (!Object.keys(changes).length) return { text: "Nothing to change. Reply with an amount, an account, a date, a category, a new description, or “delete”.", kb: [] };
  await c.admin.from("transactions").update(changes).eq("id", id).eq("user_id", c.userId);
  const { data: n } = await c.admin
    .from("transactions")
    .select("type,amount,description,account_id,category_id,occurred_at")
    .eq("id", id)
    .eq("user_id", c.userId)
    .maybeSingle();
  const accName = n?.account_id ? list.find((a) => a.id === n.account_id)?.name ?? "?" : "no account";
  const catName = n?.category_id ? ((cats ?? []) as { id: string; name: string }[]).find((x) => x.id === n.category_id)?.name : null;
  const extra = changes.amount || changes.category_id ? await budgetAlert(c, id).catch(() => null) : null;
  return {
    text: `✏️ Updated: ${n?.type === "income" ? "Income" : "Expense"} ${usd(Number(n?.amount ?? 0))}${n?.description ? ` · ${n.description}` : ""}${catName ? ` · ${catName}` : ""} · ${accName}`,
    kb: [],
    extra,
  };
}

async function correctTask(c: Ctx, id: string, answer: string): Promise<Reply> {
  if (DONE.test(fold(answer).trim())) {
    const r = await completeTask(c, id);
    return { text: r.text, kb: r.ok ? doneRow({ id, title: r.title ?? "task" }) : [] };
  }
  const date = onlyDate(answer, c.today, "future");
  if (date) {
    const r = await moveToDate(c, id, date);
    return { text: r.text, kb: [] };
  }
  const at = /^@(.+)$/.exec(answer.trim());
  if (at) {
    const types = await getBlockTypes(c.admin, c.userId);
    const found = bestMatches(types, at[1], (t) => t.name);
    if (found.length !== 1) return { text: `No single block matches “${at[1]}”. Your blocks: ${types.map((t) => t.name).join(", ")}.`, kb: [] };
    await c.admin.from("tasks").update({ home_block_type_id: found[0].id }).eq("id", id).eq("user_id", c.userId);
    await autoPlaceTasks(c.admin, c.userId, c.today);
    return { text: `🧱 Home block: ${found[0].name}`, kb: [] };
  }
  const r = await renameTask(c, id, answer);
  return { text: r.text, kb: [] };
}

async function correctEvent(c: Ctx, id: string, answer: string): Promise<Reply> {
  const { data: ev } = await c.admin
    .from("events")
    .select("id,title,event_date,end_date,start_time,end_time")
    .eq("id", id)
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!ev) return { text: "That event no longer exists.", kb: [] };
  let rest = answer;
  const time = findTime(rest);
  if (time) rest = time.rest;
  const d = findDate(rest, c.today, "future");
  if (d) rest = d.rest;
  if (!time && !d) {
    const title = answer.trim().slice(0, 300);
    await c.admin.from("events").update({ title }).eq("id", id).eq("user_id", c.userId);
    return { text: `✏️ Event renamed: ${title}`, kb: [] };
  }
  const date = d?.date ?? (ev.event_date as string);
  const span = Math.max(0, Math.round((new Date(`${ev.end_date}T12:00:00Z`).getTime() - new Date(`${ev.event_date}T12:00:00Z`).getTime()) / 86400000));
  const values: Record<string, unknown> = { event_date: date };
  let endDate = new Date(new Date(`${date}T12:00:00Z`).getTime() + span * 86400000).toISOString().slice(0, 10);
  if (time) {
    const end = time.end ?? plusMinutes(time.start, 60);
    if (end <= time.start && endDate === date) endDate = new Date(new Date(`${date}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    values.start_time = zonedToUtc(date, time.start, c.tz).toISOString();
    values.end_time = zonedToUtc(endDate, end, c.tz).toISOString();
    if (end === "00:00") endDate = date;
  } else if (ev.start_time && ev.end_time) {
    const shift = new Date(`${date}T12:00:00Z`).getTime() - new Date(`${ev.event_date}T12:00:00Z`).getTime();
    values.start_time = new Date(new Date(ev.start_time as string).getTime() + shift).toISOString();
    values.end_time = new Date(new Date(ev.end_time as string).getTime() + shift).toISOString();
  }
  values.end_date = endDate;
  await c.admin.from("events").update(values).eq("id", id).eq("user_id", c.userId);
  return { text: `✏️ ${ev.title}: ${shortDay(date)}${time ? ` · ${time.start}${time.end ? `–${time.end}` : ""}` : ""}`, kb: [] };
}

export { undoRow };
