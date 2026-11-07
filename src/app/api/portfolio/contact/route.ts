// The public site forwards contact-form messages here. Anyone can reach this address, so nothing is trusted unless the request
// carries a valid HMAC signature (shared secret PORTFOLIO_REVALIDATE_SECRET, 5 minute window). Written with the service key.
import { NextResponse } from "next/server";
import { send } from "@/lib/bot/tg";
import { handleContact } from "@/lib/portfolio/contact";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const body = await req.text();
  const r = await handleContact(
    {
      db,
      secret: process.env.PORTFOLIO_REVALIDATE_SECRET,
      notify: async (userId, text) => {
        const { data } = await db.from("user_settings").select("telegram_chat_id").eq("user_id", userId).maybeSingle();
        const chat = (data as { telegram_chat_id: number | null } | null)?.telegram_chat_id;
        if (chat) await send(chat, text);
      },
    },
    body,
    req.headers,
  );
  return NextResponse.json(r.body, { status: r.status });
}
