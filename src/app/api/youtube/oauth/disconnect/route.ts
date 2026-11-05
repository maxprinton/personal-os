// POST /api/youtube/oauth/disconnect → revokes the Google tokens (best effort) and deletes the yt_oauth row.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disconnect } from "@/lib/youtube/server/yt-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in again." }, { status: 401 });
  try {
    await disconnect(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not disconnect." }, { status: 500 });
  }
}
