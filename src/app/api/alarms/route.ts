import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashAlarmKey, loadAlarms } from "@/lib/alarms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Android app calls this with `Authorization: Bearer <personal key>` and gets the next 7 days
// of alarms (only blocks with the Alarm switch on). Public in the middleware; the key is the login.

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Server not ready" }, { status: 503 });

  const { data } = await admin
    .from("user_settings")
    .select("user_id,timezone")
    .eq("alarm_key_hash", hashAlarmKey(key))
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Wrong key" }, { status: 401 });

  const timezone = (data.timezone as string | null) ?? "America/Guayaquil";
  try {
    const alarms = await loadAlarms(admin, data.user_id as string, timezone);
    return NextResponse.json(
      { ok: true, generatedAtMs: Date.now(), timezone, alarms },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not read the calendar" }, { status: 500 });
  }
}
