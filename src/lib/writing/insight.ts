// Monday insight (server, admin client): your most repeated spelling mistakes of last week
// ("gimansio → gimnasio ×4"), from the corrections you accepted (writing_mistakes, migration 0024).
// Added once per Monday after 8:00, so it shows on Today and in the Monday Telegram message.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { mondayOf } from "@/lib/writing/settings";

export function mistakesLine(rows: { wrong: string; fixed: string; n: number }[]) {
  const merged = new Map<string, { wrong: string; fixed: string; n: number }>();
  for (const r of rows) {
    const k = `${r.wrong}→${r.fixed}`;
    const cur = merged.get(k);
    if (cur) cur.n += r.n;
    else merged.set(k, { ...r });
  }
  const top = [...merged.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  if (!top.length) return null;
  return `✍️ Writing: your most repeated mistakes last week were ${top.map((t) => `“${t.wrong}” → “${t.fixed}”${t.n > 1 ? ` ×${t.n}` : ""}`).join(", ")}.`;
}

export async function writingInsight(admin: SupabaseClient, userId: string, today: string, minutes: number) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday !== 1 || minutes < 8 * 60) return false;
  const lastWeek = mondayOf(addDays(today, -7));
  const { data: done } = await admin
    .from("system_insights")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .like("message", "✍️ Writing:%")
    .gte("generated_at", new Date(Date.now() - 20 * 3600 * 1000).toISOString())
    .limit(1);
  if (done?.length) return false;
  const { data, error } = await admin.from("writing_mistakes").select("wrong,fixed,n").eq("user_id", userId).eq("week", lastWeek);
  if (error) return false; // migration 0024 not run yet
  const line = mistakesLine((data ?? []) as { wrong: string; fixed: string; n: number }[]);
  if (!line) return false;
  await admin.from("system_insights").insert({ user_id: userId, insight_type: "pattern", message: line });
  return true;
}
