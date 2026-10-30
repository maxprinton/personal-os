import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { botToken, tg, webhookSecret } from "@/lib/telegram";
import { localNow } from "@/lib/time";
import { markUsageReported, scopeCalls, scopeOwner, scopeReported, scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { handleCallback, type CallbackQuery } from "@/lib/bot/callbacks";
import { handleMessage, type TgMessage } from "@/lib/bot/messages";
import { send } from "@/lib/bot/tg";

// Telegram webhook. Button taps → lib/bot/callbacks.ts; messages → lib/bot/messages.ts.
// It always answers 200 (otherwise Telegram sends the same update again and again).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Voice notes and photos wait for the AI (a few seconds)
export const maxDuration = 30;

type TgUpdate = { message?: TgMessage; callback_query?: CallbackQuery };

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
  try {
    await withAiUsage("telegram", async () => {
      if (update.callback_query) await handleCallback(admin, update.callback_query);
      else if (update.message) await handleMessage(admin, update.message);
      // The AI was used (voice note, receipt photo, a message the rules didn't get) and nothing showed
      // its usage yet: one quiet line with what it cost and what's left today
      const owner = scopeOwner();
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (owner && chatId && scopeCalls().length && !scopeReported()) {
        const line = await scopeUsageLine(owner.sb, owner.userId, owner.tz, localNow(owner.tz).date);
        markUsageReported();
        if (line) await tg("sendMessage", { chat_id: chatId, text: line, disable_notification: true }).catch(() => null);
      }
    });
  } catch (e) {
    console.error("telegram webhook", e);
    const chatId = update.message?.chat.id;
    if (chatId) await send(chatId, "Sorry, something went wrong with that one. Try again in a minute.").catch(() => null);
  }
  return ok();
}
