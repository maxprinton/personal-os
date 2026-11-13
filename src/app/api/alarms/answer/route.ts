import { NextResponse } from "next/server";
import { alarmUser } from "@/lib/alarms";
import { applyAlarmEvents, cleanAlarmEvent } from "@/lib/alarm-answers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Android app sends what happened on the alarm screen: rings, answers (Started, Skip today, Done...),
// ticks, the morning check-in and "Going to sleep". It keeps a queue and sends it again until it is accepted;
// each event has its own id, so sending twice never counts twice.

export async function POST(request: Request) {
  const who = await alarmUser(request);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: {events:[...]}" }, { status: 400 });
  }
  const raw = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(raw)) return NextResponse.json({ error: "Send JSON: {events:[...]}" }, { status: 400 });
  const now = Date.now();
  const events = raw.slice(0, 100).map((r) => cleanAlarmEvent(r, now));
  const valid = events.filter((e): e is NonNullable<typeof e> => e !== null);
  try {
    const results = await applyAlarmEvents(who.admin, who.userId, who.timezone, valid);
    // Events that could not be read are accepted too (dropped), so the phone doesn't send them forever
    const dropped = raw
      .slice(0, 100)
      .filter((_, i) => events[i] === null)
      .map((r) => ({ clientId: String((r as { clientId?: unknown })?.clientId ?? ""), ok: true, message: "ignored" }));
    return NextResponse.json({ ok: true, results: [...results, ...dropped] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
