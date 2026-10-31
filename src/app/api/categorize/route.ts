// ✨ Auto-categorize: POST { skip?: string[] } → one round (see lib/auto-categorize.ts). The browser calls it again
// until nothing is left, so no single request runs long and the free AI limit per minute is respected.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAi } from "@/lib/ai";
import { runRound, supabaseDb } from "@/lib/auto-categorize";
import { scopeUsageLine, withAiUsage } from "@/lib/ai-usage";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { skip?: unknown } | null;
  const skip = Array.isArray(b?.skip) ? b.skip.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
  try {
    return await withAiUsage(
      "auto-categorize",
      async () => {
        const r = await runRound(supabaseDb(sb, user.id), { skip, ask: hasAi() ? undefined : null });
        const { timezone } = await getSettings(sb);
        const usage = await scopeUsageLine(sb, user.id, timezone, localNow(timezone).date).catch(() => null);
        return NextResponse.json({ ...r, usage });
      },
      { sb, userId: user.id },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't categorize." });
  }
}
