import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CaptureError, processCapture } from "@/lib/capture";

export const dynamic = "force-dynamic";

/** Quick capture from the app (also used to sync items saved while offline). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { text?: string; accountId?: string | null };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Empty" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "Too long" }, { status: 400 });

  try {
    const { saved } = await processCapture(supabase, user.id, text, "web", body.accountId || null);
    return NextResponse.json({ ok: true, summary: saved.summary });
  } catch (e) {
    if (e instanceof CaptureError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
