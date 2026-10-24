import { createHash } from "node:crypto";

const API = "https://api.telegram.org";

export function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/** Secret Telegram sends back on every webhook call; derived from the token so no extra setting is needed. */
export function webhookSecret(token: string) {
  return createHash("sha256").update(`personal-os:${token}`).digest("hex").slice(0, 48);
}

export async function tg(method: string, body: Record<string, unknown>) {
  const token = botToken();
  if (!token) return null;
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return (await res.json().catch(() => null)) as { ok: boolean; result?: unknown; description?: string } | null;
}

export function sendMessage(chatId: number, text: string, undoId?: string) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    ...(undoId ? { reply_markup: { inline_keyboard: [[{ text: "Undo", callback_data: `undo:${undoId}` }]] } } : {}),
  });
}

export const HELP = [
  "Send me anything and I'll file it in Personal OS:",
  "• spent 12 on lunch  → expense",
  "• received 1500 salary → income",
  "• task: call mom tomorrow → task",
  "• note: idea… → note",
  "• plain short text → task",
  "",
  "/undo removes the last thing I saved.",
].join("\n");

/** UUID <-> 22-character base64url, so two ids fit in Telegram's 64-byte button data. */
export function packId(uuid: string) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

export function unpackId(packed: string) {
  const hex = Buffer.from(packed, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
