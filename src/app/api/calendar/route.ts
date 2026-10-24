import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCalendar } from "@/lib/calendar/load";
import { daysBetween, isDate } from "@/lib/time";
import { isMobileUA } from "@/lib/device";

export const dynamic = "force-dynamic";

/** GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — data for the calendar panel. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isDate(from) || !isDate(to) || to < from || daysBetween(from, to) > 62) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }
  const mobile = req.headers.get("sec-ch-ua-mobile") === "?1" || isMobileUA(req.headers.get("user-agent"));
  const data = await loadCalendar(supabase, user.id, from, to, { readOnly: mobile });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
