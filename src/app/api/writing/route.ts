// The writing checker's AI: one paragraph → a few fixes with their why. Counts the checks it makes on
// its own against the daily cap (user_settings.writing, migration 0024); the ones you ask for don't count.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiJson, hasAi } from "@/lib/ai";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { AI_TEXT_LIMIT, parseFixes, writingSystemPrompt, type WritingAiRequest } from "@/lib/ai-writing";
import { AI_DAILY_CAP, type WritingSettings } from "@/lib/writing/settings";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!hasAi()) return NextResponse.json({ error: "The AI is not connected (GROQ_API_KEY)." }, { status: 503 });
  let body: WritingAiRequest;
  try {
    body = (await req.json()) as WritingAiRequest;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const text = String(body.text ?? "");
  if (!text.trim() || text.length > AI_TEXT_LIMIT) return NextResponse.json({ fixes: [] });
  const lang = body.lang === "en" ? "en" : "es";
  const reason = body.reason === "manual" ? "manual" : body.reason === "native" ? "native" : "grave";

  const { data: row } = await sb.from("user_settings").select("writing").eq("user_id", user.id).maybeSingle();
  const settings = ((row as { writing?: WritingSettings } | null)?.writing ?? {}) as WritingSettings;
  if (reason !== "manual") {
    if (settings.ai === false) return NextResponse.json({ fixes: [], off: true });
    const { timezone } = await getSettings(sb);
    const today = localNow(timezone).date;
    const count = settings.aiDay === today ? settings.aiCount ?? 0 : 0;
    if (count >= AI_DAILY_CAP) return NextResponse.json({ fixes: [], capped: true });
    await sb.from("user_settings").update({ writing: { ...settings, aiDay: today, aiCount: count + 1 } }).eq("user_id", user.id);
  }

  const known = (Array.isArray(body.known) ? body.known : []).filter((w) => typeof w === "string").slice(0, 80);
  return withAiUsage(
    "writing",
    async () => {
      const raw = await aiJson(writingSystemPrompt({ text, lang, reason, known, voice: settings.voice ?? null }), [{ text: `PARAGRAPH (${lang === "es" ? "Spanish" : "English"}):\n${text}` }], "write");
      if (raw === null) return NextResponse.json({ error: "The AI couldn't answer now." }, { status: 502 });
      const { timezone } = await getSettings(sb);
      const usage = await scopeUsageLine(sb, user.id, timezone, localNow(timezone).date).catch(() => null);
      return NextResponse.json({ fixes: parseFixes(raw, text), usage });
    },
    { sb, userId: user.id },
  );
}
