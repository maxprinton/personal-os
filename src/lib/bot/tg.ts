// Telegram plumbing for the bot (server only): send / edit / toast / ask, buttons, keyboards that
// change in place, and "threads" (which bot message a reply belongs to; table bot_threads, migration 0019).
import type { SupabaseClient } from "@supabase/supabase-js";
import { packId, tg, unpackId } from "@/lib/telegram";

export type Btn = { text: string; callback_data: string };
export type Kb = Btn[][];

/** A button. Telegram allows 64 bytes of data; longer data is a bug, so it is logged and cut. */
export function btn(text: string, data: string): Btn {
  if (Buffer.byteLength(data) > 64) console.error("callback_data too long", data);
  return { text: text.length > 60 ? `${text.slice(0, 57)}…` : text, callback_data: data.slice(0, 64) };
}

export const pk = packId;
export const upk = unpackId;

const TG_MAX = 3900;

/** Splits long text into Telegram-sized parts (at line breaks when possible). */
export function split(text: string, max = TG_MAX) {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.length ? out : [""];
}

/** Sends text (split if long; the keyboard goes on the last part). Returns the last message id. */
export async function send(chatId: number, text: string, kb?: Kb | null, extra: Record<string, unknown> = {}): Promise<number | null> {
  const parts = split(text);
  let id: number | null = null;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const r = (await tg("sendMessage", {
      chat_id: chatId,
      text: parts[i] || "…",
      ...(last && kb && kb.length ? { reply_markup: { inline_keyboard: kb } } : {}),
      ...(last ? extra : {}),
    }).catch(() => null)) as { ok: boolean; result?: { message_id?: number } } | null;
    id = r?.result?.message_id ?? id;
  }
  return id;
}

/** Replaces a message's text (and keyboard). Falls back to a new message when it can't be edited. */
export async function edit(chatId: number, messageId: number, text: string, kb?: Kb | null) {
  const r = await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: split(text)[0],
    reply_markup: { inline_keyboard: kb ?? [] },
  }).catch(() => null);
  if (!r?.ok && !String(r?.description ?? "").includes("not modified")) await send(chatId, text, kb);
}

/** Replaces only the keyboard under a message. */
export async function editKb(chatId: number, messageId: number, kb: Kb) {
  await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: kb } }).catch(() => null);
}

/** The short notice at the top of the chat after tapping a button. */
export async function toast(callbackId: string, text: string, alert = false) {
  await tg("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190), show_alert: alert }).catch(() => null);
}

/** Sends a photo already on Telegram (by file id). */
export async function sendPhoto(chatId: number, fileId: string, caption?: string) {
  const r = await tg("sendPhoto", { chat_id: chatId, photo: fileId, ...(caption ? { caption: caption.slice(0, 1000) } : {}) }).catch(() => null);
  return Boolean(r?.ok);
}

/** Asks a question whose answer is the next reply (Telegram opens the reply box). Returns its message id. */
export async function ask(chatId: number, text: string, placeholder?: string) {
  return send(chatId, text, null, {
    reply_markup: { force_reply: true, selective: true, ...(placeholder ? { input_field_placeholder: placeholder.slice(0, 64) } : {}) },
  });
}

// ---- Keyboards that change in place ------------------------------------------------

/**
 * Replaces the rows that belong to `key` (a packed id inside their buttons' data) with `rows`.
 * Rows of other items stay as they are. Returns null when no row had that key.
 */
export function replaceRows(kb: Kb, key: string, rows: Kb): Kb | null {
  const has = (row: Btn[]) => row.some((b) => (b.callback_data ?? "").includes(key));
  const first = kb.findIndex(has);
  if (first < 0) return null;
  const out: Kb = [];
  kb.forEach((row, i) => {
    if (i === first) out.push(...rows);
    else if (!has(row)) out.push(row);
  });
  return out;
}

/** The keyboard of the message a button was tapped on (Telegram sends it with the tap). */
export function keyboardOf(message: unknown): Kb {
  const kb = (message as { reply_markup?: { inline_keyboard?: Kb } } | undefined)?.reply_markup?.inline_keyboard;
  return Array.isArray(kb) ? kb.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callback_data }))) : [];
}

// ---- Threads: which bot message a reply belongs to ------------------------------------

export type Thread = { kind: string; payload: Record<string, unknown> };

/** Remembers what a bot message is about, so a reply to it can be understood. Needs migration 0019. */
export async function remember(admin: SupabaseClient, userId: string, chatId: number, messageId: number | null, kind: string, payload: Record<string, unknown>) {
  if (!messageId) return false;
  const { error } = await admin.from("bot_threads").insert({ user_id: userId, chat_id: chatId, message_id: messageId, kind, payload });
  return !error;
}

export async function recall(admin: SupabaseClient, userId: string, chatId: number, messageId: number): Promise<Thread | null> {
  const { data, error } = await admin
    .from("bot_threads")
    .select("kind,payload")
    .eq("user_id", userId)
    .eq("chat_id", chatId)
    .eq("message_id", messageId)
    .maybeSingle();
  if (error || !data) return null;
  return { kind: data.kind as string, payload: (data.payload ?? {}) as Record<string, unknown> };
}

/**
 * Logs an action like a capture, so the Undo button and /undo can reverse it. Returns the log id.
 * Button actions (raw starting with "(") are stored as "button:…" and don't count toward the daily limit.
 */
export async function logAction(
  admin: SupabaseClient,
  userId: string,
  raw: string,
  entityType: string,
  entityId: string | null,
  parsed: Record<string, unknown> = {}
) {
  const { data } = await admin
    .from("bot_messages")
    .insert({ user_id: userId, raw_text: raw.startsWith("(") || !raw ? `button:${raw || "(button)"}` : raw.slice(0, 4000), status: "saved", parsed: { ...parsed, kind: entityType }, entity_type: entityType, entity_id: entityId })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}

/** The Undo button for a logged action. */
export const undoRow = (logId: string | null): Kb => (logId ? [[btn("↩ Undo", `undo:${logId}`)]] : []);
