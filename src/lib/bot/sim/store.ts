// The Telegram simulator's "fake Telegram" (server only). While a simulated message runs inside simStore,
// the bot's only way out — tg() in lib/telegram.ts — writes here instead of calling api.telegram.org, and the AI
// is switched off. The events it collects are what the page draws as chat bubbles.
import { AsyncLocalStorage } from "node:async_hooks";

export type Btn = { text: string; callback_data: string };
export type Kb = Btn[][];

export type SimEvent =
  | { t: "send"; id: number; text: string; kb: Kb | null; ask?: boolean }
  | { t: "edit"; id: number; text: string; kb: Kb | null }
  | { t: "kb"; id: number; kb: Kb }
  | { t: "toast"; text: string; alert?: boolean }
  | { t: "photo"; id: number; caption?: string };

export type SimScope = { events: SimEvent[]; nextId: number };

export const simStore = new AsyncLocalStorage<SimScope>();
export const inSim = () => simStore.getStore() !== undefined;

const rowsOf = (markup: unknown): Kb | null => {
  const kb = (markup as { inline_keyboard?: Kb } | undefined)?.inline_keyboard;
  return Array.isArray(kb) && kb.length ? kb.map((r) => r.map((b) => ({ text: String(b.text), callback_data: String(b.callback_data ?? "") }))) : null;
};

/** What Telegram would answer, while recording what the user would have seen. */
export function simTg(s: SimScope, method: string, body: Record<string, unknown>): { ok: boolean; result?: unknown; description?: string } {
  const markup = body.reply_markup as { force_reply?: boolean } | undefined;
  switch (method) {
    case "sendMessage": {
      const id = ++s.nextId;
      s.events.push({ t: "send", id, text: String(body.text ?? ""), kb: rowsOf(body.reply_markup), ask: Boolean(markup?.force_reply) || undefined });
      return { ok: true, result: { message_id: id } };
    }
    case "editMessageText":
      s.events.push({ t: "edit", id: Number(body.message_id), text: String(body.text ?? ""), kb: rowsOf(body.reply_markup) });
      return { ok: true, result: true };
    case "editMessageReplyMarkup":
      s.events.push({ t: "kb", id: Number(body.message_id), kb: rowsOf(body.reply_markup) ?? [] });
      return { ok: true, result: true };
    case "answerCallbackQuery":
      if (body.text) s.events.push({ t: "toast", text: String(body.text), alert: Boolean(body.show_alert) || undefined });
      return { ok: true, result: true };
    case "sendPhoto": {
      const id = ++s.nextId;
      s.events.push({ t: "photo", id, caption: body.caption ? String(body.caption) : undefined });
      return { ok: true, result: { message_id: id } };
    }
    case "getFile":
      return { ok: false, description: "Files are not available in practice mode." };
    default:
      return { ok: true, result: true };
  }
}
