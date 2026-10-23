import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMessage, saveParsed, userContext } from "@/lib/capture";

export const dynamic = "force-dynamic";

/** Quick capture from the app (also used to sync items saved while offline). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Empty" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "Too long" }, { status: 400 });

  try {
    const ctx = await userContext(supabase, user.id);
    const { parsed } = await parseMessage(text, ctx.today, ctx.categories.map((c) => c.name));
    const saved = await saveParsed(supabase, user.id, parsed, "web", ctx);
    return NextResponse.json({ ok: true, summary: saved.summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
