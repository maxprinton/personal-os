import { NextResponse } from "next/server";
import { alarmUser } from "@/lib/alarms";
import { loadAlarmDay } from "@/lib/alarm-day";
import { isDate } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BL-110: the phone app's day view. GET /api/alarms/day?date=YYYY-MM-DD with the same
// `Authorization: Bearer <personal key>` as /api/alarms. Read only: the day's chains of rings
// (future ones from the calendar, past ones joined with what the phone reported).

export async function GET(request: Request) {
  const who = await alarmUser(request);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!isDate(date)) return NextResponse.json({ error: "Pick a date (YYYY-MM-DD)" }, { status: 400 });
  try {
    const day = await loadAlarmDay(who.admin, who.userId, who.timezone, date);
    return NextResponse.json({ ok: true, ...day }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read that day" }, { status: 500 });
  }
}
