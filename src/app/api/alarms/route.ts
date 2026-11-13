import { NextResponse } from "next/server";
import { alarmUser, loadAlarms } from "@/lib/alarms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Android app calls this with `Authorization: Bearer <personal key>` and gets the next 7 days
// of alarms (only blocks with phone alarm rules). Public in the middleware; the key is the login.

export async function GET(request: Request) {
  const who = await alarmUser(request);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const { admin, userId, timezone } = who;
  try {
    const alarms = await loadAlarms(admin, userId, timezone);
    // When the phone last read its alarms: Telegram warns if it goes quiet (column from migration 0059)
    await admin.from("user_settings").update({ alarm_last_sync_at: new Date().toISOString() }).eq("user_id", userId);
    return NextResponse.json(
      { ok: true, generatedAtMs: Date.now(), timezone, alarms },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not read the calendar" }, { status: 500 });
  }
}
