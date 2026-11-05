// POST /api/youtube/oauth/refresh → refreshes the Google access token now (tests the connection).
// Answers JSON { ok, error?, reconnect? } — never the token itself.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/youtube/server/yt-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in again." }, { status: 401 });
  try {
    const r = await getAccessToken(user.id);
    if (r.token === null) return NextResponse.json({ ok: false, error: r.error, reconnect: r.reconnect });
    return NextResponse.json({ ok: true, channelId: r.channelId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not refresh." }, { status: 500 });
  }
}
