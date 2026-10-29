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
  "Personal OS bot: write it the way you'd say it, then tap the buttons. Spanish works too.",
  "",
  "SAVE",
  "• spent 12 lunch · -20 dinner · $45 groceries · gasté 1.500 arriendo",
  "• received 1500 salary · +300 client",
  "• transfer 50 from cash to Pichincha",
  "• task: call mom friday @Home #family",
  "• note: Title (more lines = the text)",
  "• event: dentist friday 3pm · event: trip 2-5 nov",
  "• payment: internet 32 monthly on the 10th · income: salary 1500 monthly on the 1st",
  "• free day tomorrow · free day 2-5 nov",
  "• nb: text → the note of the block you're in (nb Gym: text for another one)",
  "• habit: Stretch in Gym · done stretch · skip stretch · done <task>",
  "• sleep 7.5 → today's metric (with your metric names)",
  "• balance pichincha 1234.50 → the real balance of an account",
  "• 🎙 voice notes and 🧾 receipt photos (with Gemini)",
  "",
  "LOOK",
  "/today /now /tomorrow /week /nextweek /day friday",
  "/tasks /archived /payments /balance /budget /movements /unassigned",
  "/search word /notes /habits /metrics /insights /settings /menu",
  "",
  "FIX",
  "• Undo under everything saved · /undo = the last thing",
  "• Reply to a “Saved ✓” message with an amount, an account, a date, a new name, @Block, done or delete",
  "• Task buttons: ✓ done · ⏭ next time its block happens · ⋯ date, block, rename, archive",
  "",
].join("\n");

/** The buttons that stay under the keyboard (each one sends its text). */
export const MENU_KEYBOARD = {
  keyboard: [
    [{ text: "📅 Today" }, { text: "▶️ Now" }, { text: "🌙 Tomorrow" }],
    [{ text: "📋 Tasks" }, { text: "💳 Payments" }, { text: "💰 Balance" }],
    [{ text: "🔎 Search" }, { text: "⚙️ Settings" }, { text: "❓ Help" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "spent 12 lunch · task: … · /today",
};

/** UUID <-> 22-character base64url, so two ids fit in Telegram's 64-byte button data. */
export function packId(uuid: string) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

export function unpackId(packed: string) {
  const hex = Buffer.from(packed, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Downloads a file the user sent (voice note, photo). null if it's missing or too big (Telegram bots: 20 MB). */
export async function downloadFile(fileId: string, maxBytes = 15 * 1024 * 1024) {
  const token = botToken();
  if (!token) return null;
  const info = (await tg("getFile", { file_id: fileId })) as { ok: boolean; result?: { file_path?: string; file_size?: number } } | null;
  const path = info?.ok ? info.result?.file_path : undefined;
  if (!path || (info?.result?.file_size ?? 0) > maxBytes) return null;
  const res = await fetch(`${API}/file/bot${token}/${path}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) return null;
  return { base64: buf.toString("base64"), path };
}
