// ✨ AI in notes: the editor sends what to do (summarize, continue, improve the selection…) and gets
// Markdown back to preview. Only for the signed-in user; nothing is saved here.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, hasAi } from "@/lib/ai";
import { buildAiPrompt, cleanAiMarkdown, type AiRequest } from "@/lib/ai-notes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!hasAi()) return NextResponse.json({ error: "The AI is not connected: GROQ_API_KEY is missing in Vercel (guide: ACTIVAR-GROQ.md)." }, { status: 503 });

  let body: AiRequest;
  try {
    body = (await req.json()) as AiRequest;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const built = buildAiPrompt(body);
  if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });

  const out = await aiChat(built.system, [{ text: built.user }], { kind: "write", temperature: built.temperature, maxTokens: 2500, timeoutMs: 50_000 });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 502 });
  const text = cleanAiMarkdown(out.text);
  if (!text) return NextResponse.json({ error: "The AI answered with nothing. Try again." }, { status: 502 });
  return NextResponse.json({ text });
}
